import type { BulkRevisionInput, BulkRevisionRow } from "@erp/contracts";
import { D, formatINR, istToday } from "@erp/domain";
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  Field,
  NumberInput,
  PageHeader,
  Segmented,
  Stepper,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ReasonField } from "../../../components/reason-field.js";
import { api, call, reasonHeader } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import {
  categoriesQuery,
  customerGroupsQuery,
  customersQuery,
  qualitiesQuery,
  settingValue,
} from "../../../lib/masters.js";
import { keys, settingsQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/pricing/bulk-revision")({
  component: BulkRevisionPage,
});

const STEPS = ["Scope", "Change", "Preview", "Apply"];

const previewColumns: ColumnDef<BulkRevisionRow, unknown>[] = [
  { accessorKey: "customerName", header: "Customer" },
  { accessorKey: "productName", header: "Product" },
  {
    accessorKey: "oldRate44",
    header: "Current ₹/m",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
  {
    accessorKey: "newRate44",
    header: "New ₹/m",
    meta: { numeric: true },
    cell: (c) => <span className="font-semibold">{formatINR(c.getValue() as string)}</span>,
  },
  {
    id: "delta",
    header: "Change",
    meta: { numeric: true },
    accessorFn: (r) => D(r.newRate44).minus(r.oldRate44).toFixed(2),
    cell: (c) => {
      const v = D(c.getValue() as string);
      return (
        <span className={v.isNegative() ? "text-danger" : "text-success"}>
          {v.isNegative() ? "" : "+"}
          {formatINR(v)}
        </span>
      );
    },
  },
];

function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? [...list, item] : list.filter((x) => x !== item);
}

