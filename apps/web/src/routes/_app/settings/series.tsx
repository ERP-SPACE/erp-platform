import type { SeriesItem } from "@erp/contracts";
import { formatDocNo, istToday, validateGstSeries } from "@erp/domain";
import {
  Button,
  Field,
  MarginNote,
  Mono,
  Register,
  Select,
  Sheet,
  SheetLayout,
  StatusMark,
  Switch,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
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
    header: "Type",
    cell: (c) => <Mono className="font-medium">{c.getValue() as string}</Mono>,
    meta: { width: "5rem" },
  },
  { accessorKey: "label", header: "Document" },
  {
    accessorKey: "nextNumber",
    header: "Next number",
    cell: (c) => <Mono>{c.getValue() as string}</Mono>,
  },
  { accessorKey: "usedThisYear", header: "Used this FY", meta: { numeric: true } },
];

function SeriesPage() {
  const { data: series } = useQuery(seriesQuery);
  const { data: me } = useQuery(meQuery);
  const { type } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const selected = series?.find((s) => s.entityType === (type ?? "SI")) ?? series?.[0];
  if (!series || !selected) return null;

  return (
    <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <Register
        caption="Document number series"
        data={series}
        columns={columns}
        getRowId={(r) => r.entityType}
        selectedId={selected.entityType}
        onSelect={(row) => void navigate({ search: { type: row.entityType }, replace: true })}
      />
      <SeriesSheet
        key={`${selected.entityType}:${selected.version}`}
        series={selected}
        editable={can(me, "settings.series.update")}
      />
    </div>
  );
}

function SeriesSheet({ series, editable }: { series: SeriesItem; editable: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [prefixTemplate, setPrefix] = useState(series.prefixTemplate);
  const [padding, setPadding] = useState(String(series.padding));
  const [resetOnFy, setReset] = useState(series.resetOnFy);
  const [reason, setReason] = useState(""); // resets per series: the parent keys this sheet by type + version

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
        tone: "positive",
        title: `${series.label} series saved`,
        description: `Next number: ${preview.next}`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.series });
    },
    onError: (error) => onError(error, keys.series),
  });

  return (
    <SheetLayout
      sheet={
        <Sheet
          kicker={`${series.entityType} series`}
          title={series.label}
          number={<span data-testid="next-number">{preview.next}</span>}
          status={
            series.gst ? (
              <StatusMark tone="info">GST document</StatusMark>
            ) : (
              <StatusMark>Internal</StatusMark>
            )
          }
          footer={
            editable ? (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <ReasonField value={reason} onChange={setReason} />
                <Button
                  variant="primary"
                  disabled={!dirty || preview.errors.length > 0}
                  busy={save.isPending}
                  onClick={() => save.mutate()}
                >
                  Save series
                </Button>
              </div>
            ) : null
          }
        >
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Field
              label="Prefix"
              hint="{FY} → 2627 · {FY_FULL} → 2026-27"
              error={preview.errors[0]}
            >
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
            <div className="sm:col-span-2">
              <Switch
                label="Restart numbering every 1 April"
                checked={resetOnFy}
                onCheckedChange={setReset}
                disabled={!editable}
              />
            </div>
          </div>

          <dl className="mt-8 grid gap-4 border-t border-rule pt-6 sm:grid-cols-2">
            <div>
              <dt className="smallcaps mb-1">Next number</dt>
              <dd>
                <Mono className="text-lg text-ink">{preview.next}</Mono>
              </dd>
            </div>
            <div>
              <dt className="smallcaps mb-1">
                {resetOnFy ? "First number next April" : "Numbering"}
              </dt>
              <dd>
                {resetOnFy ? (
                  <Mono className="text-lg text-ink-2">{preview.april}</Mono>
                ) : (
                  <span className="text-sm text-ink-2">Continues across years</span>
                )}
              </dd>
            </div>
          </dl>
        </Sheet>
      }
      margin={
        <>
          <MarginNote title="How numbering works">
            Numbers never skip.{" "}
            {series.numberedOn === "post"
              ? "This document gets its number only when it is posted, so a cancelled draft doesn't use one."
              : "This document is numbered when it is created."}
          </MarginNote>
          {series.gst ? (
            <MarginNote title="GST rule">
              Tax invoice and note numbers must be unique for the year and at most 16 characters,
              using letters, digits, “/” and “-”.
            </MarginNote>
          ) : null}
          <MarginNote title="Last changed">
            {series.updatedByName ? `${series.updatedByName}, ` : ""}
            <span className="tnum">{dateTime(series.updatedAt)}</span>
          </MarginNote>
        </>
      }
    />
  );
}
