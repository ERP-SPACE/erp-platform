import type { GrnDetail, PoDetail } from "@erp/contracts";
import { istToday } from "@erp/domain";
import { Button, Card, Field, FormSection, Select, TextArea, TextInput, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, api, call } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import { nullable, suppliersQuery } from "../lib/masters.js";
import { poListQuery, poQuery } from "../lib/purchase.js";
import { keys } from "../lib/queries.js";
import { type ItemLine, ItemLinesEditor, blankLine, itemSpec, rollMetres } from "./item-lines.js";

/** Lines for the PO's open balance, so the inward desk only types the roll lengths. */
function linesFromPo(po: PoDetail): ItemLine[] {
  const open = po.lines.filter((l) => l.balanceM > 0);
  return (open.length ? open : po.lines).map((l) =>
    blankLine({
      poLineId: l.id,
      skuId: l.skuId ?? "",
      description: l.description,
      gsm: String(l.gsm),
      widthIn: String(l.widthIn),
      qualityName: l.qualityName ?? "",
    }),
  );
}

/** Create or edit a goods receipt (rolls are created when it is posted). */
export function GrnForm({
  grn,
  poId: initialPo,
  onDone,
}: {
  grn?: GrnDetail;
  poId?: string;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const { data: suppliers } = useQuery(suppliersQuery("true"));
  const { data: orders } = useQuery(poListQuery);
  const [poId, setPoId] = useState(grn?.poId ?? initialPo ?? "");
  const po = useQuery({ ...poQuery(poId), enabled: Boolean(poId) });
  const [supplierId, setSupplierId] = useState(grn?.supplierId ?? "");
  const [date, setDate] = useState(grn?.date ?? istToday());
  const [invoiceNo, setInvoiceNo] = useState(grn?.supplierInvoiceNo ?? "");
  const [batchRef, setBatchRef] = useState(grn?.supplierBatchRef ?? "");
  const [vehicle, setVehicle] = useState(grn?.vehicleNo ?? "");
  const [notes, setNotes] = useState(grn?.notes ?? "");
  const [lines, setLines] = useState<ItemLine[]>(
    grn?.lines.map((l) =>
      blankLine({
        poLineId: l.poLineId,
        skuId: l.skuId ?? "",
        description: l.description,
        gsm: String(l.gsm),
        widthIn: String(l.widthIn),
        qualityName: l.qualityName ?? "",
        rolls: l.rolls,
        rejectedRolls: l.rejectedRolls ?? "",
        rejectReason: l.rejectReason ?? "",
      }),
    ) ?? [blankLine()],
  );
  // A newly chosen PO fills the supplier and its open lines once (React's derived-state pattern).
  const [appliedPo, setAppliedPo] = useState<string | null>(grn?.poId ?? null);
  if (!grn && po.data && po.data.id !== appliedPo) {
    setAppliedPo(po.data.id);
    setSupplierId(po.data.supplierId);
    setLines(linesFromPo(po.data));
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const openOrders = (orders ?? []).filter(
    (o) =>
      (o.status === "Approved" || o.status === "PartiallyReceived") &&
      (!supplierId || o.supplierId === supplierId || o.id === poId),
  );
  const totals = lines.reduce(
    (t, l) => {
      const m = rollMetres(l.rolls);
      return m ? { rolls: t.rolls + m.rolls, metres: t.metres + m.metres } : t;
    },
    { rolls: 0, metres: 0 },
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        supplierId,
        poId: poId || null,
        date,
        supplierInvoiceNo: nullable(invoiceNo),
        supplierBatchRef: nullable(batchRef),
        vehicleNo: nullable(vehicle.toUpperCase()),
        notes: nullable(notes),
        lines: lines.map((l) => ({
          ...itemSpec(l),
          poLineId: l.poLineId,
          rolls: l.rolls,
          rejectedRolls: nullable(l.rejectedRolls),
          rejectReason: nullable(l.rejectReason),
        })),
      };
      return grn
        ? call<GrnDetail>(() =>
            api.PATCH("/api/goods-receipts/{id}", {
              params: { path: { id: grn.id } },
              body: { ...body, version: grn.version },
            }),
          )
        : call<GrnDetail>(() => api.POST("/api/goods-receipts", { body }));
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: grn ? "Goods receipt saved" : `${saved.grnNo} saved as draft`,
        description: "Post it to create the rolls and their barcodes.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.purchase });
      if (onDone) onDone();
      else void navigate({ to: "/purchase/receipts/$grnId", params: { grnId: saved.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      onError(error, keys.purchase);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="tnum text-sm text-fg-2">
              {totals.rolls} rolls · {totals.metres.toLocaleString("en-IN")} m
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => (onDone ? onDone() : void navigate({ to: "/purchase/receipts" }))}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={save.isPending} disabled={!supplierId}>
                {grn ? "Save changes" : "Save draft"}
              </Button>
            </div>
          </div>
        }
      >
        <FormSection
          title="Delivery"
          description="Copy the supplier's bill. Roll lengths are taken as the supplier lists them."
        >
          <Field label="Purchase order" hint="Optional — fills the lines with what's still due">
            {(p) => (
              <Select
                {...p}
                value={poId || "none"}
                onValueChange={(v) => setPoId(v === "none" ? "" : v)}
                options={[
                  { value: "none", label: "No purchase order" },
                  ...openOrders.map((o) => ({
                    value: o.id,
                    label: `${o.poNo} · ${o.supplierName}`,
                  })),
                ]}
              />
            )}
          </Field>
          <Field label="Supplier" required error={errors.supplierId}>
            {(p) => (
              <Select
                {...p}
                disabled={Boolean(poId)}
                value={supplierId || undefined}
                onValueChange={setSupplierId}
                placeholder="Choose a supplier"
                options={(suppliers ?? []).map((s) => ({
                  value: s.id,
                  label: `${s.name} · ${s.shortCode}`,
                }))}
              />
            )}
          </Field>
          <Field label="Received on" required>
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Supplier's invoice no.">
            {(p) => (
              <TextInput {...p} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            )}
          </Field>
          <Field label="Supplier's lot / container" hint="e.g. CONT-13 — printed on every label">
            {(p) => (
              <TextInput {...p} value={batchRef} onChange={(e) => setBatchRef(e.target.value)} />
            )}
          </Field>
          <Field label="Vehicle no.">
            {(p) => (
              <TextInput
                {...p}
                className="uppercase"
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
              />
            )}
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            {(p) => (
              <TextArea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </FormSection>
        <FormSection
          title="Rolls received"
          description="Items not in the catalogue arrive as Unmapped and are matched to a product later."
        >
          <div className="sm:col-span-2">
            <ItemLinesEditor mode="grn" lines={lines} onChange={setLines} errors={errors} />
          </div>
        </FormSection>
      </Card>
    </form>
  );
}
