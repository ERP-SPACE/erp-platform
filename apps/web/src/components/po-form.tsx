import type { PoDetail } from "@erp/contracts";
import { istToday } from "@erp/domain";
import { Button, Card, Field, FormSection, Select, TextArea, TextInput, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, api, call } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import { nullable, suppliersQuery } from "../lib/masters.js";
import { keys } from "../lib/queries.js";
import { type ItemLine, ItemLinesEditor, blankLine, itemSpec } from "./item-lines.js";

/** Create or edit a draft purchase order. */
export function PoForm({ po, onDone }: { po?: PoDetail; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const { data: suppliers } = useQuery(suppliersQuery("true"));
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? "");
  const [date, setDate] = useState(po?.date ?? istToday());
  const [expectedDate, setExpected] = useState(po?.expectedDate ?? "");
  const [notes, setNotes] = useState(po?.notes ?? "");
  const [lines, setLines] = useState<ItemLine[]>(
    po?.lines.map((l) =>
      blankLine({
        skuId: l.skuId ?? "",
        description: l.description,
        gsm: String(l.gsm),
        widthIn: String(l.widthIn),
        qualityName: l.qualityName ?? "",
        quantityM: String(l.quantityM),
        ratePerM: l.ratePerM,
        gstRate: l.gstRate,
      }),
    ) ?? [blankLine()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const body = {
        supplierId,
        date,
        expectedDate: expectedDate || null,
        notes: nullable(notes),
        lines: lines.map((l) => ({
          ...itemSpec(l),
          quantityM: Number(l.quantityM),
          ratePerM: l.ratePerM,
          gstRate: l.gstRate as "18",
        })),
      };
      return po
        ? call<PoDetail>(() =>
            api.PATCH("/api/purchase-orders/{id}", {
              params: { path: { id: po.id } },
              body: { ...body, version: po.version },
            }),
          )
        : call<PoDetail>(() => api.POST("/api/purchase-orders", { body }));
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: po ? "Purchase order saved" : `Purchase order ${saved.poNo} created`,
        description: "Approve it to start receiving goods.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.purchase });
      if (onDone) onDone();
      else void navigate({ to: "/purchase/orders/$poId", params: { poId: saved.id } });
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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => (onDone ? onDone() : void navigate({ to: "/purchase/orders" }))}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={save.isPending} disabled={!supplierId}>
              {po ? "Save changes" : "Create purchase order"}
            </Button>
          </div>
        }
      >
        <FormSection
          title="Order"
          description="Rates are ₹ per metre. Use the 44″ helper to derive each width's rate."
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
          <Field label="Order date" required error={errors.date}>
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Expected by">
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={expectedDate}
                onChange={(e) => setExpected(e.target.value)}
              />
            )}
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            {(p) => (
              <TextArea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </FormSection>
        <FormSection title="Lines">
          <div className="sm:col-span-2">
            <ItemLinesEditor mode="po" lines={lines} onChange={setLines} errors={errors} />
          </div>
        </FormSection>
      </Card>
    </form>
  );
}
