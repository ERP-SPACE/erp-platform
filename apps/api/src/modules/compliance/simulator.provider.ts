import { createHash } from "node:crypto";
import type { EInvoicePayload } from "@erp/domain";
import {
  type EInvoiceProvider,
  EInvoiceProviderError,
  type EwayBillInput,
  type EwayBillResult,
  type IrnResult,
} from "./einvoice-provider.js";

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const digits = (hex: string, n: number) =>
  (BigInt(`0x${hex}`) % 10n ** BigInt(n)).toString().padStart(n, "0");

/**
 * Offline stand-in for the IRP, used when no sandbox credentials are configured (dev, CI).
 * IRNs are computed the IRP's way — SHA-256 of seller GSTIN, financial year, document type and
 * number — so they are stable and duplicate reports return the same IRN. The signed invoice and
 * QR are JWT-shaped but unsigned ("alg": "none"), and say SIMULATED.
 */
export class SimulatorProvider implements EInvoiceProvider {
  readonly name = "SIMULATOR";
  private readonly issued = new Map<string, IrnResult>();
  private readonly cancelled = new Set<string>();
  private failures: EInvoiceProviderError[] = [];

  /** Test hook: the next calls fail with these errors, in order. */
  failNext(...errors: EInvoiceProviderError[]) {
    this.failures.push(...errors);
  }

  private maybeFail() {
    const next = this.failures.shift();
    if (next) throw next;
  }

  async generateIrn(p: EInvoicePayload): Promise<IrnResult> {
    this.maybeFail();
    const [, m, y] = p.DocDtls.Dt.split("/").map(Number) as [number, number, number];
    const fyStart = m >= 4 ? y : y - 1;
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
    const irn = createHash("sha256")
      .update(`${p.SellerDtls.Gstin}${fy}${p.DocDtls.Typ}${p.DocDtls.No.toUpperCase()}`)
      .digest("hex");
    if (this.cancelled.has(irn)) {
      throw new EInvoiceProviderError(
        "IRN is already cancelled; a new document number is needed",
        false,
        "2270",
      );
    }
    const existing = this.issued.get(irn);
    if (existing) return { ...existing, duplicate: true };
    const ackNo = digits(irn.slice(0, 20), 15);
    const ackDate = new Date();
    const claims = {
      sim: "SIMULATED — not reported to the IRP",
      SellerGstin: p.SellerDtls.Gstin,
      BuyerGstin: p.BuyerDtls.Gstin,
      DocNo: p.DocDtls.No,
      DocTyp: p.DocDtls.Typ,
      DocDt: p.DocDtls.Dt,
      TotInvVal: p.ValDtls.TotInvVal,
      ItemCnt: p.ItemList.length,
      MainHsnCode: p.ItemList[0]?.HsnCd,
      Irn: irn,
      IrnDt: ackDate.toISOString(),
    };
    const jwt = (data: unknown) => `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ data })}.`;
    const result: IrnResult = {
      irn,
      ackNo,
      ackDate,
      signedInvoice: jwt({ ...p, AckNo: ackNo, Irn: irn }),
      signedQr: jwt(claims),
    };
    this.issued.set(irn, result);
    return result;
  }

  async cancelIrn(irn: string): Promise<{ cancelledAt: Date }> {
    this.maybeFail();
    const issued = this.issued.get(irn);
    if (this.cancelled.has(irn)) {
      throw new EInvoiceProviderError("IRN is already cancelled", false, "9999");
    }
    // A restarted simulator has forgotten older IRNs; accept those rather than strand them.
    if (issued && Date.now() - issued.ackDate.getTime() > 24 * 3_600_000) {
      throw new EInvoiceProviderError("The 24-hour cancellation window has passed", false, "2265");
    }
    this.cancelled.add(irn);
    return { cancelledAt: new Date() };
  }

  async generateEwayBill(input: EwayBillInput): Promise<EwayBillResult> {
    this.maybeFail();
    if (this.cancelled.has(input.irn)) {
      throw new EInvoiceProviderError("The IRN is cancelled", false, "4002");
    }
    if (!input.vehicleNo && !input.transporterGstin) {
      throw new EInvoiceProviderError(
        "Give a vehicle number or a transporter GSTIN for Part B",
        false,
        "4019",
      );
    }
    const ewbDate = new Date();
    // One day per 200 km (or part), as the e-way bill rules give for ordinary cargo.
    const days = Math.max(1, Math.ceil(input.distanceKm / 200));
    const validUntil = new Date(ewbDate.getTime() + days * 86_400_000);
    const hex = createHash("sha256").update(`${input.irn}:ewb`).digest("hex");
    return { ewbNo: `1${digits(hex.slice(0, 16), 11)}`, ewbDate, validUntil };
  }
}