/** Bulk rate revision (PRD §6.4): scope → change → preview → reason, applied in one transaction. */
function BulkRevisionPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const { data: groups } = useQuery(customerGroupsQuery);
  const { data: customers } = useQuery(customersQuery);
  const { data: categories } = useQuery(categoriesQuery);
  const { data: qualities } = useQuery(qualitiesQuery);
  const { data: settings } = useQuery(settingsQuery);
  const gsmList = settingValue<number[]>(settings, "catalogue.gsmList", []);

  const [step, setStep] = useState(0);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [qualityIds, setQualityIds] = useState<string[]>([]);
  const [gsms, setGsms] = useState<number[]>([]);
  const [mode, setMode] = useState<"PERCENT" | "FLAT">("PERCENT");
  const [value, setValue] = useState("");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [effectiveFrom, setEffectiveFrom] = useState(istToday());
  const [reason, setReason] = useState("");

  const body: BulkRevisionInput = {
    customerIds,
    groupIds,
    categoryIds,
    qualityIds,
    gsms,
    mode,
    value: `${direction === "down" ? "-" : ""}${value || "0"}`,
    effectiveFrom,
  };
  const preview = useMutation({
    mutationFn: () =>
      call<{ rows: BulkRevisionRow[]; customers: number }>(() =>
        api.POST("/api/pricing/bulk-revision/preview", { body }),
      ),
    onSuccess: () => setStep(2),
    onError: (e) => onError(e),
  });
  const apply = useMutation({
    mutationFn: () =>
      call<{ revised: number; customers: number }>(() =>
        api.POST("/api/pricing/bulk-revision", { body, headers: reasonHeader(reason) }),
      ),
    onSuccess: async (r) => {
      toast({
        tone: "success",
        title: `${r.revised} rates revised`,
        description: `${r.customers} customers, effective ${effectiveFrom}`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.customers });
      void navigate({ to: "/customers" });
    },
    onError: (e) => onError(e),
  });

  const visibleCustomers = useMemo(
    () =>
      (customers ?? [])
        .filter((c) => c.active && c.legalName.toLowerCase().includes(customerFilter.toLowerCase()))
        .slice(0, 60),
    [customers, customerFilter],
  );
  const scopeSummary = [
    groupIds.length || customerIds.length
      ? `${groupIds.length ? `${groupIds.length} group(s)` : ""}${groupIds.length && customerIds.length ? " + " : ""}${customerIds.length ? `${customerIds.length} customer(s)` : ""}`
      : "All customers",
    categoryIds.length ? `${categoryIds.length} category(ies)` : "all categories",
    qualityIds.length ? `${qualityIds.length} quality(ies)` : "all qualities",
    gsms.length ? `GSM ${gsms.join(", ")}` : "all GSMs",
  ].join(" · ");
  const changeLabel = `${direction === "up" ? "+" : "−"}${value || "0"}${mode === "PERCENT" ? "%" : " ₹/m"} from ${effectiveFrom}`;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Bulk rate revision"
        description="Change many customer rates at once. Running rates end the day before the new ones start; every change is kept in rate history."
        breadcrumbs={[
          { label: "Masters" },
          { label: "Customers", href: "/customers" },
          { label: "Bulk rate revision" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <Stepper steps={STEPS} current={step} />

      {step === 0 ? (
        <Card
          title="Which rates?"
          description="Leave a section empty to include everything in it."
          footer={
            <div className="flex justify-end">
              <Button variant="primary" icon={ArrowRight} onClick={() => setStep(1)}>
                Next: change
              </Button>
            </div>
          }
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-fg">Customer groups</legend>
              <div className="flex flex-wrap gap-4">
                {(groups ?? []).map((g) => (
                  <Checkbox
                    key={g.id}
                    label={g.name}
                    checked={groupIds.includes(g.id)}
                    onCheckedChange={(on) => setGroupIds(toggle(groupIds, g.id, on))}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-fg">
                Specific customers {customerIds.length ? `(${customerIds.length})` : ""}
              </legend>
              <TextInput
                aria-label="Filter customers"
                placeholder="Filter customers"
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
              />
              <div className="mt-2 grid max-h-48 gap-1.5 overflow-y-auto rounded-md border border-border p-2">
                {visibleCustomers.map((c) => (
                  <Checkbox
                    key={c.id}
                    label={c.legalName}
                    checked={customerIds.includes(c.id)}
                    onCheckedChange={(on) => setCustomerIds(toggle(customerIds, c.id, on))}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-fg">Categories</legend>
              <div className="flex flex-wrap gap-4">
                {(categories ?? []).map((c) => (
                  <Checkbox
                    key={c.id}
                    label={c.name}
                    checked={categoryIds.includes(c.id)}
                    onCheckedChange={(on) => setCategoryIds(toggle(categoryIds, c.id, on))}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-fg">Qualities</legend>
              <div className="flex flex-wrap gap-4">
                {(qualities ?? []).map((q) => (
                  <Checkbox
                    key={q.id}
                    label={q.name}
                    checked={qualityIds.includes(q.id)}
                    onCheckedChange={(on) => setQualityIds(toggle(qualityIds, q.id, on))}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="lg:col-span-2">
              <legend className="mb-2 text-sm font-semibold text-fg">GSM</legend>
              <div className="flex flex-wrap gap-4">
                {gsmList.map((g) => (
                  <Checkbox
                    key={g}
                    label={`${g}`}
                    checked={gsms.includes(g)}
                    onCheckedChange={(on) => setGsms(toggle(gsms, g, on))}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card
          title="What change?"
          description={scopeSummary}
          footer={
            <div className="flex justify-between">
              <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(0)}>
                Back
              </Button>
              <Button
                variant="primary"
                icon={ArrowRight}
                disabled={!value || D(value).isZero()}
                busy={preview.isPending}
                onClick={() => preview.mutate()}
              >
                Preview changes
              </Button>
            </div>
          }
        >
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <span className="text-sm font-medium text-fg">Change by</span>
              <Segmented
                label="Change by"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: "PERCENT", label: "Percent" },
                  { value: "FLAT", label: "₹ per metre" },
                ]}
              />
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium text-fg">Direction</span>
              <Segmented
                label="Direction"
                value={direction}
                onValueChange={setDirection}
                options={[
                  { value: "up", label: "Increase" },
                  { value: "down", label: "Decrease" },
                ]}
              />
            </div>
            <Field label={mode === "PERCENT" ? "Percent" : "₹ per metre"} required>
              {(p) => (
                <NumberInput
                  {...p}
                  autoFocus
                  decimals={4}
                  suffix={mode === "PERCENT" ? "%" : "₹/m"}
                  value={value}
                  onValueChange={setValue}
                />
              )}
            </Field>
            <Field label="Effective from" required>
              {(p) => (
                <TextInput
                  {...p}
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              )}
            </Field>
          </div>
        </Card>
      ) : null}

      {step === 2 && preview.data ? (
        <Card
          title={`${preview.data.rows.length} rates for ${preview.data.customers} customers`}
          description={`${changeLabel} · ${scopeSummary}`}
          padded={false}
          footer={
            <div className="flex justify-between">
              <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                variant="primary"
                icon={ArrowRight}
                disabled={preview.data.rows.length === 0}
                onClick={() => setStep(3)}
              >
                Next: apply
              </Button>
            </div>
          }
        >
          <DataTable
            caption="Rate changes"
            data={preview.data.rows}
            columns={previewColumns}
            getRowId={(r) => `${r.customerId}:${r.productId}`}
            searchPlaceholder="Search customers or products"
            empty={
              <p className="py-6 text-center text-sm text-fg-3">
                No current rates match this scope.
              </p>
            }
          />
        </Card>
      ) : null}

      {step === 3 && preview.data ? (
        <Card
          title="Apply the revision"
          description="All rates change together, or none do. You may be asked to confirm your password."
          footer={
            <div className="flex justify-between">
              <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                variant="primary"
                icon={CheckCircle2}
                disabled={!reason.trim()}
                busy={apply.isPending}
                onClick={() => apply.mutate()}
              >
                Revise {preview.data.rows.length} rates
              </Button>
            </div>
          }
        >
          <div className="grid max-w-xl gap-4">
            <p className="text-sm text-fg-2">
              <strong className="text-fg">{changeLabel}</strong> for {preview.data.customers}{" "}
              customers.
            </p>
            <ReasonField value={reason} onChange={setReason} required />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
