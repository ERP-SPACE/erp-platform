/**
 * Roll allocation (port matrix 2.1, ADR-0012/0014/0018): suggests which rolls fill an order line.
 * A faithful port of legacy `allocationService.autoAllocateForLine` — characterised against the
 * legacy file in test/allocation.test.ts — with the standard length and tolerance taken from
 * Settings, and one extra step: a single suggested cut when the line allows it.
 *
 * Suggestions only: nothing here holds a roll. Picking onto a draft DC does (ADR-0014).
 */

export interface AllocatableRoll {
  id: string;
  /** Whole metres. */
  lengthM: number;
  /** Inward time (ms since epoch); FIFO order among standard rolls. */
  inwardAt: number;
}

export interface AllocationOptions {
  /** Rolls of exactly this length are "standard" (legacy 1000 m; Settings). */
  standardLengthM: number;
  /** A shortfall up to this many metres counts as fulfilled (legacy 100 m; Settings). */
  toleranceM: number;
  /** The order line accepts a cut roll (customer `allow_cut`, ADR-0018). */
  allowCut?: boolean;
  /** A cut must not leave the source roll shorter than this, unless it leaves nothing (100 m). */
  minRemnantM?: number;
}

export interface SuggestedCut {
  rollId: string;
  /** Metres to cut off for this line; the child roll's length. */
  cutM: number;
  /** What stays on the source roll. */
  leftoverM: number;
}

export interface AllocationResult {
  status: "FULFILLED" | "PARTIAL" | "NO_INVENTORY";
  /** Whole rolls, in pick order. */
  rolls: AllocatableRoll[];
  cut: SuggestedCut | null;
  /** `{lengthM, qty}` buckets for the SO line's length mix, most common first. */
  groups: { lengthM: number; qty: number }[];
  allocatedM: number;
  remainingM: number;
  fulfilled: boolean;
}

/** Standard rolls first (oldest first), then the rest longest first. */
export function sortRollsForAllocation<T extends AllocatableRoll>(
  rolls: readonly T[],
  standardLengthM: number,
): T[] {
  const standard = rolls
    .filter((r) => r.lengthM === standardLengthM)
    .sort((a, b) => a.inwardAt - b.inwardAt);
  const others = rolls
    .filter((r) => r.lengthM !== standardLengthM)
    .sort((a, b) => b.lengthM - a.lengthM);
  return [...standard, ...others];
}

/** Takes every roll whose full length still fits; longer rolls are skipped, never cut. */
function greedy(rolls: AllocatableRoll[], requiredM: number) {
  let remaining = requiredM;
  const allocated: AllocatableRoll[] = [];
  for (const roll of rolls) {
    if (remaining <= 0) break;
    if (roll.lengthM <= remaining) {
      allocated.push(roll);
      remaining -= roll.lengthM;
    }
  }
  return { allocated, remaining };
}

/**
 * Small-gap swap: replace one of the last two picks with the first unpicked roll (in sort order)
 * that covers the gap with at most 2 × tolerance over. Legacy takes the first such roll, not the
 * closest; that is kept.
 */
function bestSwap(
  sorted: AllocatableRoll[],
  allocated: AllocatableRoll[],
  remaining: number,
  toleranceM: number,
) {
  const picked = new Set(allocated.map((r) => r.id));
  const unpicked = sorted.filter((r) => !picked.has(r.id));
  let best: { index: number; roll: AllocatableRoll; gain: number } | null = null;
  for (const index of [allocated.length - 1, allocated.length - 2].filter((i) => i >= 0)) {
    const needed = allocated[index]!.lengthM + remaining;
    const swap = unpicked.find((r) => r.lengthM >= needed && r.lengthM <= needed + toleranceM * 2);
    if (swap) {
      const gain = swap.lengthM - allocated[index]!.lengthM;
      if (!best || gain < best.gain) best = { index, roll: swap, gain };
    }
  }
  return best;
}

/**
 * One cut for the shortfall (ADR-0018): an unpicked remnant long enough, leaving the smallest
 * leftover that is still usable; otherwise the oldest standard roll that leaves a usable remnant.
 */
function suggestCut(
  sorted: AllocatableRoll[],
  allocated: AllocatableRoll[],
  shortfallM: number,
  { standardLengthM, minRemnantM = 100 }: AllocationOptions,
): SuggestedCut | null {
  const picked = new Set(allocated.map((r) => r.id));
  const usable = (r: AllocatableRoll) => {
    const leftover = r.lengthM - shortfallM;
    return !picked.has(r.id) && leftover > 0 && leftover >= minRemnantM;
  };
  const remnant = sorted
    .filter((r) => r.lengthM !== standardLengthM && usable(r))
    .sort((a, b) => a.lengthM - b.lengthM || a.inwardAt - b.inwardAt)[0];
  const source = remnant ?? sorted.find((r) => r.lengthM === standardLengthM && usable(r));
  return source
    ? { rollId: source.id, cutM: shortfallM, leftoverM: source.lengthM - shortfallM }
    : null;
}

export function groupAllocation(
  rolls: readonly { lengthM: number }[],
): { lengthM: number; qty: number }[] {
  const counts = new Map<number, number>();
  for (const r of rolls) counts.set(r.lengthM, (counts.get(r.lengthM) ?? 0) + 1);
  return [...counts]
    .map(([lengthM, qty]) => ({ lengthM, qty }))
    .sort((a, b) => b.qty - a.qty || b.lengthM - a.lengthM);
}

/** Suggests rolls (and at most one cut) for `requiredM` metres from the available rolls of a SKU. */
export function allocateRolls(
  available: readonly AllocatableRoll[],
  requiredM: number,
  options: AllocationOptions,
): AllocationResult {
  const rolls = available.filter((r) => r.lengthM > 0);
  if (rolls.length === 0) {
    return {
      status: "NO_INVENTORY",
      rolls: [],
      cut: null,
      groups: [],
      allocatedM: 0,
      remainingM: requiredM,
      fulfilled: false,
    };
  }
  const sorted = sortRollsForAllocation(rolls, options.standardLengthM);
  let { allocated, remaining } = greedy(sorted, requiredM);

  if (remaining > 0 && remaining <= options.toleranceM) {
    const swap = bestSwap(sorted, allocated, remaining, options.toleranceM);
    if (swap) {
      allocated = [...allocated];
      allocated.splice(swap.index, 1, swap.roll);
      remaining = Math.max(0, remaining - swap.gain);
    }
  }

  let cut: SuggestedCut | null = null;
  if (remaining > options.toleranceM && options.allowCut) {
    cut = suggestCut(sorted, allocated, remaining, options);
    if (cut) remaining = 0;
  }

  const allocatedM = allocated.reduce((s, r) => s + r.lengthM, 0) + (cut?.cutM ?? 0);
  const fulfilled = remaining <= options.toleranceM;
  return {
    status: fulfilled ? "FULFILLED" : "PARTIAL",
    rolls: allocated,
    cut,
    groups: groupAllocation([...allocated, ...(cut ? [{ lengthM: cut.cutM }] : [])]),
    allocatedM,
    remainingM: Math.max(0, remaining),
    fulfilled,
  };
}
