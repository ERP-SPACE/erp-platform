import type { SeriesItem } from "@erp/contracts";
import { formatDocNo, istToday, validateGstSeries } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  Field,
  Mono,
  Select,
  Switch,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ReasonField } from "../../../components/reason-field.js";
import { api, call, reasonHeader } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { dateTime } from "../../../lib/format.js";
import { can, keys, meQuery, seriesQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/settings/series")({
  validateSearch: z.object({ type: z.string().optional() }),
  component: SeriesPage,
});

const columns: ColumnDef<SeriesItem, unknown>[] = [
  {
    accessorKey: "entityType",
    header: "Code",
    cell: (c) => <Mono className="font-semibold">{c.getValue() as string}</Mono>,
    meta: { width: "5.5rem" },
  },
  { accessorKey: "label", header: "Document" },
  {
    id: "kind",
    header: "Type",
    accessorFn: (r) => (r.gst ? "GST" : "Internal"),
    cell: (c) =>
      c.getValue() === "GST" ? <Badge tone="info">GST document</Badge> : <Badge>Internal</Badge>,
  },
  {
    accessorKey: "nextNumber",
    header: "Next number",
    cell: (c) => (
      <Mono data-testid={`next-${c.row.original.entityType}`}>{c.getValue() as string}</Mono>
    ),
  },
  { accessorKey: "usedThisYear", header: "Used this FY", meta: { numeric: true } },
];

function SeriesPage() {
  const { data: series, isLoading } = useQuery(seriesQuery);
  const { data: me } = useQuery(meQuery);
  const { type } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const selected = type ? series?.find((s) => s.entityType === type) : undefined;

  return (
    <div className="grid gap-4">
      <Card padded={false}>
        <div className="flex items-start gap-3 px-5 py-4 text-sm text-fg-2">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p>
            Numbers never skip and restart every 1 April. Invoices and credit/debit notes get their
            number only when posted, so a cancelled draft never uses one. Click a row to change its
            format.
          </p>
        </div>
      </Card>
      <DataTable
        caption="Document number series"
        data={series ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.entityType}
        selectedId={selected?.entityType ?? null}
        onRowClick={(row) => void navigate({ search: { type: row.entityType }, replace: true })}
        searchPlaceholder="Search documents"
        pageSize={false}
      />
      {selected ? (
        <SeriesDrawer
          key={`${selected.entityType}:${selected.version}`}
          series={selected}
          editable={can(me, "settings.series.update")}
          onClose={() => void navigate({ search: {}, replace: true })}
        />
      ) : null}
    </div>
  );
}

function SeriesDrawer({
  series,
  editable,
  onClose,
}: {
  series: SeriesItem;
  editable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [prefixTemplate, setPrefix] = useState(series.prefixTemplate);
  const [padding, setPadding] = useState(String(series.padding));
  const [resetOnFy, setReset] = useState(series.resetOnFy);
  const [reason, setReason] = useState("");

  const today = istToday();
  const preview = useMemo(() => {
    const format = { prefixTemplate, padding: Number(padding) };
    try {
      return {
        next: formatDocNo(format, today, series.usedThisYear + 1),
        april: formatDocNo(
          format,
          `${Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 4 ? 1 : 0)}-04-01`,
          1,
        ),
        errors: series.gst ? validateGstSeries(format, today) : [],
      };
    } catch (error) {
      return { next: "—", april: "—", errors: [(error as Error).message] };
    }
  }, [prefixTemplate, padding, today, series.usedThisYear, series.gst]);

  const dirty =
    prefixTemplate !== series.prefixTemplate ||
    Number(padding) !== series.padding ||
    resetOnFy !== series.resetOnFy;

  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.PATCH("/api/document-series/{type}", {
          params: { path: { type: series.entityType } },
          headers: reasonHeader(reason),
          body: { prefixTemplate, padding: Number(padding), resetOnFy, version: series.version },
        }),
      ),
    onSuccess: async () => {
      toast({
        tone: "success",
        title: `${series.label} series saved`,
        description: `Next number: ${preview.next}`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.series });
    },
    onError: (error) => onError(error, keys.series),
  });

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${series.label} series`}
      description={`Last changed ${series.updatedByName ? `by ${series.updatedByName}, ` : ""}${dateTime(series.updatedAt)}`}
      footer={
        editable ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!dirty || preview.errors.length > 0}
              busy={save.isPending}
              onClick={() => save.mutate()}
            >
              Save series
            </Button>
          </>
        ) : null
      }
    >
      <div className="grid gap-6">
        <div className="rounded-lg border border-border bg-muted/60 p-4">
          <p className="text-xs font-medium text-fg-3">Next number</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-fg" data-testid="next-number">
            {preview.next}
          </p>
          <p className="mt-2 text-xs text-fg-3">
            {resetOnFy ? (
              <>
                First number next April: <Mono className="text-fg-2">{preview.april}</Mono>
              </>
            ) : (
              "Numbering continues across financial years"
            )}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <Field label="Prefix" hint="{FY} → 2627 · {FY_FULL} → 2026-27" error={preview.errors[0]}>
            {(p) => (
              <TextInput
                {...p}
                disabled={!editable}
                className="font-mono"
                value={prefixTemplate}
                onChange={(e) => setPrefix(e.target.value)}
              />
            )}
          </Field>
          <Field label="Digits">
            {(p) => (
              <Select
                {...p}
                disabled={!editable}
                value={padding}
                onValueChange={setPadding}
                options={[3, 4, 5, 6, 7, 8].map((n) => ({
                  value: String(n),
                  label: `${n} digits`,
                }))}
              />
            )}
          </Field>
        </div>
        <Switch
          label="Restart numbering every 1 April"
          description="Recommended — GST requires numbers to be unique within a financial year."
          checked={resetOnFy}
          onCheckedChange={setReset}
          disabled={!editable}
        />
        {series.gst ? (
          <p className="rounded-md bg-info-soft px-3 py-2 text-xs text-info">
            GST rule: invoice and note numbers must be at most 16 characters, using letters, digits,
            “/” and “-”.
          </p>
        ) : null}
        {editable ? <ReasonField value={reason} onChange={setReason} /> : null}
      </div>
    </Drawer>
  );
}
