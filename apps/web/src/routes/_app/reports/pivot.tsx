import { type PivotResponse, type PivotSpec, SYSTEM_ROLES, type SavedPivot } from "@erp/contracts";
import {
  COST_MEASURES,
  PIVOT_DIMENSIONS,
  PIVOT_MEASURES,
  type PivotDimension,
  type PivotMeasure,
  istToday,
  periodRange,
} from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DropdownMenu,
  EmptyState,
  Field,
  PageHeader,
  Select,
  TextInput,
  useToast,
} from "@erp/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Save,
  Sheet,
  Table2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { crumbLink } from "../../../components/sales-bits.js";
import { api, call } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { can, meQuery } from "../../../lib/queries.js";
import {
  asOfLabel,
  formatCell,
  pivotsQuery,
  reportKeys,
  requestExport,
  runPivot,
} from "../../../lib/reports.js";

export const Route = createFileRoute("/_app/reports/pivot")({
  validateSearch: z.object({ saved: z.string().optional() }),
  component: PivotPage,
});

const DIM_LABEL: Record<PivotDimension, string> = {
  sku: "SKU",
  category: "Category",
  gsm: "GSM",
  quality: "Quality",
  width: "Width",
  customer: "Customer",
  customerGroup: "Customer group",
  supplier: "Supplier",
  salesman: "Salesman",
  day: "Day",
  month: "Month",
  quarter: "Quarter",
  fy: "Financial year",
};
const MEASURE_LABEL: Record<PivotMeasure, string> = {
  metres: "Metres",
  rolls: "Rolls",
  value: "Sales",
  cogs: "COGS",
  margin: "Margin",
  marginPct: "Margin %",
};
const MEASURE_KIND = {
  metres: "metres",
  rolls: "count",
  value: "money",
  cogs: "money",
  margin: "money",
  marginPct: "percent",
} as const;
const RANGES = [
  { value: "custom", label: "These dates" },
  { value: "thisMonth", label: "This month, always" },
  { value: "lastMonth", label: "Last month, always" },
  { value: "thisQuarter", label: "This quarter, always" },
  { value: "thisFy", label: "This financial year, always" },
  { value: "last30", label: "Last 30 days, always" },
  { value: "last90", label: "Last 90 days, always" },
] as const;

const defaultSpec = (): PivotSpec => {
  const today = istToday();
  return {
    rows: ["customer"],
    cols: ["month"],
    measures: ["metres", "value"],
    from: periodRange(today, "quarter").from,
    to: today,
    filters: {},
  };
};

