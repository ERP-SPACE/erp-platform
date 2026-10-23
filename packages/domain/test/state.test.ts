import { describe, expect, it } from "vitest";
import { InvalidTransitionError, defineMachine } from "../src/state.js";

// Shape of the PRD §7 voucher machine — a small, real example.
const voucher = defineMachine<"Draft" | "Posted">("Voucher", { Draft: ["Posted"], Posted: [] });

describe("defineMachine", () => {
  it("allows declared transitions only", () => {
    expect(voucher.can("Draft", "Posted")).toBe(true);
    expect(voucher.can("Posted", "Draft")).toBe(false);
    expect(() => voucher.assert("Draft", "Posted")).not.toThrow();
  });

  it("throws a typed error on illegal transitions", () => {
    try {
      voucher.assert("Posted", "Draft");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).code).toBe("INVALID_STATE_TRANSITION");
      expect((error as Error).message).toBe("Voucher: cannot move from Posted to Draft");
    }
  });

  it("reports next states and terminal states", () => {
    expect(voucher.next("Draft")).toEqual(["Posted"]);
    expect(voucher.isTerminal("Posted")).toBe(true);
    expect(voucher.states).toEqual(["Draft", "Posted"]);
  });

  it("refuses transitions to undeclared states at definition time", () => {
    expect(() => defineMachine("Broken", { A: ["B"] } as unknown as { A: readonly "A"[] })).toThrow(
      /undeclared state/,
    );
  });
});
