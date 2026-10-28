import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AllocatableRoll,
  allocateRolls,
  groupAllocation,
  sortRollsForAllocation,
} from "../src/allocation.js";

const opts = { standardLengthM: 1000, toleranceM: 100 };
let seq = 0;
const roll = (lengthM: number, inwardAt = seq): AllocatableRoll => ({
  id: `r${++seq}`,
  lengthM,
  inwardAt,
});
const lengths = (rolls: { lengthM: number }[]) => rolls.map((r) => r.lengthM);

describe("roll allocation (port of legacy allocationService)", () => {
  it("takes standard rolls oldest first, then the longest remnants", () => {
    const old = roll(1000, 1);
    const young = roll(1000, 9);
    const rolls = [young, roll(450), roll(800), old];
    expect(sortRollsForAllocation(rolls, 1000).map((r) => r.id)).toEqual([
      old.id,
      young.id,
      rolls[2]!.id,
      rolls[1]!.id,
    ]);
    const r = allocateRolls(rolls, 2800, opts);
    expect(lengths(r.rolls)).toEqual([1000, 1000, 800]);
    expect(r).toMatchObject({ status: "FULFILLED", allocatedM: 2800, remainingM: 0 });
    expect(r.groups).toEqual([
      { lengthM: 1000, qty: 2 },
      { lengthM: 800, qty: 1 },
    ]);
  });

  it("never cuts on its own: a roll longer than what is left is skipped", () => {
    const r = allocateRolls([roll(1000), roll(1000)], 1500, opts);
    expect(lengths(r.rolls)).toEqual([1000]);
    expect(r).toMatchObject({ status: "PARTIAL", remainingM: 500, cut: null });
  });

  it("a small gap is closed by swapping a pick for a slightly longer roll", () => {
    // Greedy: 1000 + 900 = 1900, 50 short (within tolerance) → swap 900 for 950.
    const r = allocateRolls([roll(1000), roll(900), roll(950)], 1950, opts);
    expect(lengths(r.rolls)).toEqual([1000, 950]);
    expect(r).toMatchObject({ status: "FULFILLED", remainingM: 0 });
  });

  it("no rolls → NO_INVENTORY", () => {
    expect(allocateRolls([roll(0)], 500, opts)).toMatchObject({
      status: "NO_INVENTORY",
      remainingM: 500,
      fulfilled: false,
    });
  });

  it("groups lengths most common first", () => {
    expect(groupAllocation([{ lengthM: 500 }, { lengthM: 1000 }, { lengthM: 500 }])).toEqual([
      { lengthM: 500, qty: 2 },
      { lengthM: 1000, qty: 1 },
    ]);
  });
});

describe("single suggested cut (ADR-0018)", () => {
  const cutOpts = { ...opts, allowCut: true, minRemnantM: 100 };

  it("cuts the shortfall from the remnant that leaves the smallest usable leftover", () => {
    const r = allocateRolls([roll(1000), roll(800), roll(600), roll(380)], 1300, cutOpts);
    // Greedy: 1000; 300 short. Remnants ≥ 300 leaving ≥ 100: 600 (300 left), 800 (500 left);
    // 380 would leave 80 — below the minimum.
    expect(lengths(r.rolls)).toEqual([1000]);
    expect(r.cut).toEqual({ rollId: expect.any(String), cutM: 300, leftoverM: 300 });
    expect(r).toMatchObject({ status: "FULFILLED", allocatedM: 1300, remainingM: 0 });
    expect(r.groups).toEqual([
      { lengthM: 1000, qty: 1 },
      { lengthM: 300, qty: 1 },
    ]);
  });

  it("falls back to the oldest standard roll", () => {
    const older = roll(1000, 1);
    const r = allocateRolls([roll(1000, 5), older], 1400, cutOpts);
    expect(r.cut).toEqual({ rollId: expect.any(String), cutM: 400, leftoverM: 600 });
    // The first standard roll is picked whole; the cut comes from the other one.
    expect(r.rolls.map((x) => x.id)).toEqual([older.id]);
  });

  it("no cut when the line does not allow it, or when no roll leaves a usable remnant", () => {
    expect(allocateRolls([roll(1000), roll(1000)], 1500, opts).cut).toBeNull();
    const r = allocateRolls([roll(1000), roll(560)], 1500, cutOpts);
    // 500 short; 560 would leave 60 m.
    expect(r).toMatchObject({ cut: null, status: "PARTIAL", remainingM: 500 });
  });

  it("no cut for a gap already within tolerance", () => {
    expect(allocateRolls([roll(1000), roll(1000)], 1080, cutOpts).cut).toBeNull();
  });

  it("property: picks are distinct rolls and never exceed what was asked, plus the swap margin", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 0, max: 30 }).map((n) => n * 50),
          { maxLength: 25 },
        ),
        fc.integer({ min: 1, max: 20000 }),
        fc.boolean(),
        (ls, required, allowCut) => {
          const rolls = ls.map((l, i) => ({ id: `p${i}`, lengthM: l, inwardAt: i }));
          const r = allocateRolls(rolls, required, { ...cutOpts, allowCut });
          const ids = [...r.rolls.map((x) => x.id), ...(r.cut ? [r.cut.rollId] : [])];
          expect(new Set(ids).size).toBe(ids.length);
          expect(r.allocatedM).toBeLessThanOrEqual(required + 2 * cutOpts.toleranceM);
          if (r.cut) expect(r.cut.leftoverM).toBeGreaterThanOrEqual(100);
        },
      ),
    );
  });
});