/** Pivot builder (PRD §9.7): sales facts by any two sets of dimensions, saved and shared (Q39). */
function PivotPage() {
  const { data: me } = useQuery(meQuery);
  const canCost = can(me, "reports.margin.view");
  const [spec, setSpec] = useState<PivotSpec>(defaultSpec);
  const [openSaved, setOpenSaved] = useState<SavedPivot | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const saved = useQuery(pivotsQuery);
  const result = useQuery({
    queryKey: ["reports", "pivot", spec],
    queryFn: () => runPivot(spec),
    enabled: spec.measures.length > 0 && spec.from <= spec.to,
    placeholderData: keepPreviousData,
  });
  const exp = useMutation({
    mutationFn: (format: "csv" | "xlsx" | "pdf") => requestExport({ kind: "pivot", spec, format }),
    onSuccess: async () => {
      toast({
        tone: "success",
        title: "Pivot export is being prepared",
        description: "It will be in My exports in a moment.",
      });
      await queryClient.invalidateQueries({ queryKey: reportKeys.exports });
    },
    onError: (e) => onError(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      call(() =>
        api.DELETE("/api/reports/pivots/{pivotId}", { params: { path: { pivotId: id } } }),
      ),
    onSuccess: async () => {
      setOpenSaved(null);
      await queryClient.invalidateQueries({ queryKey: reportKeys.pivots });
    },
    onError: (e) => onError(e),
  });

  const used = new Set([...spec.rows, ...spec.cols]);
  const free = PIVOT_DIMENSIONS.filter((d) => !used.has(d)).map((d) => ({
    value: d,
    label: DIM_LABEL[d],
  }));
  const measures = PIVOT_MEASURES.filter((m) => canCost || !COST_MEASURES.includes(m));
  const set = (patch: Partial<PivotSpec>) => setSpec((s) => ({ ...s, ...patch }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={openSaved ? openSaved.name : "Pivot builder"}
        description={`Sales by any grouping: SKU, customer, supplier, salesman or period. Sales are taxable value, net of credit notes${result.data?.asOf ? ` · ${asOfLabel(result.data.asOf)}` : ""}.`}
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Pivot builder" }]}
        renderLink={crumbLink}
        actions={
          <>
            {can(me, "reports.export") ? (
              <DropdownMenu
                trigger={
                  <Button variant="secondary" icon={Download} busy={exp.isPending}>
                    Export
                  </Button>
                }
                items={[
                  {
                    label: "Excel (.xlsx)",
                    icon: FileSpreadsheet,
                    onSelect: () => exp.mutate("xlsx"),
                  },
                  { label: "CSV", icon: Sheet, onSelect: () => exp.mutate("csv") },
                  { label: "PDF", icon: FileText, onSelect: () => exp.mutate("pdf") },
                ]}
              />
            ) : null}
            <Button variant="primary" icon={Save} onClick={() => setSaving(true)}>
              {openSaved?.mine ? "Save changes" : "Save pivot"}
            </Button>
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="grid gap-6">
          <Card title="Build">
            <div className="grid gap-5">
              <DimPicker
                label="Rows"
                max={3}
                value={spec.rows}
                free={free}
                onChange={(rows) => set({ rows })}
              />
              <DimPicker
                label="Columns"
                max={2}
                value={spec.cols}
                free={free}
                onChange={(cols) => set({ cols })}
              />
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium text-fg">Show</legend>
                {measures.map((m) => (
                  <Checkbox
                    key={m}
                    label={MEASURE_LABEL[m]}
                    checked={spec.measures.includes(m)}
                    onCheckedChange={(on) =>
                      set({
                        measures: on
                          ? PIVOT_MEASURES.filter((x) => x === m || spec.measures.includes(x))
                          : spec.measures.filter((x) => x !== m),
                      })
                    }
                  />
                ))}
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  {(p) => (
                    <TextInput
                      {...p}
                      type="date"
                      value={spec.from}
                      onChange={(e) => e.target.value && set({ from: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="To">
                  {(p) => (
                    <TextInput
                      {...p}
                      type="date"
                      value={spec.to}
                      onChange={(e) => e.target.value && set({ to: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            </div>
          </Card>
          <Card title="Saved pivots" padded={false}>
            {saved.data?.length ? (
              <ul>
                {saved.data.map((p) => (
                  <li key={p.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => {
                        setOpenSaved(p);
                        setSpec(p.spec);
                      }}
                      aria-current={openSaved?.id === p.id ? "true" : undefined}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-fg">{p.name}</span>
                        <span className="block text-xs text-fg-2">
                          {p.mine
                            ? p.sharedWithRoles.length
                              ? "Shared"
                              : "Only you"
                            : `From ${p.ownerName}`}
                        </span>
                      </span>
                      {p.sharedWithRoles.length ? (
                        <Users className="size-4 text-fg-3" aria-label="Shared" />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-fg-2">
                Save a pivot to come back to it, or share it with a team.
              </p>
            )}
          </Card>
        </div>
        <PivotTable result={result.data} spec={spec} loading={result.isFetching} />
      </div>
      {saving ? (
        <SaveDialog
          spec={spec}
          existing={openSaved?.mine ? openSaved : null}
          canShare={can(me, "reports.pivot.share")}
          onClose={() => setSaving(false)}
          onSaved={(p) => {
            setOpenSaved(p);
            setSaving(false);
          }}
          onDelete={openSaved?.mine ? () => remove.mutate(openSaved.id) : undefined}
        />
      ) : null}
    </div>
  );
}

function DimPicker({
  label,
  max,
  value,
  free,
  onChange,
}: {
  label: string;
  max: number;
  value: PivotDimension[];
  free: { value: PivotDimension; label: string }[];
  onChange: (v: PivotDimension[]) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-fg">{label}</span>
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((d) => (
            <li key={d}>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted py-0.5 pl-2 pr-1 text-sm">
                {DIM_LABEL[d]}
                <button
                  type="button"
                  className="rounded p-0.5 text-fg-2 hover:bg-surface hover:text-fg"
                  aria-label={`Remove ${DIM_LABEL[d]} from ${label.toLowerCase()}`}
                  onClick={() => onChange(value.filter((x) => x !== d))}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-fg-2">
          None — one total {label === "Rows" ? "row" : "column"}
        </span>
      )}
      {value.length < max ? (
        <Select
          aria-label={`Add to ${label.toLowerCase()}`}
          value={undefined}
          placeholder={`Add to ${label.toLowerCase()}…`}
          options={free}
          onValueChange={(v) => onChange([...value, v as PivotDimension])}
        />
      ) : null}
    </div>
  );
}

function PivotTable({
  result,
  spec,
  loading,
}: {
  result: PivotResponse | undefined;
  spec: PivotSpec;
  loading: boolean;
}) {
  if (!result) {
    return (
      <Card>
        <EmptyState
          icon={Table2}
          title={loading ? "Building…" : "Choose what to show"}
          hint="Pick rows, columns and at least one measure."
        />
      </Card>
    );
  }
  const measures = spec.measures.filter((m) => !result.hiddenMeasures.includes(m));
  const cell = (t: PivotResponse["grandTotal"] | null, m: PivotMeasure) =>
    t
      ? formatCell(
          MEASURE_KIND[m],
          (t as Record<string, string | number | null | undefined>)[m] ?? null,
        )
      : "";
  const colHead = (k: string[]) => (k.length ? k.join(" · ") : "Total");
  const many = measures.length > 1;
  if (!result.rowKeys.length) {
    return (
      <Card>
        <EmptyState
          icon={Table2}
          title="No sales in this range"
          hint="Widen the dates or change the filters."
        />
      </Card>
    );
  }
  return (
    <Card
      padded={false}
      title={`${result.rowKeys.length.toLocaleString("en-IN")} rows × ${result.colKeys.length.toLocaleString("en-IN")} columns`}
      actions={
        result.truncated ? (
          <Badge tone="warning">Cut to 500 × 60 — export for all</Badge>
        ) : loading ? (
          <Badge tone="info">Updating</Badge>
        ) : null
      }
    >
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Pivot result</caption>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border">
              <th
                scope="col"
                rowSpan={many ? 2 : 1}
                className="sticky left-0 bg-surface px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-fg-2"
              >
                {spec.rows.map((d) => DIM_LABEL[d]).join(" · ") || "All"}
              </th>
              {result.colKeys.map((k) => (
                <th
                  key={k.join("|")}
                  scope="colgroup"
                  colSpan={measures.length}
                  className="px-4 py-2 text-right text-xs font-medium text-fg-2"
                >
                  {colHead(k)}
                </th>
              ))}
              {result.colKeys.length > 1 ? (
                <th
                  scope="colgroup"
                  colSpan={measures.length}
                  className="bg-muted px-4 py-2 text-right text-xs font-semibold text-fg"
                >
                  Total
                </th>
              ) : null}
            </tr>
            {many ? (
              <tr className="border-b border-border">
                {[...result.colKeys, ...(result.colKeys.length > 1 ? [["__total"]] : [])].flatMap(
                  (k) =>
                    measures.map((m) => (
                      <th
                        key={`${k.join("|")}-${m}`}
                        scope="col"
                        className="px-4 py-1.5 text-right text-[11px] font-medium text-fg-3"
                      >
                        {MEASURE_LABEL[m]}
                      </th>
                    )),
                )}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {result.rowKeys.map((rk, i) => (
              <tr key={rk.join("|") || "all"} className="border-b border-border hover:bg-muted/60">
                <th
                  scope="row"
                  className="sticky left-0 bg-surface px-4 py-2 text-left font-medium text-fg"
                >
                  {rk.join(" · ") || "All sales"}
                </th>
                {result.colKeys.flatMap((_, j) =>
                  measures.map((m) => (
                    <td key={`${j}-${m}`} className="tnum px-4 py-2 text-right text-fg">
                      {cell(result.cells[i]![j] ?? null, m)}
                    </td>
                  )),
                )}
                {spec.cols.length
                  ? measures.map((m) => (
                      <td
                        key={`t-${m}`}
                        className="tnum bg-muted/60 px-4 py-2 text-right font-medium text-fg"
                      >
                        {cell(result.rowTotals[i]!, m)}
                      </td>
                    ))
                  : null}
              </tr>
            ))}
          </tbody>
          {spec.rows.length ? (
            <tfoot>
              <tr className="border-t-2 border-border-strong bg-muted font-semibold">
                <th scope="row" className="sticky left-0 bg-muted px-4 py-2 text-left text-fg">
                  Total
                </th>
                {result.colKeys.flatMap((_, j) =>
                  measures.map((m) => (
                    <td key={`ct-${j}-${m}`} className="tnum px-4 py-2 text-right text-fg">
                      {cell(result.colTotals[j]!, m)}
                    </td>
                  )),
                )}
                {spec.cols.length
                  ? measures.map((m) => (
                      <td key={`g-${m}`} className="tnum px-4 py-2 text-right text-fg">
                        {cell(result.grandTotal, m)}
                      </td>
                    ))
                  : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </Card>
  );
}

function SaveDialog({
  spec,
  existing,
  canShare,
  onClose,
  onSaved,
  onDelete,
}: {
  spec: PivotSpec;
  existing: SavedPivot | null;
  canShare: boolean;
  onClose: () => void;
  onSaved: (p: SavedPivot) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [range, setRange] = useState<string>(existing?.range ?? "custom");
  const [roles, setRoles] = useState<string[]>(existing?.sharedWithRoles ?? []);
  const toast = useToast();
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        spec,
        range: range as SavedPivot["range"],
        sharedWithRoles: roles,
      };
      return existing
        ? call<SavedPivot>(() =>
            api.PUT("/api/reports/pivots/{pivotId}", {
              params: { path: { pivotId: existing.id } },
              body: { ...body, version: existing.version },
            }),
          )
        : call<SavedPivot>(() => api.POST("/api/reports/pivots", { body }));
    },
    onSuccess: async (p) => {
      toast({ tone: "success", title: `Saved “${p.name}”` });
      await queryClient.invalidateQueries({ queryKey: reportKeys.pivots });
      onSaved(p);
    },
    onError: (e) => onError(e, reportKeys.pivots),
  });
  const shareable = SYSTEM_ROLES.filter((r) => r.code !== "owner");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={existing ? "Save changes" : "Save pivot"}
      description="Private to you unless you share it with roles."
      footer={
        <>
          {onDelete ? (
            <Button
              variant="ghost"
              icon={Trash2}
              className="mr-auto text-danger"
              onClick={onDelete}
            >
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            disabled={!name.trim()}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" required>
          {(p) => (
            <TextInput
              {...p}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Dates when opened">
          {(p) => (
            <Select
              id={p.id}
              value={range}
              onValueChange={setRange}
              options={RANGES.map((r) => ({ ...r }))}
            />
          )}
        </Field>
        {canShare ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">Share with</legend>
            {shareable.map((r) => (
              <Checkbox
                key={r.code}
                label={r.name}
                checked={roles.includes(r.code)}
                onCheckedChange={(on) =>
                  setRoles((x) => (on ? [...x, r.code] : x.filter((c) => c !== r.code)))
                }
              />
            ))}
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}
