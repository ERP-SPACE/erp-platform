import type {
  CategoryItem,
  CommissionRuleItem,
  CustomerDefaults,
  CustomerDetail,
  CustomerGroupItem,
  CustomerListItem,
  DashboardSummary,
  PartyRateItem,
  ProductItem,
  QualityItem,
  RateHistoryItem,
  SalesmanDetail,
  SalesmanItem,
  SettingItem,
  SupplierItem,
  TransporterItem,
} from "@erp/contracts";
import { GST_STATES } from "@erp/domain";
import { queryOptions } from "@tanstack/react-query";
import { api, call } from "./api.js";
import { keys } from "./queries.js";

/** Query options for the Stage 1 master screens. Keys nest under `keys.*` so realtime invalidates them. */
export const categoriesQuery = queryOptions({
  queryKey: [...keys.catalogue, "categories"],
  queryFn: () => call<CategoryItem[]>(() => api.GET("/api/catalogue/categories")),
});
export const qualitiesQuery = queryOptions({
  queryKey: [...keys.catalogue, "qualities"],
  queryFn: () => call<QualityItem[]>(() => api.GET("/api/catalogue/qualities")),
});
export const productsQuery = queryOptions({
  queryKey: [...keys.catalogue, "products"],
  queryFn: () =>
    call<ProductItem[]>(() =>
      api.GET("/api/catalogue/products", { params: { query: { active: "all" } } }),
    ),
});

export const suppliersQuery = (active: "true" | "false" | "all" = "all") =>
  queryOptions({
    queryKey: [...keys.suppliers, active],
    queryFn: () =>
      call<SupplierItem[]>(() => api.GET("/api/suppliers", { params: { query: { active } } })),
  });
export const transportersQuery = queryOptions({
  queryKey: [...keys.transporters, "all"],
  queryFn: () =>
    call<TransporterItem[]>(() =>
      api.GET("/api/transporters", { params: { query: { active: "all" } } }),
    ),
});

export const salesmenQuery = (active: "true" | "false" | "all" = "all") =>
  queryOptions({
    queryKey: [...keys.salesmen, "list", active],
    queryFn: () =>
      call<SalesmanItem[]>(() => api.GET("/api/salesmen", { params: { query: { active } } })),
  });
export const salesmanQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.salesmen, "detail", id],
    queryFn: () =>
      call<SalesmanDetail>(() => api.GET("/api/salesmen/{id}", { params: { path: { id } } })),
  });
export const commissionRulesQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.salesmen, "commission", id],
    queryFn: () =>
      call<CommissionRuleItem[]>(() =>
        api.GET("/api/salesmen/{id}/commission-rules", { params: { path: { id } } }),
      ),
  });

export const customerGroupsQuery = queryOptions({
  queryKey: [...keys.customers, "groups"],
  queryFn: () => call<CustomerGroupItem[]>(() => api.GET("/api/customer-groups")),
  staleTime: 5 * 60_000,
});
export const customersQuery = queryOptions({
  queryKey: [...keys.customers, "list"],
  queryFn: () =>
    call<CustomerListItem[]>(() =>
      api.GET("/api/customers", { params: { query: { active: "all" } } }),
    ),
});
export const customerQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.customers, "detail", id],
    queryFn: () =>
      call<CustomerDetail>(() => api.GET("/api/customers/{id}", { params: { path: { id } } })),
  });
export const customerDefaultsQuery = (salesmanId: string | undefined) =>
  queryOptions({
    queryKey: [...keys.customers, "defaults", salesmanId ?? "none"],
    queryFn: () =>
      call<CustomerDefaults>(() =>
        api.GET("/api/customers/defaults", { params: { query: salesmanId ? { salesmanId } : {} } }),
      ),
  });
export const customerRatesQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.customers, "rates", id],
    queryFn: () =>
      call<PartyRateItem[]>(() =>
        api.GET("/api/customers/{id}/rates", { params: { path: { id } } }),
      ),
  });
export const rateHistoryQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.customers, "rate-history", id],
    queryFn: () =>
      call<RateHistoryItem[]>(() =>
        api.GET("/api/customers/{id}/rate-history", { params: { path: { id } } }),
      ),
  });

export const dashboardQuery = queryOptions({
  queryKey: [...keys.dashboard, "summary"],
  queryFn: () => call<DashboardSummary>(() => api.GET("/api/dashboard/summary")),
  staleTime: 60_000,
});

// ── form helpers ──────────────────────────────────────────────────────────────

export const STATE_OPTIONS = Object.entries(GST_STATES).map(([code, name]) => ({
  value: code,
  label: `${code} · ${name}`,
}));
export const stateName = (code: string | null | undefined) =>
  code ? (GST_STATES[code] ?? code) : "—";

/** Trimmed text, or null when blank (optional API fields). */
export const nullable = (v: string) => (v.trim() ? v.trim() : null);

/** Server field issues keyed by their last path segment ("billingAddress.city" → "city"). */
export function flattenIssues(errors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors).map(([path, message]) => [path.split(".").at(-1)!, message]),
  );
}

export interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}
export const emptyAddress: AddressForm = { line1: "", line2: "", city: "", state: "", pincode: "" };
export const toAddressForm = (
  a:
    | { line1: string; line2?: string; city: string; state: string; pincode: string }
    | null
    | undefined,
): AddressForm =>
  a
    ? { line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state, pincode: a.pincode }
    : emptyAddress;
export const fromAddressForm = (a: AddressForm) => ({
  line1: a.line1.trim(),
  ...(a.line2.trim() && { line2: a.line2.trim() }),
  city: a.city.trim(),
  state: a.state.trim(),
  pincode: a.pincode.trim(),
});

export function settingValue<T>(settings: SettingItem[] | undefined, key: string, fallback: T): T {
  return (settings?.find((s) => s.key === key)?.value as T | undefined) ?? fallback;
}
