/**
 * Explicit state machines (CLAUDE.md rule 3). Each entity declares its legal transitions once;
 * services call `assert` before changing status and log the transition.
 */
export class InvalidTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: cannot move from ${from} to ${to}`);
  }
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  can(from: S, to: S): boolean;
  assert(from: S, to: S): void;
  next(from: S): readonly S[];
  isTerminal(state: S): boolean;
}

export function defineMachine<S extends string>(
  name: string,
  transitions: { readonly [K in S]: readonly S[] },
): StateMachine<S> {
  const states = Object.keys(transitions) as S[];
  for (const [from, targets] of Object.entries(transitions) as [S, readonly S[]][]) {
    for (const to of targets) {
      if (!(to in transitions)) {
        throw new Error(`${name}: transition ${from} → ${to} targets an undeclared state`);
      }
    }
  }
  return {
    name,
    states,
    can: (from, to) => transitions[from]?.includes(to) ?? false,
    assert(from, to) {
      if (!this.can(from, to)) throw new InvalidTransitionError(name, from, to);
    },
    next: (from) => transitions[from] ?? [],
    isTerminal: (state) => (transitions[state] ?? []).length === 0,
  };
}
