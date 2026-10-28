import type { ProductItem, SoDetail } from "@erp/contracts";
import { D, istToday } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  FormSection,
  NumberInput,
  Select,
  TextArea,
  TextInput,
  useHotkeys,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { ApiError, api, call } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import { customersQuery, nullable, productsQuery, settingValue } from "../lib/masters.js";
import { keys, settingsQuery } from "../lib/queries.js";
import { RATE_SOURCE_LABEL, creditCheckQuery, rateQuoteQuery, rupees } from "../lib/sales.js";
import { CreditPanel } from "./sales-bits.js";

export interface Line {
  key: string;
  skuId: string;
  totalM: string;
  ratePerM: string;
  /** True while the rate is the one we filled in from the quote. */
  autoRate: boolean;
  discountPct: string;
  allowCut: boolean;
}

export const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  skuId: "",
  totalM: "",
  ratePerM: "",
  autoRate: true,
  discountPct: "",
  allowCut: true,
});

/** Enter moves to the next field (CLAUDE.md keyboard rules); Ctrl S saves. */
export function nextField(e: KeyboardEvent<HTMLFormElement>) {
  const target = e.target as HTMLElement;
  if (e.key !== "Enter" || target.tagName === "TEXTAREA" || target.tagName === "BUTTON") return;
  e.preventDefault();
  const fields = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(
      "input:not([type=hidden]):not([disabled]), button[role=combobox], textarea",
    ),
  ];
  fields[fields.indexOf(target) + 1]?.focus();
}

