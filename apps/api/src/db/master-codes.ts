import { type Tx, masterSequences } from "@erp/db";
import { and, eq, sql } from "drizzle-orm";

export type MasterEntity = "customer" | "supplier" | "salesman" | "transporter";

/**
 * Next master record code (CUST-0001, SUP-0001, SLS-0001, TRN-001). The UPDATE takes a row lock,
 * so concurrent creates serialise; a rolled-back create releases its number with the transaction.
 */
export async function nextMasterCode(
  tx: Tx,
  companyId: string,
  entity: MasterEntity,
): Promise<string> {
  const [row] = await tx
    .update(masterSequences)
    .set({ nextValue: sql`${masterSequences.nextValue} + 1` })
    .where(and(eq(masterSequences.companyId, companyId), eq(masterSequences.entity, entity)))
    .returning();
  if (!row) throw new Error(`master_sequences row missing for ${entity} — run the seed`);
  return `${row.prefix}${String(row.nextValue - 1).padStart(row.padding, "0")}`;
}
