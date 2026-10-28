import type { OpenItemsResponse, PartyStatement } from "@erp/contracts";
import { D } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Mono,
  NumberInput,
  PageHeader,
  StatCard,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { FileDown, Plus, Wand2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { crumbLink } from "../../../../../components/sales-bits.js";
import { api, call } from "../../../../../lib/api.js";
import {
  type PartyType,
  openAccountPdf,
  openItemsQuery,
  statementQuery,
} from "../../../../../lib/collections.js";
import { useApiErrorToast } from "../../../../../lib/errors.js";
import { can, keys, meQuery } from "../../../../../lib/queries.js";
import { rupees } from "../../../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/statement/$party/$partyId")({
  params: {
    parse: (p) => {
      if (p.party !== "CUSTOMER" && p.party !== "SUPPLIER") throw notFound();
      return { party: p.party as PartyType, partyId: p.partyId };
    },
    stringify: (p) => p,
  },
  validateSearch: z.object({ from: z.string().optional(), to: z.string().optional() }),
  component: StatementPage,
});

type Entry = PartyStatement["entries"][number];
const LINK: Partial<
  Record<Entry["docType"], (id: string) => { to: string; params: Record<string, string> }>
> = {
  SI: (id) => ({ to: "/sales/invoices/$siId", params: { siId: id } }),
  CN: (id) => ({ to: "/sales/notes/$noteId", params: { noteId: id } }),
  RC: (id) => ({ to: "/collections/$kind/$moneyId", params: { kind: "receipts", moneyId: id } }),
  REV: (id) => ({ to: "/collections/$kind/$moneyId", params: { kind: "receipts", moneyId: id } }),
  PY: (id) => ({ to: "/collections/$kind/$moneyId", params: { kind: "payments", moneyId: id } }),
};