/** Create or edit a draft sales order (PRD §6.5). Rates fill from the customer's 44″ rate. */
export function SoForm({ so, onDone }: { so?: SoDetail; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const { data: customers } = useQuery(customersQuery);
  const { data: products } = useQuery(productsQuery);
  const { data: settings } = useQuery(settingsQuery);
  const tolerance = Number(settingValue(settings, "pricing.overrideTolerancePct", 5));
  const [customerId, setCustomerId] = useState(so?.customerId ?? "");
  const [date, setDate] = useState(so?.date ?? istToday());
  const [customerRef, setRef] = useState(so?.customerRef ?? "");
  const [notes, setNotes] = useState(so?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(
    so?.lines.map((l) => ({
      key: l.id,
      skuId: l.skuId,
      totalM: String(l.totalM),
      ratePerM: l.ratePerM,
      autoRate: false,
      discountPct: D(l.discountPct).isZero() ? "" : l.discountPct,
      allowCut: l.allowCut,
    })) ?? [blankLine()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const credit = useQuery(creditCheckQuery(customerId));

  const skuOptions = useSkuOptions(products);
  const customerOptions = (customers ?? [])
    .filter((c) => c.active || c.id === customerId)
    .map((c) => ({ value: c.id, label: `${c.legalName} · ${c.code}` }));

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => {
    if (!l.totalM || !l.ratePerM) return s;
    const gross = D(l.totalM).times(l.ratePerM);
    return s.plus(gross.minus(gross.times(D(l.discountPct || 0)).dividedBy(100)));
  }, D(0));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        customerId,
        date,
        customerRef: nullable(customerRef),
        notes: nullable(notes),
        lines: lines.map((l) => ({
          skuId: l.skuId,
          totalM: Number(l.totalM),
          ratePerM: l.ratePerM,
          ...(l.discountPct ? { discountPct: l.discountPct } : {}),
          allowCut: l.allowCut,
        })),
      };
      return so
        ? call<SoDetail>(() =>
            api.PATCH("/api/sales-orders/{id}", {
              params: { path: { id: so.id } },
              body: { ...body, version: so.version },
            }),
          )
        : call<SoDetail>(() => api.POST("/api/sales-orders", { body }));
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: so ? "Order saved" : `Order ${saved.soNo} created`,
        description: saved.pendingApproval
          ? "Some rates need a manager's approval before you confirm."
          : "Confirm it to run the credit check.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      if (onDone) onDone();
      else void navigate({ to: "/sales/orders/$soId", params: { soId: saved.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
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
      className="grid gap-6 [&>*]:min-w-0 2xl:grid-cols-[minmax(0,1fr)_340px]"
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
                onClick={() => (onDone ? onDone() : void navigate({ to: "/sales/orders" }))}
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
                {so ? "Save changes" : "Create order"}
              </Button>
            </div>
          </div>
        }
      >
        <FormSection
          title="Order"
          description="Rates are ₹ per metre, derived from the customer's 44″ rate."
        >
          <Field label="Customer" required error={errors.customerId}>
            {(p) => (
              <Select
                {...p}
                value={customerId || undefined}
                onValueChange={setCustomerId}
                placeholder="Choose a customer"
                options={customerOptions}
                disabled={Boolean(so)}
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
          <Field label="Customer's reference" hint="Their PO number, if any">
            {(p) => (
              <TextInput {...p} value={customerRef} onChange={(e) => setRef(e.target.value)} />
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
          {errors.lines ? <p className="text-sm text-danger">{errors.lines}</p> : null}
          {lines.map((line, i) => (
            <LineRow
              key={line.key}
              index={i}
              line={line}
              customerId={customerId}
              skuOptions={skuOptions}
              tolerance={tolerance}
              errors={errors}
              onChange={(patch) => update(line.key, patch)}
              onRemove={
                lines.length > 1
                  ? () => setLines((ls) => ls.filter((l) => l.key !== line.key))
                  : undefined
              }
            />
          ))}
        </div>
      </Card>
      <div className="grid content-start gap-6">
        {credit.data ? (
          <CreditPanel credit={credit.data} title="Customer's credit today" />
        ) : (
          <Card title="Customer's credit today">
            <p className="text-sm text-fg-2">Choose a customer to see their limit and exposure.</p>
          </Card>
        )}
        <p className="px-1 text-xs text-fg-3">
          Confirming re-runs the check with this order included. Rates more than {tolerance} % off
          the derived rate need a manager's approval first.
        </p>
      </div>
    </form>
  );
}

export function LineRow({
  index,
  line,
  customerId,
  skuOptions,
  tolerance,
  errors,
  onChange,
  onRemove,
  hideCut,
}: {
  hideCut?: boolean;
  index: number;
  line: Line;
  customerId: string;
  skuOptions: { value: string; label: string }[];
  tolerance: number;
  errors: Record<string, string>;
  onChange: (patch: Partial<Line>) => void;
  onRemove?: () => void;
}) {
  const quote = useQuery(rateQuoteQuery(customerId, line.skuId));
  const q = quote.data;
  // Fill the rate from the quote until the user types their own.
  useEffect(() => {
    if (q?.ratePerM && line.autoRate && line.ratePerM !== q.ratePerM)
      onChange({ ratePerM: q.ratePerM });
  }, [q?.ratePerM, line.autoRate, line.ratePerM, onChange]);
  const deviation =
    q?.ratePerM && line.ratePerM && !D(q.ratePerM).isZero()
      ? D(line.ratePerM).minus(q.ratePerM).dividedBy(q.ratePerM).times(100)
      : null;
  const needsApproval = q
    ? q.ratePerM === null || (deviation !== null && deviation.abs().greaterThan(tolerance))
    : false;
  const err = (k: string) => errors[`lines.${index}.${k}`];
  const short = q && line.totalM && Number(line.totalM) > q.availableM;
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[minmax(220px,2fr)_120px_130px_100px_auto_auto]">
      <Field label={`Line ${index + 1} · product`} error={err("skuId")}>
        {(p) => (
          <Select
            {...p}
            value={line.skuId || undefined}
            onValueChange={(skuId) => onChange({ skuId, autoRate: true, ratePerM: "" })}
            placeholder="Product and width"
            options={skuOptions}
          />
        )}
      </Field>
      <Field label="Metres" error={err("totalM")}>
        {(p) => (
          <NumberInput
            {...p}
            value={line.totalM}
            onValueChange={(totalM) => onChange({ totalM })}
            decimals={0}
            suffix="m"
          />
        )}
      </Field>
      <Field label="Rate ₹/m" error={err("ratePerM")}>
        {(p) => (
          <NumberInput
            {...p}
            value={line.ratePerM}
            onValueChange={(ratePerM) => onChange({ ratePerM, autoRate: false })}
            decimals={4}
          />
        )}
      </Field>
      <Field label="Disc. %">
        {(p) => (
          <NumberInput
            {...p}
            value={line.discountPct}
            onValueChange={(discountPct) => onChange({ discountPct })}
            decimals={2}
          />
        )}
      </Field>
      <div className={hideCut ? "hidden" : "flex items-end pb-2"}>
        <Checkbox
          checked={line.allowCut}
          onCheckedChange={(allowCut) => onChange({ allowCut })}
          label="Allow cut"
        />
      </div>
      <div className="flex items-end pb-1">
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            iconOnly
            icon={Trash2}
            aria-label={`Remove line ${index + 1}`}
            onClick={onRemove}
          />
        ) : null}
      </div>
      {q ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-2 md:col-span-6">
          <Badge tone={q.source === "NONE" ? "warning" : "neutral"}>
            {RATE_SOURCE_LABEL[q.source]}
          </Badge>
          {q.base44 ? (
            <span>
              44″ rate <span className="tnum">₹{q.base44}</span> → {q.widthIn}″{" "}
              <span className="tnum font-medium text-fg">₹{q.ratePerM}/m</span>
            </span>
          ) : null}
          {deviation && !deviation.isZero() ? (
            <span className={needsApproval ? "text-warning" : undefined}>
              {deviation.isPositive() ? "+" : ""}
              {deviation.toFixed(1)} % from derived
            </span>
          ) : null}
          {needsApproval ? <Badge tone="warning">Needs manager approval</Badge> : null}
          <span className={short ? "text-danger" : undefined}>
            {q.availableM.toLocaleString("en-IN")} m in stock
          </span>
          {q.gstRate === null ? (
            <Badge tone="danger">No HSN / GST on this category</Badge>
          ) : (
            <span>GST {q.gstRate} %</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Active product × width choices for a sales line, sorted by product then width. */
export function useSkuOptions(products: ProductItem[] | undefined) {
  return useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.active)
        .flatMap((p) =>
          p.skus
            .filter((s) => s.active)
            .map((s) => ({
              value: s.id,
              label: `${p.name} · ${s.widthIn}″`,
              sort: `${p.name}${s.widthIn.padStart(6, "0")}`,
            })),
        )
        .sort((a, b) => a.sort.localeCompare(b.sort))
        .map(({ value, label }) => ({ value, label })),
    [products],
  );
}
