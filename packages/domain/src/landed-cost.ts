import { D, type Dec, type DecimalLike, allocateLargestRemainder, round, sum } from "./money.js";
import { rollWeightKg } from "./rolls.js";

/**
 * Landed cost (PRD §8.3, ADR-0017): each charge on a purchase invoice is spread over that
 * invoice's rolls by a basis, with the largest-remainder method so the parts sum to the charge
 * to the paisa. GST is never part of landed cost (ADR-0008).
 */
export const LANDED_COST_BASES = ["ROLL", "METER", "VALUE", "WEIGHT"] as const;
export type LandedCostBasis = (typeof LANDED_COST_BASES)[number];

export interface AllocationRoll {
  id: string;
  /** Original length in metres (the GRN length). */
  lengthM: DecimalLike;
  /** Base cost of the roll (rate × length) — the VALUE basis. */
  baseValue: DecimalLike;
  gsm: DecimalLike;
  widthIn: DecimalLike;
}

export function basisWeight(roll: AllocationRoll, basis: LandedCostBasis): Dec {
  switch (basis) {
    case "ROLL":
      return D(1);
    case "METER":
      return D(roll.lengthM);
    case "VALUE":
      return D(roll.baseValue);
    case "WEIGHT":
      return rollWeightKg(roll.gsm, roll.widthIn, roll.lengthM);
  }
}

/** Splits one charge across rolls; returns roll id → amount (2 dp), summing exactly to `amount`. */
export function allocateCharge(
  amount: DecimalLike,
  basis: LandedCostBasis,
  rolls: readonly AllocationRoll[],
): Map<string, Dec> {
  const parts = allocateLargestRemainder(
    amount,
    rolls.map((r) => basisWeight(r, basis)),
    2,
  );
  return new Map(rolls.map((r, i) => [r.id, parts[i]!]));
}

export interface LandedCostCharge {
  id: string;
  amount: DecimalLike;
  basis: LandedCostBasis;
}

export interface RollLandedCost {
  rollId: string;
  /** Sum of all charge shares for this roll. */
  landedCost: Dec;
  /** (base value + landed cost) ÷ original length, 4 dp — drives partial-length COGS. */
  costPerMetre: Dec;
}

/** Applies several charges and returns per-roll totals plus the effective cost per metre. */
export function landedCostPerRoll(
  charges: readonly LandedCostCharge[],
  rolls: readonly AllocationRoll[],
): RollLandedCost[] {
  const totals = new Map(rolls.map((r) => [r.id, D(0)]));
  for (const charge of charges) {
    for (const [id, part] of allocateCharge(charge.amount, charge.basis, rolls)) {
      totals.set(id, totals.get(id)!.plus(part));
    }
  }
  return rolls.map((r) => {
    const landedCost = totals.get(r.id)!;
    return {
      rollId: r.id,
      landedCost,
      costPerMetre: round(D(r.baseValue).plus(landedCost).dividedBy(D(r.lengthM)), 4),
    };
  });
}

/** Total of all charges — what the per-roll shares must add up to. */
export function chargesTotal(charges: readonly LandedCostCharge[]): Dec {
  return sum(charges.map((c) => c.amount));
}
