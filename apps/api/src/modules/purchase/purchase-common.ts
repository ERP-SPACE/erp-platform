import { type Tx, companies, suppliers } from "@erp/db";
import { gstRegime } from "@erp/domain";
import { and, eq } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { notFound, validationError } from "../../common/errors.js";
import type { UnitOfWork } from "../../db/unit-of-work.js";

type Db = UnitOfWork["db"] | Tx;

/** Active supplier of this company plus the GST regime for buying from them (PRD §8.6). */
export async function supplierWithRegime(db: Db, supplierId: string) {
  const [row] = await db
    .select({ supplier: suppliers, companyState: companies.stateCode })
    .from(suppliers)
    .innerJoin(companies, eq(companies.id, suppliers.companyId))
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, actor().companyId)));
  if (!row) throw notFound("Supplier");
  return {
    supplier: row.supplier,
    regime: gstRegime(row.companyState, row.supplier.stateCode),
  };
}

export function assertActiveSupplier(supplier: { active: boolean; name: string }) {
  if (!supplier.active) {
    throw validationError(`${supplier.name} is inactive.`, [
      { path: "supplierId", message: "Choose an active supplier" },
    ]);
  }
}

/** "44.00" → 44 for comparisons with typed widths. */
export const widthNumber = (w: string | number) => Number(w);

/** Same item: same SKU, or (for unmapped items) the same GSM and width. */
export function sameItem(
  a: { skuId: string | null; gsm: number; widthIn: string | number },
  b: { skuId: string | null; gsm: number; widthIn: string | number },
): boolean {
  if (a.skuId && b.skuId) return a.skuId === b.skuId;
  return a.gsm === b.gsm && widthNumber(a.widthIn) === widthNumber(b.widthIn);
}
