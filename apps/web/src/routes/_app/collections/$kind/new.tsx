import type { ReceiptDetail } from "@erp/contracts";
import { D, istToday } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormSection,
  Mono,
  NumberInput,
  PageHeader,
  Segmented,
  Select,
  TextArea,
  TextInput,
  useHotkeys,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { ListOrdered } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { crumbLink } from "../../../../components/sales-bits.js";
import { nextField } from "../../../../components/so-form.js";
import { ApiError, api, call } from "../../../../lib/api.js";
import {
  KIND,
  type MoneyKind,
  fetchSuggestion,
  openItemsQuery,
} from "../../../../lib/collections.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { customersQuery, nullable, suppliersQuery } from "../../../../lib/masters.js";
import { keys } from "../../../../lib/queries.js";
import { rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/$kind/new")({
  params: {
    parse: (p) => {
      if (p.kind !== "receipts" && p.kind !== "payments") throw notFound();
      return { kind: p.kind as MoneyKind };
    },
    stringify: (p) => p,
  },
  validateSearch: z.object({ partyId: z.string().optional() }),
  component: NewMoneyPage,
});

const MODES = ["NEFT", "RTGS", "UPI", "CHEQUE", "CASH"] as const;
type Mode = (typeof MODES)[number];
interface Line {
  amount: string;
  deduction: string;
}

