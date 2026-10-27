import type { ProductItem } from "@erp/contracts";
import { deriveRatePerMetre, formatINR, parseRollList, round, D } from "@erp/domain";
import { Button, Field, NumberInput, Select, TextInput } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { productsQuery } from "../lib/masters.js";

/** One editable line: a catalogue SKU or raw attributes (rolls of unknown items arrive Unmapped). */
export interface ItemLine {
  key: string;
  poLineId: string | null;
  skuId: string;
  description: string;
  gsm: string;
  widthIn: string;
  qualityName: string;
  /** Metres (PO, PI) — unused on a GRN. */
  quantityM: string;
  ratePerM: string;
  /** Helper only: ₹/m at 44″ → fills ratePerM for the line's width (ADR-0013). */
  rate44: string;
  discountPct: string;
  gstRate: string;
  hsnCode: string;
  /** GRN: rolls as the supplier lists them, e.g. "4 x 1000, 500, 450". */
  rolls: string;
  rejectedRolls: string;
  rejectReason: string;
}

let seq = 0;
export const blankLine = (patch: Partial<ItemLine> = {}): ItemLine => ({
  key: `l${++seq}`,
  poLineId: null,
  skuId: "",
  description: "",
  gsm: "",
  widthIn: "",
  qualityName: "",
  quantityM: "",
  ratePerM: "",
  rate44: "",
  discountPct: "0",
  gstRate: "18",
  hsnCode: "",
  rolls: "",
  rejectedRolls: "",
  rejectReason: "",
  ...patch,
});

export interface SkuOption {
  id: string;
  label: string;
  description: string;
  gsm: number;
  widthIn: string;
  qualityName: string;
}

export function useSkuOptions(): SkuOption[] {
  const { data } = useQuery(productsQuery);
  return useMemo(
    () =>
      (data ?? [])
        .filter((p: ProductItem) => p.active)
        .flatMap((p) =>
          p.skus
            .filter((s) => s.active)
            .map((s) => ({
              id: s.id,
              label: `${p.name} · ${s.widthIn}″`,
              description: `${p.name} ${s.widthIn}″`,
              gsm: p.gsm,
              widthIn: s.widthIn,
              qualityName: p.qualityName,
            })),
        ),
    [data],
  );
}

/** Metres in a roll list, or null while it can't be read. */
export function rollMetres(list: string): { rolls: number; metres: number } | null {
  try {
    const lengths = parseRollList(list);
    return { rolls: lengths.length, metres: lengths.reduce((s, l) => s + l, 0) };
  } catch {
    return null;
  }
}

/**
 * The line table shared by purchase orders, goods receipts and purchase invoices. `mode` decides
 * which columns show: GRNs take roll lists, POs and PIs take metres and rates.
 */
