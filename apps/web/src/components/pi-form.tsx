import type { GrnDetail, PiDetail } from "@erp/contracts";
import { D, formatINR, invoiceTotals, istToday, taxLine } from "@erp/domain";
import {
  Button,
  Card,
  Checkbox,
  Field,
  FormSection,
  NumberInput,
  Select,
  TextArea,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ApiError, api, call } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import { categoriesQuery, nullable, productsQuery, suppliersQuery } from "../lib/masters.js";
import { grnListQuery, grnQuery, poListQuery, poQuery } from "../lib/purchase.js";
import { keys } from "../lib/queries.js";
import { type ItemLine, ItemLinesEditor, blankLine, itemSpec } from "./item-lines.js";

/** Create or edit a draft purchase invoice — line for line as the supplier's tax invoice. */
export function PiForm({
  pi,
  grnId: fromGrn,
  onDone,
}: {
  pi?: PiDetail;
  grnId?: string;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const { data: suppliers } = useQuery(suppliersQuery("true"));
  const { data: grns } = useQuery(grnListQuery);
  const { data: orders } = useQuery(poListQuery);
  const { data: products } = useQuery(productsQuery);
  const { data: categories } = useQuery(categoriesQuery);
  const seedGrn = useQuery({ ...grnQuery(fromGrn ?? ""), enabled: Boolean(fromGrn) && !pi });
  const [supplierId, setSupplierId] = useState(pi?.supplierId ?? "");
  const [invoiceNo, setInvoiceNo] = useState(pi?.supplierInvoiceNo ?? "");
  const [invoiceDate, setInvoiceDate] = useState(pi?.supplierInvoiceDate ?? istToday());
  const [poId, setPoId] = useState(pi?.poId ?? "");
  const po = useQuery({ ...poQuery(poId), enabled: Boolean(poId) });
  const [grnIds, setGrnIds] = useState<string[]>(pi?.grnIds ?? []);
  const [irn, setIrn] = useState(pi?.irn ?? "");
  const [eway, setEway] = useState(pi?.ewayBillNo ?? "");
  const [roundOff, setRoundOff] = useState(pi?.totals.roundOff ?? "0");
  const [notes, setNotes] = useState(pi?.notes ?? "");
  const [lines, setLines] = useState<ItemLine[]>(
    pi?.lines.map((l) =>
      blankLine({
        poLineId: l.poLineId,
        skuId: l.skuId ?? "",
        description: l.description,
        gsm: String(l.gsm),
        widthIn: String(l.widthIn),
        qualityName: l.qualityName ?? "",
        quantityM: String(l.quantityM),
        ratePerM: l.ratePerM,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
        hsnCode: l.hsnCode,
      }),
    ) ?? [blankLine()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hsnFor = (skuId: string | null) => {
    const product = products?.find((p) => p.skus.some((s) => s.id === skuId));
    const category = categories?.find((c) => c.id === product?.categoryId);
    return { hsn: category?.hsnCode ?? "", gst: category?.gstRate ?? "18" };
  };
  // Starting from a goods receipt: one line per GRN line, rate from its PO line, HSN from the category.
  const [seeded, setSeeded] = useState(false);
  if (!pi && !seeded && seedGrn.data && products && categories && (!seedGrn.data.poId || po.data)) {
    const g: GrnDetail = seedGrn.data;
    setSeeded(true);
    setSupplierId(g.supplierId);
    setGrnIds([g.id]);
    if (g.supplierInvoiceNo) setInvoiceNo(g.supplierInvoiceNo);
    if (g.poId && !poId) setPoId(g.poId);
    setLines(
      g.lines.map((l) => {
        const poLine = po.data?.lines.find((pl) => pl.id === l.poLineId);
        const tax = hsnFor(l.skuId);
        return blankLine({
          poLineId: l.poLineId,
          skuId: l.skuId ?? "",
          description: l.description,
          gsm: String(l.gsm),
          widthIn: String(l.widthIn),
          qualityName: l.qualityName ?? "",
          quantityM: String(l.acceptedM),
          ratePerM: poLine?.ratePerM ?? "",
          gstRate: poLine?.gstRate ?? tax.gst,
          hsnCode: tax.hsn,
        });
      }),
    );
  }
  if (!pi && fromGrn && seedGrn.data?.poId && !poId) setPoId(seedGrn.data.poId);

  const supplier = suppliers?.find((s) => s.id === supplierId);
  const regime = supplier && supplier.stateCode !== "24" ? "IGST" : "CGST_SGST";
  const totals = useMemo(() => {
    try {
      const t = invoiceTotals(
        lines
          .filter((l) => l.quantityM && l.ratePerM)
          .map((l) =>
            taxLine({
              quantity: l.quantityM,
              rate: l.ratePerM,
              discountPct: l.discountPct || 0,
              gstRate: l.gstRate,
            }),
          ),
        regime,
        0,
      );
      return { ...t, total: t.beforeRoundOff.plus(D(roundOff || 0)) };
    } catch {
      return null;
    }
  }, [lines, regime, roundOff]);
  const linkable = (grns ?? []).filter((g) => g.status === "Posted" && g.supplierId === supplierId);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        supplierId,
        supplierInvoiceNo: invoiceNo.trim(),
        supplierInvoiceDate: invoiceDate,
        poId: poId || null,
        grnIds,
        irn: nullable(irn),
        ewayBillNo: nullable(eway),
        roundOff: roundOff || "0",
        notes: nullable(notes),
        lines: lines.map((l) => ({
          ...itemSpec(l),
          poLineId: l.poLineId,
          hsnCode: l.hsnCode,
          quantityM: Number(l.quantityM),
          ratePerM: l.ratePerM,
          discountPct: l.discountPct || "0",
          gstRate: l.gstRate as "18",
        })),
      };
      return pi
        ? call<PiDetail>(() =>
            api.PATCH("/api/purchase-invoices/{id}", {
              params: { path: { id: pi.id } },
              body: { ...body, version: pi.version },
            }),
          )
        : call<PiDetail>(() => api.POST("/api/purchase-invoices", { body }));
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: "Purchase invoice saved as draft",
        description: `Total ${formatINR(saved.totals.total)} — check it against the supplier's bill, then post.`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.purchase });
      if (onDone) onDone();
      else void navigate({ to: "/purchase/invoices/$piId", params: { piId: saved.id } });
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
            {totals ? (
              <p className="tnum text-sm text-fg-2">
                Taxable {formatINR(totals.taxable)} ·{" "}
                {regime === "IGST"
                  ? `IGST ${formatINR(totals.igst)}`
                  : `CGST ${formatINR(totals.cgst)} + SGST ${formatINR(totals.sgst)}`}{" "}
                · <strong className="text-fg">Total {formatINR(totals.total)}</strong>
              </p>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => (onDone ? onDone() : void navigate({ to: "/purchase/invoices" }))}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                busy={save.isPending}
                disabled={!supplierId || !invoiceNo.trim()}
              >
                {pi ? "Save changes" : "Save draft"}
              </Button>
            </div>
          </div>
        }
      >
        <FormSection
          title="Supplier's invoice"
          description="Enter it as printed, including their round-off, so our total matches theirs exactly."
        >
          <Field label="Supplier" required error={errors.supplierId}>
            {(p) => (
              <Select
                {...p}
                value={supplierId || undefined}
                onValueChange={setSupplierId}
                placeholder="Choose a supplier"
                options={(suppliers ?? []).map((s) => ({
                  value: s.id,
                  label: `${s.name} · ${s.code}`,
                }))}
              />
            )}
          </Field>
          <Field label="Invoice no." required error={errors.supplierInvoiceNo}>
            {(p) => (
              <TextInput {...p} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            )}
          </Field>
          <Field label="Invoice date" required>
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Purchase order">
            {(p) => (
              <Select
                {...p}
                value={poId || "none"}
                onValueChange={(v) => setPoId(v === "none" ? "" : v)}
                options={[
                  { value: "none", label: "No purchase order" },
                  ...(orders ?? [])
                    .filter((o) => o.supplierId === supplierId)
                    .map((o) => ({ value: o.id, label: o.poNo })),
                ]}
              />
            )}
          </Field>
          <Field label="Round-off on their bill" hint="e.g. 0.12 or -0.48" error={errors.roundOff}>
            {(p) => (
              <NumberInput
                {...p}
                allowNegative
                decimals={2}
                prefix="₹"
                value={roundOff}
                onValueChange={setRoundOff}
              />
            )}
          </Field>
          <Field label="IRN">
            {(p) => (
              <TextInput
                {...p}
                className="font-mono text-xs"
                value={irn}
                onChange={(e) => setIrn(e.target.value)}
              />
            )}
          </Field>
          <Field label="E-way bill no.">
            {(p) => <TextInput {...p} value={eway} onChange={(e) => setEway(e.target.value)} />}
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-fg">Goods receipts covered</legend>
            {linkable.length ? (
              <div className="flex flex-wrap gap-4">
                {linkable.map((g) => (
                  <Checkbox
                    key={g.id}
                    label={`${g.grnNo} · ${g.rollCount} rolls`}
                    checked={grnIds.includes(g.id)}
                    onCheckedChange={(on) =>
                      setGrnIds(on ? [...grnIds, g.id] : grnIds.filter((x) => x !== g.id))
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-fg-3">
                None yet — goods can arrive after the invoice; link them once received.
              </p>
            )}
            {errors.grnIds ? <p className="mt-1 text-xs text-danger">{errors.grnIds}</p> : null}
          </fieldset>
          <Field label="Notes" className="sm:col-span-2">
            {(p) => (
              <TextArea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </FormSection>
        <FormSection
          title="Lines"
          description="Lines without a purchase-order line need a reason when you post."
        >
          <div className="sm:col-span-2">
            <ItemLinesEditor mode="pi" lines={lines} onChange={setLines} errors={errors} />
          </div>
        </FormSection>
      </Card>
    </form>
  );
}
