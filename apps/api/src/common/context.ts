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