export function ItemLinesEditor({
  lines,
  onChange,
  mode,
  errors = {},
  disabled,
}: {
  lines: ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  mode: "po" | "grn" | "pi";
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const skus = useSkuOptions();
  const set = (i: number, patch: Partial<ItemLine>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const pickSku = (i: number, id: string) => {
    const s = skus.find((x) => x.id === id);
    if (!s) return set(i, { skuId: "" });
    const line = lines[i]!;
    set(i, {
      skuId: s.id,
      description: s.description,
      gsm: String(s.gsm),
      widthIn: s.widthIn,
      qualityName: s.qualityName,
      ...(line.rate44 && { ratePerM: derived(line.rate44, s.widthIn) }),
    });
  };
  const err = (i: number, field: string) => errors[`lines.${i}.${field}`] ?? errors[field];

  return (
    <div className="grid gap-3">
      {lines.map((line, i) => {
        const parsed = mode === "grn" ? rollMetres(line.rolls) : null;
        const amount =
          mode !== "grn" && line.quantityM && line.ratePerM
            ? round(
                D(line.quantityM)
                  .times(line.ratePerM)
                  .times(D(100).minus(line.discountPct || 0))
                  .dividedBy(100),
                2,
              )
            : null;
        return (
          <fieldset
            key={line.key}
            className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-6"
            aria-label={`Line ${i + 1}`}
          >
            <Field label="Item (SKU)" className="md:col-span-3" error={err(i, "skuId")}>
              {(p) => (
                <Select
                  {...p}
                  disabled={disabled}
                  value={line.skuId || "none"}
                  onValueChange={(v) => (v === "none" ? set(i, { skuId: "" }) : pickSku(i, v))}
                  options={[
                    { value: "none", label: "Not in catalogue — describe it" },
                    ...skus.map((s) => ({ value: s.id, label: s.label })),
                  ]}
                />
              )}
            </Field>
            <Field
              label="Description"
              className="md:col-span-3"
              error={err(i, "description")}
              required
            >
              {(p) => (
                <TextInput
                  {...p}
                  disabled={disabled}
                  value={line.description}
                  onChange={(e) => set(i, { description: e.target.value })}
                  placeholder="e.g. Eco Paper 60* 29 GSM"
                />
              )}
            </Field>
            <Field label="GSM" error={err(i, "gsm")} required>
              {(p) => (
                <NumberInput
                  {...p}
                  disabled={disabled || Boolean(line.skuId)}
                  decimals={0}
                  value={line.gsm}
                  onValueChange={(v) => set(i, { gsm: v })}
                />
              )}
            </Field>
            <Field label="Width" error={err(i, "widthIn")} required>
              {(p) => (
                <NumberInput
                  {...p}
                  disabled={disabled || Boolean(line.skuId)}
                  decimals={2}
                  suffix="″"
                  value={line.widthIn}
                  onValueChange={(v) =>
                    set(i, {
                      widthIn: v,
                      ...(line.rate44 && v && { ratePerM: derived(line.rate44, v) }),
                    })
                  }
                />
              )}
            </Field>
            {mode === "grn" ? (
              <>
                <Field
                  label="Rolls (as on the supplier's bill)"
                  className="md:col-span-2"
                  error={err(i, "rolls")}
                  hint={
                    parsed
                      ? `${parsed.rolls} rolls · ${parsed.metres.toLocaleString("en-IN")} m`
                      : "e.g. 10 x 1000  or  4 x 1000, 500, 450"
                  }
                  required
                >
                  {(p) => (
                    <TextInput
                      {...p}
                      disabled={disabled}
                      className="font-mono"
                      value={line.rolls}
                      onChange={(e) => set(i, { rolls: e.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label="Rejected rolls"
                  hint="Optional — refused at the door"
                  error={err(i, "rejectedRolls")}
                >
                  {(p) => (
                    <TextInput
                      {...p}
                      disabled={disabled}
                      className="font-mono"
                      value={line.rejectedRolls}
                      onChange={(e) => set(i, { rejectedRolls: e.target.value })}
                    />
                  )}
                </Field>
                {line.rejectedRolls.trim() ? (
                  <Field label="Why rejected" error={err(i, "rejectReason")} required>
                    {(p) => (
                      <TextInput
                        {...p}
                        disabled={disabled}
                        value={line.rejectReason}
                        onChange={(e) => set(i, { rejectReason: e.target.value })}
                      />
                    )}
                  </Field>
                ) : (
                  <div />
                )}
              </>
            ) : (
              <>
                <Field label="Metres" error={err(i, "quantityM")} required>
                  {(p) => (
                    <NumberInput
                      {...p}
                      disabled={disabled}
                      decimals={0}
                      suffix="m"
                      value={line.quantityM}
                      onValueChange={(v) => set(i, { quantityM: v })}
                    />
                  )}
                </Field>
                <Field label="₹/m at 44″" hint="Optional helper">
                  {(p) => (
                    <NumberInput
                      {...p}
                      disabled={disabled}
                      decimals={4}
                      prefix="₹"
                      value={line.rate44}
                      onValueChange={(v) =>
                        set(i, {
                          rate44: v,
                          ...(v && line.widthIn && { ratePerM: derived(v, line.widthIn) }),
                        })
                      }
                    />
                  )}
                </Field>
                <Field
                  label="Rate ₹/m"
                  error={err(i, "ratePerM")}
                  required
                  hint={amount ? formatINR(amount) : undefined}
                >
                  {(p) => (
                    <NumberInput
                      {...p}
                      disabled={disabled}
                      decimals={4}
                      prefix="₹"
                      value={line.ratePerM}
                      onValueChange={(v) => set(i, { ratePerM: v })}
                    />
                  )}
                </Field>
                <Field label="GST">
                  {(p) => (
                    <Select
                      {...p}
                      disabled={disabled}
                      value={line.gstRate}
                      onValueChange={(v) => set(i, { gstRate: v })}
                      options={["0", "5", "12", "18", "28"].map((r) => ({
                        value: r,
                        label: `${r}%`,
                      }))}
                    />
                  )}
                </Field>
                {mode === "pi" ? (
                  <>
                    <Field label="HSN" error={err(i, "hsnCode")} required>
                      {(p) => (
                        <TextInput
                          {...p}
                          disabled={disabled}
                          inputMode="numeric"
                          maxLength={8}
                          className="font-mono"
                          value={line.hsnCode}
                          onChange={(e) => set(i, { hsnCode: e.target.value.replace(/\D/g, "") })}
                        />
                      )}
                    </Field>
                    <Field label="Discount">
                      {(p) => (
                        <NumberInput
                          {...p}
                          disabled={disabled}
                          decimals={2}
                          suffix="%"
                          value={line.discountPct}
                          onValueChange={(v) => set(i, { discountPct: v })}
                        />
                      )}
                    </Field>
                  </>
                ) : null}
              </>
            )}
            <div className="flex items-end justify-end md:col-span-6">
              {line.poLineId ? (
                <span className="mr-auto self-center text-xs text-fg-3">On the purchase order</span>
              ) : null}
              {!disabled && lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
                >
                  Remove line
                </Button>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      {!disabled ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={Plus}
          className="justify-self-start"
          onClick={() => onChange([...lines, blankLine({ hsnCode: lines.at(-1)?.hsnCode ?? "" })])}
        >
          Add line
        </Button>
      ) : null}
    </div>
  );
}

const derived = (rate44: string, width: string) => {
  try {
    return deriveRatePerMetre(rate44, width, 2).toFixed(2);
  } catch {
    return "";
  }
};

/** API body pieces shared by the three documents. */
export const itemSpec = (l: ItemLine) => ({
  skuId: l.skuId || null,
  description: l.description.trim(),
  gsm: Number(l.gsm),
  widthIn: Number(l.widthIn),
  qualityName: l.qualityName.trim() || null,
});