function StatementPage() {
  const { party, partyId } = Route.useParams();
  const range = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: me } = useQuery(meQuery);
  const { data: st } = useQuery(statementQuery(party, partyId, range));
  const { data: open } = useQuery(openItemsQuery(party, partyId));
  const [applying, setApplying] = useState<OpenItemsResponse["credits"][number] | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const onError = useApiErrorToast();
  const customer = party === "CUSTOMER";
  const columns: ColumnDef<Entry, unknown>[] = [
    { accessorKey: "date", header: "Date" },
    {
      accessorKey: "docNo",
      header: "Document",
      cell: (c) => {
        const e = c.row.original;
        const link =
          e.docId && (customer || e.docType === "PY") ? LINK[e.docType]?.(e.docId) : undefined;
        return link ? (
          <Link to={link.to} params={link.params} className="text-primary hover:underline">
            <Mono>{e.docNo}</Mono>
          </Link>
        ) : (
          <Mono>{e.docNo}</Mono>
        );
      },
    },
    { accessorKey: "description", header: "Particulars" },
    {
      accessorKey: "debit",
      header: "Debit",
      meta: { numeric: true },
      cell: (c) => (Number(c.getValue()) ? rupees(c.getValue() as string) : ""),
    },
    {
      accessorKey: "credit",
      header: "Credit",
      meta: { numeric: true },
      cell: (c) => (Number(c.getValue()) ? rupees(c.getValue() as string) : ""),
    },
    {
      accessorKey: "balance",
      header: "Balance",
      meta: { numeric: true },
      cell: (c) => <span className="font-medium">{rupees(c.getValue() as string)}</span>,
    },
  ];
  if (!st) return null;
  const canApply = can(me, customer ? "collections.receipt.manage" : "payables.payment.manage");
  return (
    <div className="grid gap-6">
      <PageHeader
        title={st.partyName}
        description={`Statement of account${st.gstin ? ` · GSTIN ${st.gstin}` : ""} · ${st.from} to ${st.to}`}
        breadcrumbs={[
          { label: "Collections" },
          { label: "Aging", href: "/collections/aging" },
          { label: st.partyName },
        ]}
        renderLink={crumbLink}
        actions={
          <>
            <Button
              variant="secondary"
              icon={FileDown}
              busy={pdfBusy}
              onClick={() => {
                setPdfBusy(true);
                const q = new URLSearchParams(
                  Object.entries(range).filter(([, v]) => v) as [string, string][],
                );
                openAccountPdf(
                  `/api/${customer ? "customers" : "suppliers"}/${partyId}/statement/pdf?${q}`,
                )
                  .catch((e: unknown) => onError(e))
                  .finally(() => setPdfBusy(false));
              }}
            >
              Statement PDF
            </Button>
            {can(me, customer ? "collections.receipt.manage" : "payables.payment.manage") ? (
              <Button asChild variant="primary" icon={Plus}>
                <Link
                  to="/collections/$kind/new"
                  params={{ kind: customer ? "receipts" : "payments" }}
                  search={{ partyId }}
                >
                  {customer ? "New receipt" : "New payment"}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={
            Number(st.closing) < 0
              ? customer
                ? "In credit (they paid ahead)"
                : "We paid ahead"
              : customer
                ? "Balance due from them"
                : "Balance we owe"
          }
          value={rupees(D(st.closing).abs())}
        />
        <StatCard label="Opening" value={rupees(st.opening)} />
        <StatCard label="On account / unused credit" value={rupees(st.onAccount)} />
        <StatCard
          label="Oldest bucket with money"
          value={[...st.aging].reverse().find((a) => Number(a.amount))?.label ?? "None"}
        />
      </div>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From">
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={range.from ?? ""}
                onChange={(e) =>
                  void navigate({ search: { ...range, from: e.target.value || undefined } })
                }
              />
            )}
          </Field>
          <Field label="To">
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={range.to ?? ""}
                onChange={(e) =>
                  void navigate({ search: { ...range, to: e.target.value || undefined } })
                }
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2 pb-0.5">
            {st.aging.map((a) => (
              <Badge key={a.label} tone={Number(a.amount) ? "warning" : "neutral"}>
                {a.label}: {rupees(a.amount)}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
      {open?.credits.length && canApply ? (
        <Card
          title="Unused money and notes"
          description="Apply them to open invoices — no new receipt needed."
        >
          <ul className="grid gap-2 text-sm">
            {open.credits.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span>
                  <Mono>{c.docNo}</Mono> · {c.date} ·{" "}
                  <span className="font-medium">{rupees(c.available)}</span> left
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Wand2}
                  disabled={!open.invoices.length}
                  onClick={() => setApplying(c)}
                >
                  Apply
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Entries" padded={false}>
        <DataTable
          caption="Statement entries"
          data={st.entries}
          columns={columns}
          getRowId={(e) => `${e.docType}-${e.docId}-${e.date}`}
          empty="Nothing in this period."
        />
      </Card>
      {applying && open ? (
        <ApplyDialog
          party={party}
          partyId={partyId}
          credit={applying}
          open={open}
          onClose={() => setApplying(null)}
        />
      ) : null}
    </div>
  );
}

function ApplyDialog({
  party,
  partyId,
  credit,
  open,
  onClose,
}: {
  party: PartyType;
  partyId: string;
  credit: OpenItemsResponse["credits"][number];
  open: OpenItemsResponse;
  onClose: () => void;
}) {
  // Oldest first, until the credit runs out.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    let left = D(credit.available);
    const out: Record<string, string> = {};
    for (const inv of open.invoices) {
      if (left.lessThanOrEqualTo(0)) break;
      const take = D(inv.outstanding).lessThan(left) ? D(inv.outstanding) : left;
      out[inv.id] = take.toFixed(2);
      left = left.minus(take);
    }
    return out;
  });
  const total = Object.values(amounts).reduce((s, v) => s.plus(v || 0), D(0));
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const apply = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST(
          (party === "CUSTOMER"
            ? "/api/customers/{id}/apply-credit"
            : "/api/suppliers/{id}/apply-credit") as "/api/customers/{id}/apply-credit",
          {
            params: { path: { id: partyId } },
            body: {
              source: credit.source,
              sourceId: credit.id,
              allocations: Object.entries(amounts)
                .filter(([, v]) => Number(v) > 0)
                .map(([invoiceId, amount]) => ({ invoiceId, amount: D(amount).toFixed(2) })),
            },
          },
        ),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: `${credit.docNo} applied` });
      await queryClient.invalidateQueries({ queryKey: keys.collections });
      onClose();
    },
    onError: (e) => onError(e, keys.collections),
  });
  const over = total.greaterThan(credit.available);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Apply ${credit.docNo}`}
      description={`${rupees(credit.available)} available.`}
      width="lg"
      footer={
        <>
          <span className={`mr-auto text-sm ${over ? "text-danger" : "text-fg-2"}`}>
            Applying {rupees(total)}
            {over ? " — more than available" : ""}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={apply.isPending}
            disabled={over || total.isZero()}
            onClick={() => apply.mutate()}
          >
            Apply
          </Button>
        </>
      }
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-fg-2">
          <tr>
            <th className="py-2 font-medium">Invoice</th>
            <th className="py-2 text-right font-medium">Outstanding</th>
            <th className="w-40 py-2 text-right font-medium">Apply ₹</th>
          </tr>
        </thead>
        <tbody>
          {open.invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-border">
              <td className="py-2">
                <Mono>{inv.docNo}</Mono> <span className="text-fg-3">· {inv.date}</span>
              </td>
              <td className="tnum py-2 text-right">{rupees(inv.outstanding)}</td>
              <td className="py-1.5 pl-3">
                <NumberInput
                  aria-label={`Apply to ${inv.docNo}`}
                  decimals={2}
                  value={amounts[inv.id] ?? ""}
                  onValueChange={(v) => setAmounts((a) => ({ ...a, [inv.id]: v }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
