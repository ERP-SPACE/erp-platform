import type { NoteDetail } from "@erp/contracts";
import { D, istToday } from "@erp/domain";
import {
  Button,
  Card,
  Field,
  FormSection,
  NumberInput,
  PageHeader,
  Segmented,
  Select,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { crumbLink } from "../../../../components/sales-bits.js";
import { ApiError, api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { customersQuery } from "../../../../lib/masters.js";
import { keys } from "../../../../lib/queries.js";
import { NOTE_REASON_LABEL, siListQuery, siQuery, rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/notes/new")({
  validateSearch: z.object({ siId: z.string().optional() }),
  component: NewNotePage,
});

const REASONS = ["RATE_DIFFERENCE", "DISCOUNT", "SHORTAGE", "OTHER"] as const;
const RATES = ["0", "5", "12", "18", "28"] as const;
interface NoteLine {
  key: string;
  description: string;
  hsnCode: string;
  taxable: string;
  gstRate: (typeof RATES)[number];
}
const line = (hsnCode = "", gstRate: NoteLine["gstRate"] = "18"): NoteLine => ({
  key: crypto.randomUUID(),
  description: "",
  hsnCode,
  taxable: "",
  gstRate,
});

function NewNotePage() {
  const search = Route.useSearch();
  const [kind, setKind] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [siId, setSiId] = useState(search.siId ?? "");
  const [pickedCustomer, setCustomerId] = useState("");
  const [date, setDate] = useState(istToday());
  const [reasonCode, setReasonCode] = useState<(typeof REASONS)[number]>("RATE_DIFFERENCE");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<NoteLine[]>([line()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: customers } = useQuery(customersQuery);
  const { data: invoices } = useQuery(siListQuery({ status: "Posted" }));
  const { data: si } = useQuery({ ...siQuery(siId), enabled: Boolean(siId) });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();
  // An invoice fixes the customer; its first goods line suggests the HSN for blank lines.
  const customerId = si?.customerId ?? pickedCustomer;
  const defaultHsn = si?.lines.find((l) => l.kind === "GOODS")?.hsnCode ?? "";
  const taxable = lines.reduce((s, l) => (l.taxable ? s.plus(l.taxable) : s), D(0));
  const save = useMutation({
    mutationFn: () =>
      call<NoteDetail>(() =>
        api.POST("/api/customer-notes", {
          body: {
            kind,
            customerId,
            siId: siId || null,
            date,
            reasonCode,
            reason,
            lines: lines.map(({ key: _k, ...l }) => ({ ...l, hsnCode: l.hsnCode || defaultHsn })),
          },
        }),
      ),
    onSuccess: async (n) => {
      toast({
        tone: "success",
        title: "Draft note ready",
        description: "Post it to number it and request its IRN.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      void navigate({ to: "/sales/notes/$noteId", params: { noteId: n.id } });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      onError(e, keys.sales);
    },
  });
  const set = (key: string, patch: Partial<NoteLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="grid gap-6">
      <PageHeader
        title="New credit or debit note"
        description="A credit note lowers what the customer owes; a debit note raises it."
        breadcrumbs={[
          { label: "Sales" },
          { label: "Credit & debit notes", href: "/sales/notes" },
          { label: "New" },
        ]}
        renderLink={crumbLink}
      />
      <Card
        footer={
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-2">
              Taxable <span className="tnum font-semibold text-fg">{rupees(taxable)}</span> + GST
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void navigate({ to: "/sales/notes" })}>
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={save.isPending}
                disabled={!customerId || reason.trim().length < 3}
                onClick={() => save.mutate()}
              >
                Create draft note
              </Button>
            </div>
          </div>
        }
      >
        <FormSection title="Note">
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-fg">Kind</span>
            <Segmented
              label="Kind"
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "CREDIT", label: "Credit note" },
                { value: "DEBIT", label: "Debit note" },
              ]}
            />
          </div>
          <Field label="Against invoice" hint="Optional, but usual">
            {(p) => (
              <Select
                {...p}
                value={siId || undefined}
                onValueChange={setSiId}
                placeholder="Choose an invoice"
                options={(invoices ?? []).map((i) => ({
                  value: i.id,
                  label: `${i.siNo} · ${i.customerName}`,
                }))}
              />
            )}
          </Field>
          <Field label="Customer" required error={errors.customerId}>
            {(p) => (
              <Select
                {...p}
                disabled={Boolean(siId)}
                value={customerId || undefined}
                onValueChange={setCustomerId}
                placeholder="Choose a customer"
                options={(customers ?? []).map((c) => ({ value: c.id, label: c.legalName }))}
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
          <Field label="Reason type">
            {(p) => (
              <Select
                {...p}
                value={reasonCode}
                onValueChange={(v) => setReasonCode(v as typeof reasonCode)}
                options={REASONS.map((r) => ({ value: r, label: NOTE_REASON_LABEL[r] }))}
              />
            )}
          </Field>
          <Field
            label="Reason (printed on the note)"
            required
            error={errors.reason}
            className="sm:col-span-2"
          >
            {(p) => (
              <TextInput
                {...p}
                value={reason}
                placeholder="e.g. Rate revised from ₹6.60 to ₹6.40"
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </FormSection>
        <div className="grid gap-3 border-t border-border pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Lines</h3>
            <Button
              variant="ghost"
              icon={Plus}
              onClick={() => setLines((ls) => [...ls, line(ls[0]?.hsnCode, ls[0]?.gstRate)])}
            >
              Add line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div
              key={l.key}
              className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[2fr_130px_140px_110px_auto]"
            >
              <Field label={`Line ${i + 1} · description`} error={errors[`lines.${i}.description`]}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={l.description}
                    onChange={(e) => set(l.key, { description: e.target.value })}
                  />
                )}
              </Field>
              <Field label="HSN" error={errors[`lines.${i}.hsnCode`]}>
                {(p) => (
                  <TextInput
                    {...p}
                    inputMode="numeric"
                    placeholder={defaultHsn}
                    value={l.hsnCode}
                    onChange={(e) => set(l.key, { hsnCode: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Taxable ₹" error={errors[`lines.${i}.taxable`]}>
                {(p) => (
                  <NumberInput
                    {...p}
                    decimals={2}
                    value={l.taxable}
                    onValueChange={(taxable) => set(l.key, { taxable })}
                  />
                )}
              </Field>
              <Field label="GST %">
                {(p) => (
                  <Select
                    {...p}
                    value={l.gstRate}
                    onValueChange={(v) => set(l.key, { gstRate: v as NoteLine["gstRate"] })}
                    options={RATES.map((r) => ({ value: r, label: `${r} %` }))}
                  />
                )}
              </Field>
              <div className="flex items-end pb-1">
                {lines.length > 1 ? (
                  <Button
                    variant="ghost"
                    iconOnly
                    icon={Trash2}
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
