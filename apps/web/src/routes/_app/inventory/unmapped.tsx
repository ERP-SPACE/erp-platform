import type { RollItem } from "@erp/contracts";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Segmented,
  Select,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSkuOptions } from "../../../components/item-lines.js";
import { RollTable } from "../../../components/roll-table.js";
import { api, call } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { categoriesQuery, qualitiesQuery, settingValue } from "../../../lib/masters.js";
import { rollsQuery } from "../../../lib/purchase.js";
import { can, keys, meQuery, settingsQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/inventory/unmapped")({ component: UnmappedPage });

/** Unmapped staging (PRD §6.2): rolls received without a known product, waiting to be matched. */
function UnmappedPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(rollsQuery({ status: "Unmapped" }));
  const [selected, setSelected] = useState<string[]>([]);
  const [mapping, setMapping] = useState(false);
  const rolls = data?.items ?? [];
  const chosen = rolls.filter((r) => selected.includes(r.id));
  const sameSpec =
    chosen.length > 0 &&
    chosen.every((r) => r.gsm === chosen[0]!.gsm && r.widthIn === chosen[0]!.widthIn);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Unmapped rolls"
        description="Received without a matching product. Select rolls of the same GSM and width, then map them."
        breadcrumbs={[{ label: "Inventory" }, { label: "Unmapped rolls" }]}
        actions={
          can(me, "inventory.map") ? (
            <Button
              variant="primary"
              icon={Link2}
              disabled={!sameSpec}
              onClick={() => setMapping(true)}
              title={chosen.length && !sameSpec ? "Select rolls of one GSM and width" : undefined}
            >
              Map {chosen.length || ""} rolls
            </Button>
          ) : null
        }
      />
      {chosen.length && !sameSpec ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          The selected rolls differ in GSM or width — map each spec separately.
        </p>
      ) : null}
      <Card padded={false}>
        {!isLoading && rolls.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting"
            hint="Every received roll is matched to a product."
          />
        ) : (
          <RollTable
            caption="Unmapped rolls"
            rolls={rolls}
            loading={isLoading}
            selectable={can(me, "inventory.map")}
            onSelectionChange={setSelected}
          />
        )}
      </Card>
      {mapping && sameSpec ? <MapDialog rolls={chosen} onClose={() => setMapping(false)} /> : null}
    </div>
  );
}

function MapDialog({ rolls, onClose }: { rolls: RollItem[]; onClose: () => void }) {
  const spec = rolls[0]!;
  const skus = useSkuOptions().filter(
    (s) => Number(s.widthIn) === Number(spec.widthIn) && s.gsm === spec.gsm,
  );
  const { data: categories } = useQuery(categoriesQuery);
  const { data: qualities } = useQuery(qualitiesQuery);
  const { data: settings } = useQuery(settingsQuery);
  const lengths = settingValue<number[]>(settings, "catalogue.allowedLengthsM", [1000]);
  const [mode, setMode] = useState<"existing" | "create">(skus.length ? "existing" : "create");
  const [skuId, setSkuId] = useState(skus[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [qualityId, setQualityId] = useState(
    () =>
      qualities?.find((q) => q.name.toLowerCase() === spec.qualityName?.toLowerCase())?.id ?? "",
  );
  const defaultLength = useMemo(
    () => (lengths.includes(spec.originalLengthM) ? spec.originalLengthM : (lengths[0] ?? 1000)),
    [lengths, spec.originalLengthM],
  );
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const map = useMutation({
    mutationFn: () =>
      call<{ mapped: number }>(() =>
        api.POST("/api/rolls/map", {
          body:
            mode === "existing"
              ? { rollIds: rolls.map((r) => r.id), skuId }
              : {
                  rollIds: rolls.map((r) => r.id),
                  createSku: {
                    categoryId,
                    qualityId,
                    gsm: spec.gsm,
                    widthIn: Number(spec.widthIn),
                    defaultLengthM: defaultLength,
                  },
                },
        }),
      ),
    onSuccess: async (r) => {
      toast({ tone: "success", title: `${r.mapped} rolls mapped` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.inventory }),
        queryClient.invalidateQueries({ queryKey: keys.catalogue }),
      ]);
      onClose();
    },
    onError: (e) => onError(e),
  });
  const ready = mode === "existing" ? Boolean(skuId) : Boolean(categoryId && qualityId);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Map ${rolls.length} rolls`}
      description={`${spec.gsm} GSM · ${spec.widthIn}″ — e.g. "${spec.description}"`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            busy={map.isPending}
            onClick={() => map.mutate()}
          >
            Map rolls
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Segmented
          label="Map to"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "existing", label: "Existing product" },
            { value: "create", label: "New product" },
          ]}
        />
        {mode === "existing" ? (
          skus.length ? (
            <Field label="Product (SKU)">
              {(p) => (
                <Select
                  {...p}
                  value={skuId || undefined}
                  onValueChange={setSkuId}
                  options={skus.map((s) => ({ value: s.id, label: s.label }))}
                />
              )}
            </Field>
          ) : (
            <p className="text-sm text-fg-3">
              No catalogue product is {spec.gsm} GSM at {spec.widthIn}″ yet — create one.
            </p>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required>
              {(p) => (
                <Select
                  {...p}
                  value={categoryId || undefined}
                  onValueChange={setCategoryId}
                  placeholder="Choose"
                  options={(categories ?? [])
                    .filter((c) => c.active)
                    .map((c) => ({ value: c.id, label: c.name }))}
                />
              )}
            </Field>
            <Field label="Quality" required>
              {(p) => (
                <Select
                  {...p}
                  value={qualityId || undefined}
                  onValueChange={setQualityId}
                  placeholder="Choose"
                  options={(qualities ?? [])
                    .filter((q) => q.active)
                    .map((q) => ({ value: q.id, label: q.name }))}
                />
              )}
            </Field>
            <p className="text-xs text-fg-3 sm:col-span-2">
              Creates {spec.gsm} GSM at {spec.widthIn}″ (standard length{" "}
              {defaultLength.toLocaleString("en-IN")} m), or adds the width to an existing product.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
