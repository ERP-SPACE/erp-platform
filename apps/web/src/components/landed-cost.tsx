import type { LandedCostPreview, PiDetail } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Mono,
  NumberInput,
  Select,
  Stepper,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2, Truck, Undo2 } from "lucide-react";
import { useState } from "react";
import { api, call, reasonHeader } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import { dateTime } from "../lib/format.js";
import { settingValue } from "../lib/masters.js";
import { landedChargesQuery } from "../lib/purchase.js";
import { keys, settingsQuery } from "../lib/queries.js";
import { ReasonField } from "./reason-field.js";

type Basis = "ROLL" | "METER" | "VALUE" | "WEIGHT";
const BASIS_LABEL: Record<Basis, string> = {
  ROLL: "Equally per roll",
  METER: "By metres",
  VALUE: "By value",
  WEIGHT: "By weight",
};
interface ChargeSetting {
  code: string;
  label: string;
  basis: Basis;
  active: boolean;
}
interface Row {
  code: string;
  amount: string;
  basis: Basis;
  vendorName: string;
  billRef: string;
}

/**
 * Landed cost on a posted purchase invoice (PRD §8.3): charges are previewed per roll, then
 * applied; shares always add up to the charge to the paisa. Applied charges can be reversed.
 */
export function LandedCostCard({ pi, editable }: { pi: PiDetail; editable: boolean }) {
  const { data: charges } = useQuery(landedChargesQuery(pi.id));
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const live = (charges ?? []).filter((c) => c.allocated);
  const total = live.reduce((s, c) => s + Number(c.amount), 0);
  return (
    <Card
      title="Landed cost"
      description="Freight, loading, insurance, duty… spread over this invoice's rolls. GST is never part of it."
      actions={
        editable && pi.rollCount > 0 ? (
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Add charges
          </Button>
        ) : null
      }
      padded={false}
    >
      {charges?.length ? (
        <ul className="divide-y divide-border text-sm">
          {charges.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Truck className="size-4 text-fg-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg">
                  {c.label} <span className="font-normal text-fg-3">· {BASIS_LABEL[c.basis]}</span>
                </p>
                <p className="text-xs text-fg-3">
                  {[c.vendorName, c.billRef].filter(Boolean).join(" · ") || "—"} ·{" "}
                  {dateTime(c.allocatedAt)}
                </p>
              </div>
              <span className="tnum font-medium">{formatINR(c.amount)}</span>
              {c.reversedAt ? <Badge>Reversed</Badge> : <Badge tone="success">Applied</Badge>}
              {editable && c.allocated ? (
                <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setReversing(c.id)}>
                  Reverse
                </Button>
              ) : null}
            </li>
          ))}
          <li className="flex justify-between px-5 py-3 font-medium">
            <span>Total applied</span>
            <span className="tnum">{formatINR(total.toFixed(2))}</span>
          </li>
        </ul>
      ) : (
        <EmptyState
          title="No landed cost yet"
          hint={
            pi.rollCount
              ? "Add freight, hamali, insurance or duty from the supplier's or transporter's bills."
              : "Link this invoice's goods receipt first."
          }
        />
      )}
      {adding ? <AddChargesDialog piId={pi.id} onClose={() => setAdding(false)} /> : null}
      {reversing ? (
        <ReverseDialog chargeId={reversing} piId={pi.id} onClose={() => setReversing(null)} />
      ) : null}
    </Card>
  );
}

