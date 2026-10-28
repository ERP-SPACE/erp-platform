import type { CommissionEntryItem, CommissionSummary, PayoutListItem } from "@erp/contracts";
import { istToday } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Mono,
  PageHeader,
  Select,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { api, call } from "../../../../lib/api.js";
import {
  commissionEntriesQuery,
  commissionSummaryQuery,
  payoutsQuery,
} from "../../../../lib/collections.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import { rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/commission/")({
  validateSearch: z.object({ salesmanId: z.string().optional() }),
  component: CommissionPage,
});

const summaryColumns: ColumnDef<CommissionSummary, unknown>[] = [
  {
    accessorKey: "salesmanName",
    header: "Salesman",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "accrued",
    header: "Earned",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "paid",
    header: "Paid",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "outstanding",
    header: "To pay",
    meta: { numeric: true },
    cell: (c) =>
      Number(c.getValue()) ? (
        <span className="font-semibold">{rupees(c.getValue() as string)}</span>
      ) : (
        <span className="text-fg-3">—</span>
      ),
  },
];

const entryColumns: ColumnDef<CommissionEntryItem, unknown>[] = [
  { accessorKey: "date", header: "Date" },
  { accessorKey: "customerName", header: "Customer" },
  {
    id: "doc",
    header: "Document",
    cell: (c) => (
      <span className="grid">
        <Mono>{c.row.original.invoiceNo}</Mono>
        {c.row.original.sourceNo !== c.row.original.invoiceNo ? (
          <Mono className="text-xs text-fg-3">{c.row.original.sourceNo}</Mono>
        ) : null}
      </span>
    ),
  },
  {
    id: "basis",
    header: "Basis",
    cell: (c) =>
      c.row.original.reversalReason ?? (
        <span className="text-fg-2">
          {c.row.original.method === "PERCENT_SALES"
            ? `${c.row.original.rate} % of sales`
            : `₹${c.row.original.rate}/m`}
          {c.row.original.sourceType === "RC" ? " · on payment" : ""}
        </span>
      ),
  },
  {
    accessorKey: "amount",
    header: "Commission",
    meta: { numeric: true },
    cell: (c) => (
      <span className={Number(c.getValue()) < 0 ? "text-danger" : undefined}>
        {rupees(c.getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge tone={c.getValue() === "Paid" ? "success" : "warning"}>
        {c.getValue() === "Paid" ? `Paid · ${c.row.original.payoutNo}` : "To pay"}
      </Badge>
    ),
  },
];

const payoutColumns: ColumnDef<PayoutListItem, unknown>[] = [
  { accessorKey: "payoutNo", header: "Payout", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  { accessorKey: "salesmanName", header: "Salesman" },
  { accessorKey: "upTo", header: "Up to" },
  {
    accessorKey: "net",
    header: "Net",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge
        tone={c.getValue() === "Paid" ? "success" : c.getValue() === "Draft" ? "neutral" : "danger"}
      >
        {c.getValue() as string}
      </Badge>
    ),
  },
];

/** Commission (PRD §5.6): what each salesman earned, what is paid, and payout batches (Q34). */
function CommissionPage() {
  const { salesmanId } = Route.useSearch();
  const { data: me } = useQuery(meQuery);
  const { data: summary, isLoading } = useQuery(commissionSummaryQuery);
  const { data: entries } = useQuery({
    ...commissionEntriesQuery({ salesmanId }),
    enabled: Boolean(salesmanId),
  });
  const { data: payouts } = useQuery(payoutsQuery(salesmanId));
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate({ from: Route.fullPath });
  const chosen = summary?.find((s) => s.salesmanId === salesmanId);
  return (
    <div className="grid gap-6">
      <PageHeader
        title={chosen ? `Commission · ${chosen.salesmanName}` : "Commission"}
        description="Earned when an invoice posts or as it is paid (per the customer's rule); credit notes and bounced cheques take back their share."
        breadcrumbs={[{ label: "Collections" }, { label: "Commission" }]}
        actions={
          can(me, "commission.payout.manage") ? (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New payout
            </Button>
          ) : null
        }
      />
      <Card title="By salesman" padded={false}>
        <DataTable
          caption="Commission by salesman"
          data={summary ?? []}
          loading={isLoading}
          columns={summaryColumns}
          getRowId={(r) => r.salesmanId}
          selectedId={salesmanId ?? null}
          pageSize={false}
          onRowClick={(r) => void navigate({ search: { salesmanId: r.salesmanId } })}
        />
      </Card>
      {salesmanId ? (
        <Card title="Entries" padded={false}>
          <DataTable
            caption="Commission entries"
            data={entries ?? []}
            columns={entryColumns}
            getRowId={(r) => r.id}
            empty="No commission yet."
          />
        </Card>
      ) : (
        <p className="text-sm text-fg-2">Choose a salesman to see each invoice's commission.</p>
      )}
      <Card title="Payouts" padded={false}>
        <DataTable
          caption="Commission payouts"
          data={payouts ?? []}
          columns={payoutColumns}
          getRowId={(r) => r.id}
          empty="No payouts yet."
          onRowClick={(r) =>
            void navigate({ to: "/collections/commission/$payoutId", params: { payoutId: r.id } })
          }
        />
      </Card>
      {creating ? (
        <NewPayoutDialog
          summary={summary ?? []}
          initial={salesmanId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function NewPayoutDialog({
  summary,
  initial,
  onClose,
}: {
  summary: CommissionSummary[];
  initial?: string;
  onClose: () => void;
}) {
  const [salesmanId, setSalesmanId] = useState(initial ?? "");
  const [upTo, setUpTo] = useState(istToday());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();
  const create = useMutation({
    mutationFn: () =>
      call<{ id: string }>(() =>
        api.POST("/api/commission/payouts", { body: { salesmanId, upTo } }),
      ),
    onSuccess: async (p) => {
      toast({ tone: "success", title: "Payout drafted", description: "Check it, then pay it." });
      await queryClient.invalidateQueries({ queryKey: keys.collections });
      void navigate({ to: "/collections/commission/$payoutId", params: { payoutId: p.id } });
    },
    onError: (e) => onError(e, keys.collections),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New commission payout"
      description="It settles everything earned up to the date when you pay it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={create.isPending}
            disabled={!salesmanId}
            onClick={() => create.mutate()}
          >
            Draft payout
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Salesman" required>
          {(p) => (
            <Select
              {...p}
              value={salesmanId || undefined}
              onValueChange={setSalesmanId}
              placeholder="Choose"
              options={summary.map((s) => ({
                value: s.salesmanId,
                label: `${s.salesmanName} · ${rupees(s.outstanding)} to pay`,
              }))}
            />
          )}
        </Field>
        <Field label="Up to" required>
          {(p) => (
            <TextInput {...p} type="date" value={upTo} onChange={(e) => setUpTo(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
