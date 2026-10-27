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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
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
};

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: () => call<MeResponse>(() => api.GET("/api/me")),
  staleTime: 60_000,
});

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
