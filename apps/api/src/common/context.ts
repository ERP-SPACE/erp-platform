import { AsyncLocalStorage } from "node:async_hooks";
import type { PermissionCode } from "@erp/contracts";

export interface Actor {
  userId: string;
  name: string;
  email: string;
  companyId: string;
  branchId: string | null;
  roles: string[];
  permissions: ReadonlySet<PermissionCode>;
  sessionId: string;
  sessionCreatedAt: Date;
  twoFactorEnabled: boolean;
}

/** Per-request state, available anywhere via `ctx()` (set by RequestContextMiddleware). */
export interface RequestContext {
  requestId: string;
  actor?: Actor;
  /** From the X-Change-Reason header; written to the audit log (CLAUDE.md rule 7). */
  reason?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function ctx(): RequestContext {
  const store = requestContext.getStore();
  if (!store) throw new Error("No request context — code is running outside a request");
  return store;
}

export function actor(): Actor {
  const a = ctx().actor;
  if (!a) throw new Error("No authenticated actor in this request");
  return a;
}

/**
 * Runs background work (queue consumers) with an actor, as the person whose action caused it,
 * so audit columns, settings and customer scope work as they do in a request.
 */
export function runAsSystem<T>(
  who: { companyId: string; userId: string | null; name: string },
  work: () => Promise<T>,
): Promise<T> {
  const system: Actor = {
    userId: who.userId ?? "",
    name: who.name,
    email: "",
    companyId: who.companyId,
    branchId: null,
    roles: [],
    permissions: new Set(),
    sessionId: "",
    sessionCreatedAt: new Date(),
    twoFactorEnabled: false,
  };
  return requestContext.run({ requestId: `job-${crypto.randomUUID()}`, actor: system }, work);
}
