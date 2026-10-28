import type { EInvoicePayload } from "@erp/domain";

/** What the IRP returns for a reported invoice (ADR-0011). */
export interface IrnResult {
  irn: string;
  ackNo: string;
  ackDate: Date;
  signedInvoice: string;
  signedQr: string;
  /** True when the IRP already had this document and returned its existing IRN. */
  duplicate?: boolean;
}

/** IRP cancellation reasons: 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 other. */
export type IrnCancelReason = "1" | "2" | "3" | "4";

export interface EwayBillInput {
  irn: string;
  distanceKm: number;
  transporterGstin: string | null;
  transporterName: string | null;
  vehicleNo: string | null;
  /** LR / transport document. */
  transDocNo: string | null;
  /** ISO date. */
  transDocDate: string | null;
}

export interface EwayBillResult {
  ewbNo: string;
  ewbDate: Date;
  validUntil: Date | null;
}

/**
 * One e-invoice back end (ADR-0011): the NIC sandbox, a live GSP once Q27 is answered, or the
 * offline simulator. Every call is logged by the caller to `einvoice_requests`.
 */
export interface EInvoiceProvider {
  readonly name: string;
  generateIrn(payload: EInvoicePayload): Promise<IrnResult>;
  cancelIrn(irn: string, reason: IrnCancelReason, remark: string): Promise<{ cancelledAt: Date }>;
  generateEwayBill(input: EwayBillInput): Promise<EwayBillResult>;
}

/**
 * A failed provider call. `retryable` is false when the IRP rejected the document itself
 * (fix the data, then retry by hand) and true for outages, timeouts and expired sessions.
 */
export class EInvoiceProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string | null = null,
    readonly response: unknown = null,
  ) {
    super(message);
  }
}

export const EINVOICE_PROVIDER = Symbol("EINVOICE_PROVIDER");
