import { REPORTS, REPORT_IDS, type ReportId, type ReportResponse } from "@erp/contracts";
import { fyRange, istToday } from "@erp/domain";
import {
  Button,
  Card,
  DataTable,
  DropdownMenu,
  Field,
  PageHeader,
  Segmented,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileSpreadsheet, FileText, Sheet } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { SeriesBars } from "../../../components/charts.js";
import { crumbLink } from "../../../components/sales-bits.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { can, meQuery } from "../../../lib/queries.js";
import {
  NUMERIC_KINDS,
  SECTION_LABEL,
  asOfLabel,
  formatCell,
  linkTarget,
  reportKeys,
  reportQuery,
  requestExport,
} from "../../../lib/reports.js";

export const Route = createFileRoute("/_app/reports/$reportId")({
  params: {
    parse: (p) => {
      if (!REPORT_IDS.includes(p.reportId as ReportId)) throw notFound();
      return { reportId: p.reportId as ReportId };
    },
    stringify: (p) => p,
  },
  validateSearch: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    grain: z.enum(["day", "month", "quarter", "fy"]).optional(),
    groupBy: z.string().optional(),
    q: z.string().optional(),
    customerId: z.string().optional(),
    supplierId: z.string().optional(),
    salesmanId: z.string().optional(),
    skuId: z.string().optional(),
  }),
  component: ReportPage,
});

/** Reports that group by period, and the groupings a report offers (first = default). */
const GRAIN_REPORTS = new Set<ReportId>([
  "sales-trend",
  "discount-impact",
  "gross-margin",
  "scrap-impact",
]);
const GROUPINGS: Partial<Record<ReportId, { value: string; label: string }[]>> = {
  "sales-trend": [
    { value: "customer", label: "Customer" },
    { value: "customerGroup", label: "Group" },
  ],
  "gross-margin": [
    { value: "month", label: "Period" },
    { value: "sku", label: "SKU" },
    { value: "customer", label: "Customer" },
  ],
};
const FILTER_LABEL: Record<string, string> = {
  customerId: "customer",
  supplierId: "supplier",
  salesmanId: "salesman",
  skuId: "SKU",
};

type Row = ReportResponse["rows"][number];