/**
 * Characterisation: the port matches the legacy service exactly when no cut is allowed. The legacy
 * file is loaded read-only with its Mongo model stubbed; skipped where the legacy repo is absent (CI).
 */
const legacyPath = resolve(
  import.meta.dirname,
  "../../../../erp_api/services/allocationService.js",
);
describe.skipIf(!existsSync(legacyPath))("matches legacy allocationService", () => {
  type LegacyRoll = {
    _id: string;
    rollNumber: string;
    currentLengthMeters: number;
    inwardedAt: number;
  };
  let current: LegacyRoll[] = [];
  const require = createRequire(legacyPath);
  const modelPath = require.resolve("../models/Roll");
  require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: { find: () => ({ select: () => ({ lean: async () => current }) }) },
  } as unknown as NodeJS.Module;
  const legacy = require(legacyPath) as {
    autoAllocateForLine: (
      skuId: string,
      required: number,
      tolerance: number,
    ) => Promise<{
      status: string;
      rollDetails: { rollId: string }[];
      groups: { lengthMeters: number; qty: number }[];
      totalAllocatedMeters: number;
      remainingMeters: number;
      fulfilled: boolean;
    }>;
  };

  it("identical picks, totals and status on random stock", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.constant(1000),
            fc.integer({ min: 1, max: 40 }).map((n) => n * 50),
          ),
          { minLength: 1, maxLength: 30 },
        ),
        fc.integer({ min: 1, max: 25000 }),
        fc.integer({ min: 0, max: 300 }),
        async (ls, required, tolerance) => {
          const rolls = ls.map((l, i) => ({ id: `L${i}`, lengthM: l, inwardAt: (i * 7919) % 101 }));
          current = rolls.map((r) => ({
            _id: r.id,
            rollNumber: r.id,
            currentLengthMeters: r.lengthM,
            inwardedAt: r.inwardAt,
          }));
          const old = await legacy.autoAllocateForLine("sku", required, tolerance);
          const port = allocateRolls(rolls, required, {
            standardLengthM: 1000,
            toleranceM: tolerance,
          });
          expect(port.rolls.map((r) => r.id)).toEqual(old.rollDetails.map((r) => r.rollId));
          expect(port.groups).toEqual(
            old.groups.map((g) => ({ lengthM: g.lengthMeters, qty: g.qty })),
          );
          expect(port.allocatedM).toBe(old.totalAllocatedMeters);
          expect(port.remainingM).toBe(old.remainingMeters);
          expect(port.status).toBe(old.status);
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("allocation properties (Stage 3 gate)", () => {
  const anyRolls = fc.array(
    fc.record({
      lengthM: fc.integer({ min: 50, max: 1500 }),
      inwardAt: fc.integer({ min: 0, max: 400 }),
    }),
    { maxLength: 40 },
  );

  it("never double-books a roll or invents one; the totals add up", () => {
    fc.assert(
      fc.property(
        anyRolls,
        fc.integer({ min: 1, max: 30_000 }),
        fc.boolean(),
        (specs, required, allowCut) => {
          const rolls = specs.map((s, i) => ({ id: `p${i}`, ...s }));
          const r = allocateRolls(rolls, required, { ...opts, allowCut, minRemnantM: 100 });
          const ids = r.rolls.map((x) => x.id);
          expect(new Set(ids).size).toBe(ids.length);
          for (const id of ids) expect(rolls.some((x) => x.id === id)).toBe(true);
          if (r.cut) {
            // The cut comes from a roll that is not also picked whole, and leaves a usable remnant.
            expect(ids).not.toContain(r.cut.rollId);
            expect(r.cut.leftoverM).toBeGreaterThanOrEqual(100);
          }
          const picked = r.rolls.reduce((s, x) => s + x.lengthM, 0) + (r.cut?.cutM ?? 0);
          expect(picked).toBe(r.allocatedM);
          expect(r.allocatedM + r.remainingM).toBeGreaterThanOrEqual(required - opts.toleranceM);
          // No upper bound: the legacy swap step (ported as-is, characterised) may trade a
          // short pick for a longer roll and overshoot by more than the tolerance.
        },
      ),
      { numRuns: 500 },
    );
  });

  it("two lines given disjoint stock never share a roll", () => {
    fc.assert(
      fc.property(
        anyRolls,
        fc.integer({ min: 1, max: 8000 }),
        fc.integer({ min: 1, max: 8000 }),
        (specs, a, b) => {
          const rolls = specs.map((s, i) => ({ id: `q${i}`, ...s }));
          const first = allocateRolls(rolls, a, opts);
          const taken = new Set(first.rolls.map((x) => x.id));
          const second = allocateRolls(
            rolls.filter((x) => !taken.has(x.id)),
            b,
            opts,
          );
          for (const x of second.rolls) expect(taken.has(x.id)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});
