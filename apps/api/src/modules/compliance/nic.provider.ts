import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import type { EInvoicePayload } from "@erp/domain";
import {
  type EInvoiceProvider,
  EInvoiceProviderError,
  type EwayBillInput,
  type EwayBillResult,
  type IrnCancelReason,
  type IrnResult,
} from "./einvoice-provider.js";

export interface NicConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  gstin: string;
  publicKey: string;
  /** Per-call timeout. */
  timeoutMs?: number;
}

interface Session {
  authToken: string;
  sek: Buffer;
  expiresAt: number;
}

interface NicResponse {
  Status: number | string;
  Data?: string | Record<string, unknown> | null;
  ErrorDetails?: { ErrorCode: string; ErrorMessage: string }[] | null;
  InfoDtls?: { InfCd: string; Desc: unknown }[] | null;
}

const aes = (mode: "enc" | "dec", key: Buffer, data: Buffer) => {
  const c =
    mode === "enc"
      ? createCipheriv("aes-256-ecb", key, null)
      : createDecipheriv("aes-256-ecb", key, null);
  return Buffer.concat([c.update(data), c.final()]);
};

/** NIC dates are IST wall-clock "yyyy-MM-dd HH:mm:ss". */
export const parseNicDate = (v: string) => new Date(`${v.replace(" ", "T")}+05:30`);
const nicDocDate = (iso: string) => iso.split("-").reverse().join("/");

const toPem = (key: string) =>
  key.includes("BEGIN")
    ? key.replace(/\\n/g, "\n")
    : `-----BEGIN PUBLIC KEY-----\n${key
        .replace(/\s+/g, "")
        .match(/.{1,64}/g)!
        .join("\n")}\n-----END PUBLIC KEY-----\n`;

/**
 * The NIC e-invoice API (IRP v1.03, auth v1.04) — the sandbox now, and the same protocol for
 * direct-IRP production access (ADR-0011). Credentials are RSA-encrypted with NIC's public key;
 * NIC returns a session encryption key (SEK), itself AES-encrypted with our one-time app key,
 * and every request/response body after that is AES-256-ECB under the SEK.
 */
export class NicProvider implements EInvoiceProvider {
  readonly name = "NIC_SANDBOX";
  private session: Session | null = null;

