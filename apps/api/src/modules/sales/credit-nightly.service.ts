import { creditPolicies, customers } from "@erp/db";
import { nightlyBlockAction } from "@erp/domain";
import { Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { runAsSystem } from "../../common/context.js";
import { recordTransition } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { CreditService } from "./credit.service.js";
import { SalesOrdersService } from "./sales-orders.service.js";

export interface NightlyResult {
  checked: number;
  blocked: number;
  unblocked: number;
}

/**
 * The nightly credit evaluation (Stage 4, Q35): every active customer is checked with no new
 * order. A breach of the auto-block rule sets the system block; once it clears, the system block
 * is lifted and held orders are re-checked. Manual blocks are never touched. The live check at
 * Confirm stays the gate; this keeps the flag (and the people watching it) current.
 */
@Injectable()
export class CreditNightlyService {
  private readonly logger = new Logger(CreditNightlyService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly credit: CreditService,
    private readonly orders: SalesOrdersService,
  ) {}

  async run(companyId?: string): Promise<NightlyResult> {
    const rows = await this.uow.db
      .select({ customer: customers, policy: creditPolicies })
      .from(customers)
      .innerJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
      .where(
        and(eq(customers.active, true), companyId ? eq(customers.companyId, companyId) : undefined),
      );
    const result: NightlyResult = { checked: 0, blocked: 0, unblocked: 0 };
    for (const { customer, policy } of rows) {
      result.checked++;
      const action = await runAsSystem(
        { companyId: customer.companyId, userId: null, name: "Nightly credit check" },
        async () => {
          const check = await this.credit.check(this.uow.db, customer.id, 0, null, policy);
          const act = nightlyBlockAction(
            { systemBlocked: policy.systemBlock, manualBlock: policy.manualBlock },
            check,
          );
          if (act === "none") return act;
          await this.uow.run(async (tx) => {
            const reason =
              act === "block"
                ? `Nightly check: ${check.reasons.filter((r) => r !== "MANUAL_BLOCK").join(", ")} (exposure ₹${check.exposure}, ${check.maxDaysPastDue} days past due)`
                : "Nightly check: within terms again";
            await tx
              .update(creditPolicies)
              .set(
                act === "block"
                  ? { systemBlock: true, systemBlockedAt: new Date(), systemBlockReason: reason }
                  : { systemBlock: false, systemBlockedAt: null, systemBlockReason: null },
              )
              .where(eq(creditPolicies.customerId, customer.id));
            await recordTransition(
              tx,
              "CustomerCredit",
              customer.id,
              act === "block" ? "Clear" : "SystemBlocked",
              act === "block" ? "SystemBlocked" : "Clear",
              reason,
            );
          });
          if (act === "unblock") {
            await this.orders.recheckHeld({
              companyId: customer.companyId,
              customerId: customer.id,
            });
          }
          return act;
        },
      );
      if (action === "block") result.blocked++;
      if (action === "unblock") result.unblocked++;
    }
    if (result.blocked || result.unblocked) this.logger.log(result, "nightly credit check");
    return result;
  }
}
