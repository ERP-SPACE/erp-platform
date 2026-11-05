import type {
  AuditPage,
  CompanyResponse,
  MeResponse,
  PermissionItem,
  RoleItem,
  SeriesItem,
  SettingItem,
  UserItem,
} from "@erp/contracts";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { ApiError, api, call } from "./api.js";

/**
 * The API can't be reached yet: the dev proxy's 503 API_UNAVAILABLE, a gateway error, or a
 * network failure. Typical right after `pnpm dev`, before the API has finished starting.
 */
export function serverUnavailable(error: unknown): boolean {
  if (error instanceof ApiError)
    return error.code === "API_UNAVAILABLE" || [502, 503, 504].includes(error.status);
  return error instanceof TypeError; // fetch() itself failed
}

/** Retry server errors twice; keep retrying for ~30 s while the server is starting. */
const retry = (count: number, error: unknown) =>
  serverUnavailable(error)
    ? count < 15
    : !(error instanceof ApiError && error.status < 500) && count < 2;
const retryDelay = (attempt: number) => Math.min(500 * 2 ** attempt, 2_000);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry,
      retryDelay,
      refetchOnWindowFocus: true,
    },
  },
});

/** Query keys; realtime topics invalidate by these prefixes (lib/realtime.ts). */
export const keys = {
  me: ["me"] as const,
  settings: ["settings"] as const,
  company: ["company"] as const,
  series: ["series"] as const,
  users: ["users"] as const,
  roles: ["roles"] as const,
  permissions: ["permissions"] as const,
  audit: (filters: Record<string, string | undefined>) => ["audit", filters] as const,
  catalogue: ["catalogue"] as const,
  customers: ["customers"] as const,
  suppliers: ["suppliers"] as const,
  transporters: ["transporters"] as const,
  salesmen: ["salesmen"] as const,
  dashboard: ["dashboard"] as const,
  purchase: ["purchase"] as const,
  inventory: ["inventory"] as const,
  sales: ["sales"] as const,
  collections: ["collections"] as const,
};

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: () => call<MeResponse>(() => api.GET("/api/me")),
  staleTime: 60_000,
  retry,
  retryDelay,
});

/**
 * Loads /me for a route guard, waiting while the server is still starting (right after
 * `pnpm dev`). It retries itself rather than relying on TanStack Query's retries, which are
 * cancelled when the last component watching the query unmounts (as happens on first load).
 */
export async function fetchMe(client: QueryClient): Promise<MeResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.fetchQuery({ ...meQuery, retry: false });
    } catch (error) {
      if (!serverUnavailable(error) || attempt >= 15) throw error;
      await new Promise((r) => setTimeout(r, retryDelay(attempt)));
    }
  }
}

export const settingsQuery = queryOptions({
  queryKey: keys.settings,
  queryFn: () => call<SettingItem[]>(() => api.GET("/api/settings")),
});

export const companyQuery = queryOptions({
  queryKey: keys.company,
  queryFn: () => call<CompanyResponse>(() => api.GET("/api/company")),
});

export const seriesQuery = queryOptions({
  queryKey: keys.series,
  queryFn: () => call<SeriesItem[]>(() => api.GET("/api/document-series")),
});

export const usersQuery = queryOptions({
  queryKey: keys.users,
  queryFn: () => call<UserItem[]>(() => api.GET("/api/users")),
});

export const rolesQuery = queryOptions({
  queryKey: keys.roles,
  queryFn: () => call<RoleItem[]>(() => api.GET("/api/roles")),
});

export const permissionsQuery = queryOptions({
  queryKey: keys.permissions,
  queryFn: () => call<PermissionItem[]>(() => api.GET("/api/permissions")),
  staleTime: Infinity,
});

export function auditQuery(filters: { table?: string; rowId?: string; cursor?: string }) {
  return queryOptions({
    queryKey: keys.audit(filters),
    queryFn: () =>
      call<AuditPage>(() =>
        api.GET("/api/audit", { params: { query: { ...filters, limit: 50 } } }),
      ),
  });
}

export function can(me: MeResponse | undefined, permission: string): boolean {
  return Boolean(me?.permissions.includes(permission));
}