function ReportPage() {
  const { reportId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const meta = REPORTS[reportId];
  const dated = "dated" in meta && meta.dated;
  const { data: me } = useQuery(meQuery);
  const { data, isLoading, isFetching } = useQuery(reportQuery(reportId, search));
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [q, setQ] = useState(search.q ?? "");
  useEffect(() => {
    const h = setTimeout(() => {
      if ((search.q ?? "") !== q)
        void navigate({ search: (s) => ({ ...s, q: q || undefined }), replace: true });
    }, 300);
    return () => clearTimeout(h);
  }, [q, search.q, navigate]);

  const exp = useMutation({
    mutationFn: (format: "csv" | "xlsx" | "pdf") =>
      requestExport({
        kind: "report",
        reportId,
        query: { ...search, page: 1, pageSize: 100 },
        format,
      }),
    onSuccess: async (e) => {
      toast({
        tone: "success",
        title: `${e.title} is being prepared`,
        description: "It will be in My exports in a moment.",
      });
      await queryClient.invalidateQueries({ queryKey: reportKeys.exports });
    },
    onError: (e) => onError(e),
  });

  const columns: ColumnDef<Row, unknown>[] = (data?.columns ?? []).map((c, i) => ({
    id: c.key,
    header: c.label,
    meta: NUMERIC_KINDS.has(c.kind) ? { numeric: true } : undefined,
    accessorFn: (r) => {
      const v = r.cells[c.key];
      return NUMERIC_KINDS.has(c.kind) && v !== null ? Number(v) : v;
    },
    cell: ({ row }) => {
      const v = row.original.cells[c.key] ?? null;
      const text = formatCell(c.kind, v);
      const link = row.original.links?.[c.key];
      const target = link ? linkTarget(link) : null;
      const negative = (c.kind === "money" || c.kind === "percent") && v !== null && Number(v) < 0;
      const body = (
        <span
          className={
            negative ? "text-danger" : c.kind === "code" ? "font-mono text-[13px]" : undefined
          }
        >
          {negative ? `(${formatCell(c.kind, String(Math.abs(Number(v))))})` : text}
        </span>
      );
      return (
        <span className="inline-flex items-center gap-2">
          {i === 0 && row.original.tone ? (
            <span
              className={`size-2 shrink-0 rounded-full ${row.original.tone === "danger" ? "bg-danger" : "bg-warning"}`}
              role="img"
              aria-label={row.original.tone === "danger" ? "Needs action" : "Watch"}
            />
          ) : null}
          {target ? (
            <Link
              to={target.to}
              params={target.params}
              search={target.search}
              className="text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {body}
            </Link>
          ) : (
            body
          )}
        </span>
      );
    },
  }));

  const today = istToday();
  const from = search.from ?? data?.from ?? fyRange(today).from;
  const to = search.to ?? data?.to ?? today;
  const groupings = GROUPINGS[reportId];
  const filters = Object.keys(FILTER_LABEL).filter((k) => search[k as keyof typeof search]);
  const seriesMoney = !(reportId === "batch-aging");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={meta.title}
        description={`${meta.description.replace(/.$/, "")}${data?.asOf ? ` · ${asOfLabel(data.asOf)}` : meta.source === "live" ? " · live" : ""}`}
        breadcrumbs={[
          { label: "Reports", href: "/reports" },
          { label: SECTION_LABEL[meta.section] },
          { label: meta.title },
        ]}
        renderLink={crumbLink}
        actions={
          can(me, "reports.export") ? (
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
          ) : null
        }
      />
      {dated || groupings || GRAIN_REPORTS.has(reportId) || filters.length ? (
        <Card>
          <div className="flex flex-wrap items-end gap-4">
            {dated ? (
              <>
                <Field label="From">
                  {(p) => (
                    <TextInput
                      {...p}
                      type="date"
                      value={from}
                      onChange={(e) =>
                        void navigate({
                          search: (s) => ({ ...s, from: e.target.value || undefined }),
                        })
                      }
                    />
                  )}
                </Field>
                <Field label="To">
                  {(p) => (
                    <TextInput
                      {...p}
                      type="date"
                      value={to}
                      onChange={(e) =>
                        void navigate({
                          search: (s) => ({ ...s, to: e.target.value || undefined }),
                        })
                      }
                    />
                  )}
                </Field>
              </>
            ) : null}
            {groupings ? (
              <Segmented
                label="Group by"
                value={search.groupBy ?? groupings[0]!.value}
                onValueChange={(v) => void navigate({ search: (s) => ({ ...s, groupBy: v }) })}
                options={groupings}
              />
            ) : null}
            {GRAIN_REPORTS.has(reportId) &&
            (!groupings || (search.groupBy ?? groupings[0]!.value) === "month") ? (
              <Segmented
                label="Period"
                value={search.grain ?? "month"}
                onValueChange={(v) => void navigate({ search: (s) => ({ ...s, grain: v }) })}
                options={[
                  { value: "day", label: "Day" },
                  { value: "month", label: "Month" },
                  { value: "quarter", label: "Quarter" },
                  { value: "fy", label: "Year" },
                ]}
              />
            ) : null}
            {filters.map((k) => (
              <Button
                key={k}
                size="sm"
                variant="secondary"
                onClick={() => void navigate({ search: (s) => ({ ...s, [k]: undefined }) })}
              >
                Filtered to one {FILTER_LABEL[k]} · clear
              </Button>
            ))}
          </div>
        </Card>
      ) : null}
      {data?.series?.length ? (
        <Card
          title={
            reportId === "gross-margin"
              ? "Gross margin by period"
              : reportId === "batch-aging"
                ? "Metres by age"
                : "By period"
          }
        >
          <SeriesBars data={data.series} caption={`${meta.title} by period`} money={seriesMoney} />
        </Card>
      ) : null}
      <DataTable
        caption={meta.title}
        data={data?.rows ?? []}
        loading={isLoading || (isFetching && !data)}
        columns={columns}
        getRowId={(r) => JSON.stringify(r.cells)}
        searchPlaceholder="Search"
        search={q}
        onSearchChange={setQ}
        pageSize={50}
        empty="Nothing to show for these filters."
      />
      {data?.totals ? (
        <Card>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm" aria-label="Totals">
            {data.columns
              .filter((c) => c.total)
              .map((c) => (
                <div key={c.key} className="grid gap-0.5">
                  <dt className="text-xs text-fg-2">{c.label}</dt>
                  <dd className="tnum font-semibold text-fg">
                    {formatCell(c.kind, data.totals![c.key] ?? null)}
                  </dd>
                </div>
              ))}
            <div className="grid gap-0.5">
              <dt className="text-xs text-fg-2">Rows</dt>
              <dd className="tnum font-semibold text-fg">{data.total.toLocaleString("en-IN")}</dd>
            </div>
          </dl>
          {data.total > data.rows.length ? (
            <p className="mt-3 text-xs text-fg-2">
              Showing the first {data.rows.length.toLocaleString("en-IN")} rows; totals cover all{" "}
              {data.total.toLocaleString("en-IN")}. Export for every row.
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
