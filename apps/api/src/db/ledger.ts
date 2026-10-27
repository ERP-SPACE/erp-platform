import { type Tx, postingEvents, statusTransitions } from "@erp/db";
import { actor, ctx } from "../common/context.js";

/** Logs a status change (CLAUDE.md rule 3); call after the state machine's `assert`. */
export async function recordTransition(
  tx: Tx,
  entityType: string,
  entityIds: string | readonly string[],
  fromStatus: string | null,
  toStatus: string,
  reason?: string | null,
): Promise<void> {
  const ids = typeof entityIds === "string" ? [entityIds] : entityIds;
  if (ids.length === 0) return;
  await tx.insert(statusTransitions).values(
    ids.map((entityId) => ({
      companyId: actor().companyId,
      entityType,
      entityId,
      fromStatus,
      toStatus,
      reason: reason ?? ctx().reason ?? null,
      requestId: ctx().requestId,
      by: actor().userId,
    })),
  );
}

/**
 * Writes an immutable, self-contained posting event for the later accounting stage (ADR-0004).
 * The payload must carry every figure the voucher will need — accounting never re-reads documents.
 */
export async function writePostingEvent(
  tx: Tx,
  event: {
    type: string;
    docType: string;
    docId: string;
    docNo: string | null;
    docDate: string;
    partyType?: "SUPPLIER" | "CUSTOMER" | null;
    partyId?: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(postingEvents).values({
    companyId: actor().companyId,
    branchId: actor().branchId,
    type: event.type,
    docType: event.docType,
    docId: event.docId,
    docNo: event.docNo,
    docDate: event.docDate,
    partyType: event.partyType ?? null,
    partyId: event.partyId ?? null,
    payload: event.payload,
    requestId: ctx().requestId,
    createdBy: actor().userId,
  });
}