function AddChargesDialog({ piId, onClose }: { piId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const { data: settings } = useQuery(settingsQuery);
  const configured = settingValue<ChargeSetting[]>(
    settings,
    "purchase.landedCostCharges",
    [],
  ).filter((c) => c.active);
  const [rows, setRows] = useState<Row[]>([
    { code: "FREIGHT", amount: "", basis: "WEIGHT", vendorName: "", billRef: "" },
  ]);
  const [preview, setPreview] = useState<LandedCostPreview | null>(null);
  const body = {
    charges: rows
      .filter((r) => r.amount)
      .map((r) => ({
        code: r.code,
        amount: r.amount,
        basis: r.basis,
        vendorName: r.vendorName || null,
        billRef: r.billRef || null,
      })),
  };
  const set = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const run = useMutation({
    mutationFn: (apply: boolean) =>
      call<LandedCostPreview>(() =>
        apply
          ? api.POST("/api/purchase-invoices/{id}/landed-cost", {
              params: { path: { id: piId } },
              body,
            })
          : api.POST("/api/purchase-invoices/{id}/landed-cost/preview", {
              params: { path: { id: piId } },
              body,
            }),
      ),
    onSuccess: async (result, apply) => {
      if (!apply) return setPreview(result);
      toast({
        tone: "success",
        title: "Landed cost applied",
        description: "Each roll's cost per metre is updated.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.purchase }),
        queryClient.invalidateQueries({ queryKey: keys.inventory }),
      ]);
      onClose();
    },
    onError: (e) => onError(e),
  });

  const columns: ColumnDef<LandedCostPreview["rows"][number], unknown>[] = [
    {
      accessorKey: "barcode",
      header: "Roll",
      cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
    },
    {
      accessorKey: "lengthM",
      header: "Length",
      meta: { numeric: true },
      cell: (c) => `${c.getValue() as number} m`,
    },
    {
      accessorKey: "baseValue",
      header: "Base value",
      meta: { numeric: true },
      cell: (c) => formatINR(c.getValue() as string),
    },
    ...body.charges.map(
      (ch) =>
        ({
          id: ch.code,
          header: configured.find((s) => s.code === ch.code)?.label ?? ch.code,
          meta: { numeric: true },
          accessorFn: (r: LandedCostPreview["rows"][number]) => r.shares[ch.code],
          cell: (c: { getValue: () => unknown }) => formatINR(c.getValue() as string),
        }) satisfies ColumnDef<LandedCostPreview["rows"][number], unknown>,
    ),
    {
      accessorKey: "costPerMetre",
      header: "Cost ₹/m",
      meta: { numeric: true },
      cell: (c) => <strong>{formatINR(c.getValue() as string, { decimals: 4 })}</strong>,
    },
  ];

  return (
    <Dialog
      open
      width="lg"
      onOpenChange={(o) => !o && onClose()}
      title="Add landed cost"
      description="Choose how each charge is split; you'll see every roll's share before anything is saved."
      footer={
        preview ? (
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Back
            </Button>
            <Button variant="primary" busy={run.isPending} onClick={() => run.mutate(true)}>
              Apply to {preview.rows.length} rolls
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!body.charges.length}
              busy={run.isPending}
              onClick={() => run.mutate(false)}
            >
              Preview split
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4">
        <Stepper steps={["Charges", "Preview"]} current={preview ? 1 : 0} />
        {preview ? (
          <>
            <ul className="grid gap-1 text-sm">
              {preview.charges.map((c) => (
                <li key={c.code} className="flex justify-between">
                  <span>
                    {configured.find((s) => s.code === c.code)?.label ?? c.code} ·{" "}
                    {BASIS_LABEL[c.basis]}
                  </span>
                  <span className="tnum">
                    {formatINR(c.amount)} → split {formatINR(c.allocated)}
                  </span>
                </li>
              ))}
            </ul>
            {Number(preview.varianceAmount) ? (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                {formatINR(preview.varianceAmount)} falls on rolls already dispatched; it is
                recorded as a variance instead of changing their cost.
              </p>
            ) : null}
            <div className="max-h-[50vh] overflow-auto">
              <DataTable
                caption="Landed cost per roll"
                data={preview.rows}
                columns={columns}
                getRowId={(r) => r.rollId}
                pageSize={false}
              />
            </div>
          </>
        ) : (
          <>
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1.4fr_1fr_1.1fr_1fr_1fr_auto]"
              >
                <Field label="Charge">
                  {(p) => (
                    <Select
                      {...p}
                      value={r.code}
                      onValueChange={(code) =>
                        set(i, {
                          code,
                          basis: configured.find((c) => c.code === code)?.basis ?? r.basis,
                        })
                      }
                      options={configured.map((c) => ({ value: c.code, label: c.label }))}
                    />
                  )}
                </Field>
                <Field label="Amount">
                  {(p) => (
                    <NumberInput
                      {...p}
                      decimals={2}
                      prefix="₹"
                      value={r.amount}
                      onValueChange={(amount) => set(i, { amount })}
                    />
                  )}
                </Field>
                <Field label="Split">
                  {(p) => (
                    <Select
                      {...p}
                      value={r.basis}
                      onValueChange={(v) => set(i, { basis: v as Basis })}
                      options={(Object.keys(BASIS_LABEL) as Basis[]).map((b) => ({
                        value: b,
                        label: BASIS_LABEL[b],
                      }))}
                    />
                  )}
                </Field>
                <Field label="Billed by">
                  {(p) => (
                    <TextInput
                      {...p}
                      value={r.vendorName}
                      onChange={(e) => set(i, { vendorName: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Bill no.">
                  {(p) => (
                    <TextInput
                      {...p}
                      value={r.billRef}
                      onChange={(e) => set(i, { billRef: e.target.value })}
                    />
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  iconOnly
                  aria-label={`Remove charge ${i + 1}`}
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                />
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              className="justify-self-start"
              onClick={() =>
                setRows([
                  ...rows,
                  {
                    code: configured[0]?.code ?? "OTHER",
                    amount: "",
                    basis: configured[0]?.basis ?? "VALUE",
                    vendorName: "",
                    billRef: "",
                  },
                ])
              }
            >
              Add another charge
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

function ReverseDialog({
  chargeId,
  piId,
  onClose,
}: {
  chargeId: string;
  piId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [reason, setReason] = useState("");
  const reverse = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST("/api/landed-cost-charges/{id}/reverse", {
          params: { path: { id: chargeId } },
          headers: reasonHeader(reason),
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: "Charge reversed" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: landedChargesQuery(piId).queryKey }),
        queryClient.invalidateQueries({ queryKey: keys.inventory }),
      ]);
      onClose();
    },
    onError: (e) => onError(e),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reverse this charge?"
      description="Rolls still in stock give their share back; rolls already sent out keep their cost."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            busy={reverse.isPending}
            onClick={() => reverse.mutate()}
          >
            Reverse charge
          </Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} required />
    </Dialog>
  );
}