function NewMoneyPage() {
  const { kind } = Route.useParams();
  const search = Route.useSearch();
  const k = KIND[kind];
  const customer = kind === "receipts";
  const { data: customers } = useQuery({ ...customersQuery, enabled: customer });
  const { data: suppliers } = useQuery({ ...suppliersQuery("true"), enabled: !customer });
  const [partyId, setPartyId] = useState(search.partyId ?? "");
  const [date, setDate] = useState(istToday());
  const [mode, setMode] = useState<Mode>("NEFT");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [bankName, setBankName] = useState("");
  const [instrumentDate, setInstrumentDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: open } = useQuery(openItemsQuery(k.party, partyId));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();

  const applied = Object.values(lines).reduce((s, l) => s.plus(l.amount || 0), D(0));
  const left = D(amount || 0).minus(applied);
  const fill = async () => {
    if (!partyId || !Number(amount)) return;
    const s = await fetchSuggestion(k.party, partyId, D(amount).toFixed(2));
    setLines(
      Object.fromEntries(s.lines.map((l) => [l.invoiceId, { amount: l.amount, deduction: "" }])),
    );
  };
  const setLine = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ({ ...ls, [id]: { amount: "", deduction: "", ...ls[id], ...patch } }));

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const body = {
        partyId,
        date,
        mode,
        amount: D(amount || 0).toFixed(2),
        reference: nullable(reference),
        bankName: nullable(bankName),
        instrumentDate: instrumentDate || null,
        notes: nullable(notes),
        allocations: Object.entries(lines)
          .filter(([, l]) => Number(l.amount) > 0 || Number(l.deduction) > 0)
          .map(([invoiceId, l]) => ({
            invoiceId,
            amount: D(l.amount || 0).toFixed(2),
            ...(Number(l.deduction) > 0 ? { deduction: D(l.deduction).toFixed(2) } : {}),
          })),
      };
      const draft = await call<ReceiptDetail>(() => api.POST(k.path as "/api/receipts", { body }));
      if (!andPost) return draft;
      return call<ReceiptDetail>(() =>
        api.POST(`${k.path}/{id}/post` as "/api/receipts/{id}/post", {
          params: { path: { id: draft.id } },
          body: { version: draft.version },
        }),
      );
    },
    onSuccess: async (r) => {
      toast({
        tone: "success",
        title: r.docNo ? `${k.one} ${r.docNo} posted` : `${k.one} saved as draft`,
        description:
          Number(r.unallocated) > 0 ? `${rupees(r.unallocated)} stays on account.` : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: keys.collections });
      void navigate({ to: "/collections/$kind/$moneyId", params: { kind, moneyId: r.id } });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      onError(e, keys.collections);
    },
  });
  useHotkeys({
    "mod+s": () => partyId && Number(amount) > 0 && !save.isPending && save.mutate(false),
  });

  const parties = customer
    ? (customers ?? [])
        .filter((c) => c.active)
        .map((c) => ({ value: c.id, label: `${c.legalName} · ${c.code}` }))
    : (suppliers ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.code}` }));
  const over = left.isNegative();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={k.newLabel}
        description={
          customer
            ? "Record money from a customer and say which invoices it pays. Tab / Enter moves on; Ctrl S saves."
            : "Record money paid to a supplier and the purchase invoices it settles."
        }
        breadcrumbs={[
          { label: "Collections" },
          { label: k.title, href: `/collections/${kind}` },
          { label: "New" },
        ]}
        renderLink={crumbLink}
      />
      <form
        onKeyDown={nextField}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(true);
        }}
      >
        <Card
          footer={
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-2">
                <span>
                  Applied <span className="tnum font-semibold text-fg">{rupees(applied)}</span>
                </span>
                {over ? (
                  <Badge tone="danger">Over by {rupees(left.negated())}</Badge>
                ) : (
                  <span>
                    On account <span className="tnum font-semibold text-fg">{rupees(left)}</span>
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void navigate({ to: "/collections/$kind", params: { kind } })}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  shortcut="Ctrl S"
                  busy={save.isPending && save.variables === false}
                  disabled={!partyId || !Number(amount) || over}
                  onClick={() => save.mutate(false)}
                >
                  Save draft
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  busy={save.isPending && save.variables === true}
                  disabled={!partyId || !Number(amount) || over}
                >
                  Post {k.one.toLowerCase()}
                </Button>
              </div>
            </div>
          }
        >
          <FormSection
            title={k.one}
            description="Posting gives it a number and settles the invoices."
          >
            <Field label={customer ? "Customer" : "Supplier"} required error={errors.partyId}>
              {(p) => (
                <Select
                  {...p}
                  value={partyId || undefined}
                  onValueChange={(v) => {
                    setPartyId(v);
                    setLines({});
                  }}
                  placeholder={customer ? "Who paid?" : "Who are we paying?"}
                  options={parties}
                />
              )}
            </Field>
            <Field label="Date" required error={errors.date}>
              {(p) => (
                <TextInput
                  {...p}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              )}
            </Field>
            <div className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-fg">Mode</span>
              <Segmented
                label="Mode"
                value={mode}
                onValueChange={setMode}
                options={MODES.map((m) => ({
                  value: m,
                  label: m === "CHEQUE" ? "Cheque" : m === "CASH" ? "Cash" : m,
                }))}
              />
            </div>
            <Field label="Amount" required error={errors.amount}>
              {(p) => (
                <NumberInput
                  {...p}
                  prefix="₹"
                  decimals={2}
                  value={amount}
                  onValueChange={setAmount}
                  onBlur={() => Object.keys(lines).length === 0 && void fill()}
                />
              )}
            </Field>
            {mode !== "CASH" ? (
              <Field
                label={mode === "CHEQUE" ? "Cheque no." : "UTR / reference"}
                required
                error={errors.reference}
              >
                {(p) => (
                  <TextInput
                    {...p}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            {mode === "CHEQUE" ? (
              <>
                <Field label="Bank">
                  {(p) => (
                    <TextInput
                      {...p}
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Cheque date" hint="If post-dated">
                  {(p) => (
                    <TextInput
                      {...p}
                      type="date"
                      value={instrumentDate}
                      onChange={(e) => setInstrumentDate(e.target.value)}
                    />
                  )}
                </Field>
              </>
            ) : null}
            <Field label="Notes" className="sm:col-span-2">
              {(p) => (
                <TextArea
                  {...p}
                  rows={1}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </Field>
          </FormSection>
          <div className="grid gap-3 border-t border-border pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Open invoices</h3>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  icon={ListOrdered}
                  disabled={!partyId || !Number(amount)}
                  onClick={() => void fill()}
                >
                  Oldest first
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!Object.keys(lines).length}
                  onClick={() => setLines({})}
                >
                  Clear
                </Button>
              </div>
            </div>
            {errors.allocations ? (
              <p className="text-sm text-danger">{errors.allocations}</p>
            ) : null}
            {!partyId ? (
              <p className="text-sm text-fg-2">
                Choose the {customer ? "customer" : "supplier"} to see what they owe.
              </p>
            ) : !open?.invoices.length ? (
              <EmptyState
                title="Nothing outstanding"
                hint="The whole amount will stay on account."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-2">
                    <tr>
                      <th className="px-3 py-2 font-medium">Invoice</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">Overdue</th>
                      <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                      <th className="w-40 px-3 py-2 text-right font-medium">Apply ₹</th>
                      <th className="w-32 px-3 py-2 text-right font-medium">TDS ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.invoices.map((inv) => {
                      const l = lines[inv.id];
                      const tooMuch =
                        l &&
                        D(l.amount || 0)
                          .plus(l.deduction || 0)
                          .greaterThan(inv.outstanding);
                      return (
                        <tr key={inv.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <Mono>{inv.docNo}</Mono>
                          </td>
                          <td className="px-3 py-2">{inv.date}</td>
                          <td className="px-3 py-2 text-right">
                            {inv.daysPastDue > 0 ? (
                              <Badge tone={inv.daysPastDue > 30 ? "danger" : "warning"}>
                                {inv.daysPastDue} days
                              </Badge>
                            ) : (
                              <span className="text-fg-3">—</span>
                            )}
                          </td>
                          <td className="tnum px-3 py-2 text-right">{rupees(inv.outstanding)}</td>
                          <td className="px-3 py-1.5">
                            <NumberInput
                              aria-label={`Apply to ${inv.docNo}`}
                              aria-invalid={tooMuch || undefined}
                              decimals={2}
                              value={l?.amount ?? ""}
                              onValueChange={(v) => setLine(inv.id, { amount: v })}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <NumberInput
                              aria-label={`TDS on ${inv.docNo}`}
                              decimals={2}
                              value={l?.deduction ?? ""}
                              onValueChange={(v) => setLine(inv.id, { deduction: v })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {open?.credits.length ? (
              <p className="text-sm text-fg-2">
                Also unused:{" "}
                {open.credits.map((c) => `${c.docNo} ${rupees(c.available)}`).join(", ")} — apply it
                from the statement.
              </p>
            ) : null}
          </div>
        </Card>
      </form>
    </div>
  );
}