  constructor(
    private readonly config: NicConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<NicResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          Gstin: this.config.gstin,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
      });
    } catch (error) {
      throw new EInvoiceProviderError(
        `The e-invoice portal could not be reached (${(error as Error).message})`,
        true,
      );
    }
    const text = await res.text();
    if (res.status >= 500 || res.status === 429) {
      throw new EInvoiceProviderError(
        `The e-invoice portal is unavailable (HTTP ${res.status})`,
        true,
      );
    }
    try {
      return JSON.parse(text) as NicResponse;
    } catch {
      throw new EInvoiceProviderError(
        `The e-invoice portal sent an unreadable reply (HTTP ${res.status})`,
        res.status >= 400 ? false : true,
        null,
        text.slice(0, 2000),
      );
    }
  }

  private async login(): Promise<Session> {
    if (this.session && this.session.expiresAt - Date.now() > 5 * 60_000) return this.session;
    const appKey = randomBytes(32);
    const credentials = JSON.stringify({
      UserName: this.config.username,
      Password: this.config.password,
      AppKey: appKey.toString("base64"),
      ForceRefreshAccessToken: this.session !== null,
    });
    const data = publicEncrypt(
      { key: createPublicKey(toPem(this.config.publicKey)), padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(credentials),
    ).toString("base64");
    const res = await this.call("POST", "/eivital/v1.04/auth", { Data: data }, {});
    if (String(res.Status) !== "1" || !res.Data || typeof res.Data === "string") {
      throw this.rejection(res, "Sign-in to the e-invoice portal failed", true);
    }
    const d = res.Data as { AuthToken: string; Sek: string; TokenExpiry: string };
    this.session = {
      authToken: d.AuthToken,
      sek: aes("dec", appKey, Buffer.from(d.Sek, "base64")),
      expiresAt: parseNicDate(d.TokenExpiry).getTime(),
    };
    return this.session;
  }

  /** An authenticated call; re-signs in once if NIC says the token expired (1005). */
  private async secure<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const s = await this.login();
      const payload =
        body === undefined
          ? undefined
          : { Data: aes("enc", s.sek, Buffer.from(JSON.stringify(body))).toString("base64") };
      const res = await this.call(method, path, payload, {
        user_name: this.config.username,
        AuthToken: s.authToken,
      });
      if (String(res.Status) === "1" && typeof res.Data === "string") {
        return JSON.parse(aes("dec", s.sek, Buffer.from(res.Data, "base64")).toString()) as T;
      }
      if (attempt === 0 && res.ErrorDetails?.some((e) => e.ErrorCode === "1005")) {
        this.session = null;
        continue;
      }
      throw this.rejection(res, "The e-invoice portal rejected the request", false);
    }
  }

  private rejection(res: NicResponse, fallback: string, retryable: boolean) {
    const first = res.ErrorDetails?.[0];
    const message = res.ErrorDetails?.length
      ? res.ErrorDetails.map((e) => `${e.ErrorCode}: ${e.ErrorMessage}`).join("; ")
      : fallback;
    return new EInvoiceProviderError(message, retryable, first?.ErrorCode ?? null, res);
  }

  async generateIrn(payload: EInvoicePayload): Promise<IrnResult> {
    // The sandbox only accepts its own registered GSTIN as the seller.
    const body = { ...payload, SellerDtls: { ...payload.SellerDtls, Gstin: this.config.gstin } };
    try {
      return this.toIrn(
        await this.secure<Record<string, string>>("POST", "/eicore/v1.03/Invoice", body),
      );
    } catch (error) {
      // 2150 Duplicate IRN: already reported (e.g. a retry after a lost reply) — fetch it.
      if (error instanceof EInvoiceProviderError && error.code === "2150") {
        const q = new URLSearchParams({
          doctype: payload.DocDtls.Typ,
          docnum: payload.DocDtls.No,
          docdate: payload.DocDtls.Dt,
        });
        const found = await this.secure<Record<string, string>>(
          "GET",
          `/eicore/v1.03/Invoice/irnbydocdetails?${q}`,
        );
        return { ...this.toIrn(found), duplicate: true };
      }
      throw error;
    }
  }

  private toIrn(d: Record<string, string>): IrnResult {
    return {
      irn: d.Irn!,
      ackNo: String(d.AckNo),
      ackDate: parseNicDate(d.AckDt!),
      signedInvoice: d.SignedInvoice!,
      signedQr: d.SignedQRCode!,
    };
  }

  async cancelIrn(irn: string, reason: IrnCancelReason, remark: string) {
    const d = await this.secure<{ Irn: string; CancelDate: string }>(
      "POST",
      "/eicore/v1.03/Invoice/Cancel",
      { Irn: irn, CnlRsn: reason, CnlRem: remark.slice(0, 100) },
    );
    return { cancelledAt: parseNicDate(d.CancelDate) };
  }

  async generateEwayBill(input: EwayBillInput): Promise<EwayBillResult> {
    const d = await this.secure<{
      EwbNo: number | string;
      EwbDt: string;
      EwbValidTill: string | null;
    }>("POST", "/eiewb/v1.03/ewaybill", {
      Irn: input.irn,
      Distance: input.distanceKm,
      TransMode: "1",
      ...(input.transporterGstin ? { TransId: input.transporterGstin } : {}),
      ...(input.transporterName ? { TransName: input.transporterName } : {}),
      ...(input.transDocNo ? { TransDocNo: input.transDocNo } : {}),
      ...(input.transDocDate ? { TransDocDt: nicDocDate(input.transDocDate) } : {}),
      ...(input.vehicleNo ? { VehNo: input.vehicleNo.replace(/\s+/g, ""), VehType: "R" } : {}),
    });
    return {
      ewbNo: String(d.EwbNo),
      ewbDate: parseNicDate(d.EwbDt),
      validUntil: d.EwbValidTill ? parseNicDate(d.EwbValidTill) : null,
    };
  }
}
