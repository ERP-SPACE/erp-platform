import type { ProformaDetail } from "@erp/contracts";
import { D, istToday } from "@erp/domain";
import {
  Button,
  Card,
  Field,
  FormSection,
  Select,
  TextArea,
  TextInput,
  useHotkeys,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, api, call } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import { customersQuery, nullable, productsQuery, settingValue } from "../lib/masters.js";
import { keys, settingsQuery } from "../lib/queries.js";
import { type Line, LineRow, blankLine, nextField, useSkuOptions } from "./so-form.js";

/** Create or edit a proforma (PRD §5.7): priced like an order, no stock held, no accounting. */
import { rupees } from "../lib/sales.js";
export function ProformaForm({ pf, onDone }: { pf?: ProformaDetail; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const { data: customers } = useQuery(customersQuery);
  const { data: products } = useQuery(productsQuery);
  const { data: settings } = useQuery(settingsQuery);
  const tolerance = Number(settingValue(settings, "pricing.overrideTolerancePct", 5));
  const skuOptions = useSkuOptions(products);
  const [customerId, setCustomerId] = useState(pf?.customerId ?? "");
  const [date, setDate] = useState(pf?.date ?? istToday());
  const [validUntil, setValidUntil] = useState(pf?.validUntil ?? "");
  const [notes, setNotes] = useState(pf?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(
    pf?.lines.map((l) => ({
      key: l.id,
      skuId: l.skuId,
      totalM: String(l.metres),
      ratePerM: l.ratePerM,
      autoRate: false,
      discountPct: D(l.discountPct).isZero() ? "" : l.discountPct,
      allowCut: true,
    })) ?? [blankLine()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const total = lines.reduce(
    (s, l) => (l.totalM && l.ratePerM ? s.plus(D(l.totalM).times(l.ratePerM)) : s),
    D(0),
  );
  const save = useMutation({
    mutationFn: () => {
      const body = {
        customerId,
        date,
        validUntil: validUntil || null,
        notes: nullable(notes),
        lines: lines.map((l) => ({
          skuId: l.skuId,
          metres: Number(l.totalM),
          ratePerM: l.ratePerM,
          ...(l.discountPct ? { discountPct: l.discountPct } : {}),
        })),
      };
      return pf
        ? call<ProformaDetail>(() =>
            api.PATCH("/api/proformas/{id}", {
              params: { path: { id: pf.id } },
              body: { ...body, version: pf.version },
            }),
          )
        : call<ProformaDetail>(() => api.POST("/api/proformas", { body }));
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: pf ? "Proforma saved" : `Proforma ${saved.proformaNo} created`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      if (onDone) onDone();
      else void navigate({ to: "/sales/proformas/$pfId", params: { pfId: saved.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        // Proforma issues name "metres"; the shared line row shows "totalM".
        setErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors()).map(([k, v]) => [
              k.replace(/\.metres$/, ".totalM"),
              v,
            ]),
          ),
        );
      }
      onError(error, keys.sales);
    },
  });
  useHotkeys({ "mod+s": () => customerId && !save.isPending && save.mutate() });
  return (
    <form
      onKeyDown={nextField}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card
        footer={
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-2">
              Before GST <span className="tnum font-semibold text-fg">{rupees(total)}</span>
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => (onDone ? onDone() : void navigate({ to: "/sales/proformas" }))}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                shortcut="Ctrl S"
                busy={save.isPending}
                disabled={!customerId}
              >
                {pf ? "Save changes" : "Create proforma"}
              </Button>
            </div>
          </div>
        }
      >
        <FormSection
          title="Proforma"
          description="Valid for the days set in Settings unless you choose a date."
        >
          <Field label="Customer" required error={errors.customerId}>
            {(p) => (
              <Select
                {...p}
                value={customerId || undefined}
                onValueChange={setCustomerId}
                placeholder="Choose a customer"
                options={(customers ?? [])
                  .filter((c) => c.active)
                  .map((c) => ({ value: c.id, label: `${c.legalName} · ${c.code}` }))}
              />
            )}
          </Field>
          <Field label="Date" required>
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Valid until">
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            )}
          </Field>
          <Field label="Notes">
            {(p) => (
              <TextArea {...p} rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </FormSection>
        <div className="grid gap-3 border-t border-border pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Lines</h3>
            <Button
              type="button"
              variant="ghost"
              icon={Plus}
              onClick={() => setLines((ls) => [...ls, blankLine()])}
            >
              Add line
            </Button>
          </div>
          {lines.map((line, i) => (
            <LineRow
              key={line.key}
              hideCut
              index={i}
              line={line}
              customerId={customerId}
              skuOptions={skuOptions}
              tolerance={tolerance}
              errors={errors}
              onChange={(patch) =>
                setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, ...patch } : l)))
              }
              onRemove={
                lines.length > 1
                  ? () => setLines((ls) => ls.filter((l) => l.key !== line.key))
                  : undefined
              }
            />
          ))}
        </div>
      </Card>
    </form>
  );
}
