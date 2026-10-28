import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
} from "node:crypto";
import { buildEInvoice, salesInvoice } from "@erp/domain";
import { describe, expect, it } from "vitest";
import { EInvoiceProviderError } from "../../src/modules/compliance/einvoice-provider.js";
import { NicProvider, parseNicDate } from "../../src/modules/compliance/nic.provider.js";

const aes = (enc: boolean, key: Buffer, data: Buffer) => {
  const c = enc
    ? createCipheriv("aes-256-ecb", key, null)
    : createDecipheriv("aes-256-ecb", key, null);
  return Buffer.concat([c.update(data), c.final()]);
};

/** A fake IRP speaking NIC's protocol: RSA-wrapped login, SEK, AES-ECB bodies. */
function fakeIrp(opts: { failFirstWith?: string; duplicate?: boolean } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sek = randomBytes(32);
  const calls: { path: string; headers: Record<string, string>; body: unknown }[] = [];
  let logins = 0;
  let fail = opts.failFirstWith;
  const reply = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
  const ok = (data: unknown) =>
    reply({
      Status: 1,
      Data: aes(true, sek, Buffer.from(JSON.stringify(data))).toString("base64"),
    });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = init.headers as Record<string, string>;
    const body = init.body ? (JSON.parse(String(init.body)) as { Data: string }) : null;
    if (path === "/eivital/v1.04/auth") {
      logins++;
      const creds = JSON.parse(
        privateDecrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
          Buffer.from(body!.Data, "base64"),
        ).toString(),
      ) as { UserName: string; Password: string; AppKey: string };
      calls.push({ path, headers, body: { ...creds, Password: "***" } });
      return reply({
        Status: 1,
        Data: {
          AuthToken: `tok${logins}`,
          Sek: aes(true, Buffer.from(creds.AppKey, "base64"), sek).toString("base64"),
          TokenExpiry: "2099-01-01 00:00:00",
        },
      });
    }
    const plain = body
      ? JSON.parse(aes(false, sek, Buffer.from(body.Data, "base64")).toString())
      : null;
    calls.push({ path, headers, body: plain });
    if (fail) {
      const code = fail;
      fail = undefined;
      if (code === "503") return new Response("down", { status: 503 });
      return reply({ Status: 0, ErrorDetails: [{ ErrorCode: code, ErrorMessage: "rejected" }] });
    }
    if (path === "/eicore/v1.03/Invoice") {
      if (opts.duplicate) {
        return reply({
          Status: 0,
          ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }],
        });
      }
      return ok({
        AckNo: 112610000000001,
        AckDt: "2026-10-28 11:30:00",
        Irn: "f".repeat(64),
        SignedInvoice: "si",
        SignedQRCode: "qr",
      });
    }
    if (path === "/eicore/v1.03/Invoice/irnbydocdetails") {
      return ok({
        AckNo: 1,
        AckDt: "2026-10-27 09:00:00",
        Irn: "e".repeat(64),
        SignedInvoice: "si",
        SignedQRCode: "qr",
      });
    }
    if (path === "/eicore/v1.03/Invoice/Cancel")
      return ok({ Irn: "f".repeat(64), CancelDate: "2026-10-28 12:00:00" });
    if (path === "/eiewb/v1.03/ewaybill") {
      return ok({
        EwbNo: 141000000001,
        EwbDt: "2026-10-28 12:05:00",
        EwbValidTill: "2026-10-30 23:59:00",
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const provider = new NicProvider(
    {
      baseUrl: "https://irp.test",
      clientId: "cid",
      clientSecret: "csecret",
      username: "user",
      password: "pass",
      gstin: "29AAGCB1286Q000",
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    },
    fetchImpl,
  );
  return { provider, calls, logins: () => logins };
}

const payload = () =>
  buildEInvoice({
    docType: "INV",
    docNo: "SI/2627/00001",
    docDate: "2026-10-28",
    supplyType: "B2B",
    seller: {
      gstin: "24AAOFG2101Q1ZB",
      legalName: "Gulmohar Creation",
      address1: "A-1/4",
      city: "Surat",
      pincode: "394230",
      stateCode: "24",
    },
    buyer: {
      gstin: "24AAQFI3333Q1Z5",
      legalName: "Buyer",
      address1: "7 Road",
      city: "Surat",
      pincode: "395003",
      stateCode: "24",
    },
    placeOfSupply: "24",
    items: [
      {
        description: "Paper",
        hsnCode: "48239090",
        isService: false,
        unit: "MTR",
        quantity: 1000,
        unitPrice: "7",
      },
    ],
    invoice: salesInvoice([{ kind: "GOODS", metres: 1000, ratePerM: "7", gstRate: 18 }], {
      regime: "CGST_SGST",
      billDiscount: "0",
      zeroRated: false,
      roundOffTo: 1,
    }),
  });

describe("NicProvider (NIC IRP protocol)", () => {
  it("signs in with RSA-wrapped credentials and sends the invoice AES-encrypted under the SEK", async () => {
    const irp = fakeIrp();
    const r = await irp.provider.generateIrn(payload());
    expect(r).toMatchObject({ irn: "f".repeat(64), ackNo: "112610000000001", signedQr: "qr" });
    expect(r.ackDate.toISOString()).toBe("2026-10-28T06:00:00.000Z");
    const [auth, inv] = irp.calls;
    expect(auth).toMatchObject({
      body: { UserName: "user" },
      headers: { client_id: "cid", Gstin: "29AAGCB1286Q000" },
    });
    expect(inv!.headers).toMatchObject({ AuthToken: "tok1", user_name: "user" });
    // The sandbox's own GSTIN replaces the seller's; everything else is as built.
    expect(inv!.body).toMatchObject({
      SellerDtls: { Gstin: "29AAGCB1286Q000" },
      ValDtls: { TotInvVal: 8260 },
    });
    // The session is reused.
    await irp.provider.cancelIrn("f".repeat(64), "2", "Wrong rate");
    expect(irp.logins()).toBe(1);
  });

  it("re-signs in once on an expired token (1005)", async () => {
    const irp = fakeIrp({ failFirstWith: "1005" });
    await irp.provider.generateIrn(payload());
    expect(irp.logins()).toBe(2);
  });

  it("tells outages (retryable) from rejections (not)", async () => {
    await expect(
      fakeIrp({ failFirstWith: "503" }).provider.generateIrn(payload()),
    ).rejects.toMatchObject({ retryable: true });
    const rejected = fakeIrp({ failFirstWith: "2172" }).provider.generateIrn(payload());
    await expect(rejected).rejects.toBeInstanceOf(EInvoiceProviderError);
    await expect(rejected).rejects.toMatchObject({ retryable: false, code: "2172" });
  });

  it("a duplicate report (2150) fetches the IRN already issued", async () => {
    const irp = fakeIrp({ duplicate: true });
    const r = await irp.provider.generateIrn(payload());
    expect(r).toMatchObject({ irn: "e".repeat(64), duplicate: true });
    expect(irp.calls.at(-1)!.path).toBe("/eicore/v1.03/Invoice/irnbydocdetails");
  });

  it("e-way bill from the IRN carries Part B", async () => {
    const irp = fakeIrp();
    const r = await irp.provider.generateEwayBill({
      irn: "f".repeat(64),
      distanceKm: 280,
      vehicleNo: "GJ05 AB 1234",
      transporterGstin: null,
      transporterName: null,
      transDocNo: "LR77",
      transDocDate: "2026-10-28",
    });
    expect(r.ewbNo).toBe("141000000001");
    expect(irp.calls.at(-1)!.body).toMatchObject({
      Distance: 280,
      VehNo: "GJ05AB1234",
      VehType: "R",
      TransDocDt: "28/10/2026",
    });
  });

  it("reads NIC's IST timestamps", () => {
    expect(parseNicDate("2026-10-28 00:30:00").toISOString()).toBe("2026-10-27T19:00:00.000Z");
  });
});
