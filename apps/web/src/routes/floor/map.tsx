import type { RollInspector } from "@erp/contracts";
import { Button, Field, Select, useToast } from "@erp/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Link2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useSkuOptions } from "../../components/item-lines.js";
import { ScanInput } from "../../components/scan-input.js";
import { ApiError, api, call } from "../../lib/api.js";
import { useApiErrorToast } from "../../lib/errors.js";
import { scanFeedback, useStoredList } from "../../lib/floor.js";
import { rollQuery } from "../../lib/purchase.js";
import { keys } from "../../lib/queries.js";

export const Route = createFileRoute("/floor/map")({
  validateSearch: z.object({ add: z.string().optional() }),
  component: FloorMap,
});

type Picked = Pick<
  RollInspector,
  "id" | "barcode" | "description" | "gsm" | "widthIn" | "currentLengthM"
>;

/**
 * Map unmapped rolls in the godown: scan a run of rolls of one GSM and width, pick the product,
 * map. The batch is kept on the phone, so a Wi-Fi drop never loses the scans. New products are
 * created from the office Unmapped screen.
 */
function FloorMap() {
  const { add } = Route.useSearch();
  const [batch, setBatch] = useStoredList<Picked>("erp:floor:map", 2000);
  const [skuId, setSkuId] = useState("");
  const [problem, setProblem] = useState<string>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const allSkus = useSkuOptions();
  const spec = batch[0];
  const skus = useMemo(
    () =>
      spec
        ? allSkus.filter((s) => s.gsm === spec.gsm && Number(s.widthIn) === Number(spec.widthIn))
        : [],
    [allSkus, spec],
  );

  const addRoll = useCallback(
    async (code: string) => {
      setProblem(undefined);
      if (batch.some((r) => r.barcode === code))
        return setProblem(`${code} is already in this batch.`);
      try {
        const r = await queryClient.fetchQuery({ ...rollQuery(code), retry: 2 });
        if (r.status !== "Unmapped")
          throw new Error(`${code} is already ${r.status.toLowerCase()} — nothing to map.`);
        if (spec && (r.gsm !== spec.gsm || Number(r.widthIn) !== Number(spec.widthIn))) {
          throw new Error(
            `${code} is ${r.gsm} GSM · ${r.widthIn}″; this batch is ${spec.gsm} GSM · ${spec.widthIn}″.`,
          );
        }
        const { id, barcode, description, gsm, widthIn, currentLengthM } = r;
        setBatch([{ id, barcode, description, gsm, widthIn, currentLengthM }, ...batch]);
      } catch (e) {
        scanFeedback(false);
        setProblem(
          e instanceof ApiError
            ? e.status === 404
              ? `No roll has barcode ${code}.`
              : "Couldn't look it up — check the connection and scan again."
            : (e as Error).message,
        );
      }
    },
    [batch, queryClient, setBatch, spec],
  );

  // Arriving from the scan screen with a roll: add it once.
  useEffect(() => {
    if (add) void addRoll(add);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add]);

  const map = useMutation({
    mutationFn: () =>
      call<{ mapped: number }>(() =>
        api.POST("/api/rolls/map", { body: { rollIds: batch.map((r) => r.id), skuId } }),
      ),
    retry: (n, e) => n < 3 && !(e instanceof ApiError),
    onSuccess: async (r) => {
      toast({ tone: "success", title: `${r.mapped} rolls mapped` });
      setBatch([]);
      setSkuId("");
      await queryClient.invalidateQueries({ queryKey: keys.inventory });
    },
    onError: (e) => onError(e),
  });

  const totalM = batch.reduce((s, r) => s + r.currentLengthM, 0);
  return (
    <div className="grid gap-5">
      <ScanInput onScan={addRoll} label="Scan unmapped rolls" />
      {problem ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 font-medium text-danger"
        >
          {problem}
        </p>
      ) : null}
      {spec ? (
        <section className="grid gap-4 rounded-xl bg-surface p-5 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-fg">
              {batch.length} {batch.length === 1 ? "roll" : "rolls"} · {spec.gsm} GSM ·{" "}
              {spec.widthIn}″
            </h2>
            <span className="tnum text-fg-2">{totalM.toLocaleString("en-IN")} m</span>
          </div>
          {skus.length ? (
            <Field label="Map to product">
              {(p) => (
                <Select
                  {...p}
                  value={skuId || undefined}
                  onValueChange={setSkuId}
                  placeholder="Choose a product"
                  options={skus.map((s) => ({ value: s.id, label: s.label }))}
                />
              )}
            </Field>
          ) : (
            <p className="text-fg-3">
              No product is {spec.gsm} GSM at {spec.widthIn}″ yet. Ask the office to create it from
              Unmapped.
            </p>
          )}
          <Button
            variant="primary"
            icon={Link2}
            className="h-12 text-base"
            disabled={!skuId}
            busy={map.isPending}
            onClick={() => map.mutate()}
          >
            Map {batch.length} {batch.length === 1 ? "roll" : "rolls"}
          </Button>
          <ul className="divide-y divide-border">
            {batch.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-fg">{r.barcode}</p>
                  <p className="text-sm text-fg-3">{r.currentLengthM.toLocaleString("en-IN")} m</p>
                </div>
                <Button
                  variant="ghost"
                  icon={X}
                  aria-label={`Remove ${r.barcode}`}
                  className="size-11"
                  onClick={() => setBatch(batch.filter((x) => x.id !== r.id))}
                />
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => setBatch([])}>
            Clear batch
          </Button>
        </section>
      ) : (
        <p className="rounded-xl bg-surface p-6 text-center text-fg-3 shadow-card">
          Scan the first roll. Every roll in a batch must be the same GSM and width.
        </p>
      )}
    </div>
  );
}
