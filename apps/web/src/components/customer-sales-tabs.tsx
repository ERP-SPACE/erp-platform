import type { CustomerLedger, ReceiptListItem, SiListItem, SoListItem } from "@erp/contracts";
import { D } from "@erp/domain";
import { Badge, Button, Card, DataTable, Mono, StatCard } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  CREDIT_REASON_LABEL,
  DOC_TONE,
  IRN_TONE,
  SO_TONE,
  STATUS_LABEL,
  ledgerQuery,
  siListQuery,
  soListQuery,
  rupees,
} from "../lib/sales.js";
import { MODE_LABEL, MONEY_TONE, moneyListQuery } from "../lib/collections.js";

const soColumns: ColumnDef<SoListItem, unknown>[] = [
  { accessorKey: "soNo", header: "Order", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  { accessorKey: "date", header: "Date" },
  {
    id: "progress",
    header: "Dispatched",
    meta: { numeric: true },
    accessorFn: (r) => r.dispatchedM,
    cell: (c) =>
      `${c.row.original.dispatchedM.toLocaleString("en-IN")} / ${c.row.original.orderedM.toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "total",
    header: "Value",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const r = c.row.original;
      return (
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={SO_TONE[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
          {r.heldReasons.map((h) => (
            <Badge key={h} tone="danger">
              {CREDIT_REASON_LABEL[h]}
            </Badge>
          ))}
        </span>
      );
    },
  },
];

export function CustomerOrdersTab({
  customerId,
  canCreate,
}: {
  customerId: string;
  canCreate: boolean;
}) {
  const { data, isLoading } = useQuery(soListQuery({ customerId }));
  const navigate = useNavigate();
  return (
    <Card
      title="Sales orders"
      padded={false}
      actions={
        canCreate ? (
          <Button asChild size="sm" variant="secondary" icon={Plus}>
            <Link to="/sales/orders/new">New order</Link>
          </Button>
        ) : null
      }
    >
      <DataTable
        caption="Customer's sales orders"
        data={data ?? []}
        loading={isLoading}
        columns={soColumns}
        getRowId={(r) => r.id}
        empty="No orders yet."
        onRowClick={(r) => void navigate({ to: "/sales/orders/$soId", params: { soId: r.id } })}
      />
    </Card>
  );
}

const siColumns: ColumnDef<SiListItem, unknown>[] = [
  {
    accessorKey: "siNo",
    header: "Invoice",
    cell: (c) =>
      c.getValue() ? (
        <Mono>{c.getValue() as string}</Mono>
      ) : (
        <span className="text-fg-3">Draft</span>
      ),
  },
  { accessorKey: "date", header: "Date" },
  { accessorKey: "dueDate", header: "Due" },
  {
    accessorKey: "total",
    header: "Total",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "outstanding",
    header: "Outstanding",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const r = c.row.original;
      return (
        <span className="flex gap-1.5">
          <Badge tone={DOC_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
          {r.einvoiceStatus !== "NotRequired" ? (
            <Badge tone={IRN_TONE[r.einvoiceStatus]}>{STATUS_LABEL[r.einvoiceStatus]}</Badge>
          ) : null}
        </span>
      );
    },
  },
];

export function CustomerInvoicesTab({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery(siListQuery({ customerId }));
  const navigate = useNavigate();
  return (
    <Card title="Invoices" padded={false}>
      <DataTable
        caption="Customer's invoices"
        data={data ?? []}
        loading={isLoading}
        columns={siColumns}
        getRowId={(r) => r.id}
        empty="No invoices yet."
        onRowClick={(r) => void navigate({ to: "/sales/invoices/$siId", params: { siId: r.id } })}
      />
    </Card>
  );
}

type Entry = CustomerLedger["entries"][number];
const DOC_LINK: Record<Entry["docType"], string | null> = {
  SI: "/sales/invoices/$siId",
  CN: "/sales/notes/$noteId",
  DN: "/sales/notes/$noteId",
  OPENING: null,
  RC: "/collections/$kind/$moneyId",
  REV: "/collections/$kind/$moneyId",
  TDS: null,
};

/** Sub-ledger: invoices and debit notes debit; notes, receipts and TDS credit; running balance. */
export function CustomerLedgerTab({ customerId }: { customerId: string }) {
  const { data } = useQuery(ledgerQuery(customerId));
  const money = (v: string) => (D(v).isZero() ? "" : rupees(v));
  const columns: ColumnDef<Entry, unknown>[] = [
    { accessorKey: "date", header: "Date" },
    {
      accessorKey: "docNo",
      header: "Document",
      cell: (c) => {
        const e = c.row.original;
        const to = DOC_LINK[e.docType];
        if (!to || !e.docId) return <span>{e.docNo}</span>;
        return (
          <Link
            to={to}
            params={
              e.docType === "SI"
                ? { siId: e.docId }
                : e.docType === "RC" || e.docType === "REV"
                  ? { kind: "receipts", moneyId: e.docId }
                  : { noteId: e.docId }
            }
            className="text-primary hover:underline"
          >
            <Mono>{e.docNo}</Mono>
          </Link>
        );
      },
    },
    { accessorKey: "dueDate", header: "Due", cell: (c) => (c.getValue() as string) ?? "" },
    {
      accessorKey: "debit",
      header: "Debit",
      meta: { numeric: true },
      cell: (c) => money(c.getValue() as string),
    },
    {
      accessorKey: "credit",
      header: "Credit",
      meta: { numeric: true },
      cell: (c) => money(c.getValue() as string),
    },
    {
      accessorKey: "balance",
      header: "Balance",
      meta: { numeric: true },
      cell: (c) => <span className="font-medium">{rupees(c.getValue() as string)}</span>,
    },
  ];
  if (!data) return null;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Balance" value={rupees(data.closing)} />
        {data.aging.map((a) => (
          <StatCard key={a.bucket} label={a.bucket} value={rupees(a.amount)} />
        ))}
      </div>
      <Card
        title="Ledger"
        padded={false}
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link
              to="/collections/statement/$party/$partyId"
              params={{ party: "CUSTOMER", partyId: customerId }}
            >
              Statement & PDF
            </Link>
          </Button>
        }
      >
        <DataTable
          caption="Customer ledger"
          data={data.entries}
          columns={columns}
          getRowId={(e) => `${e.docType}-${e.docNo}`}
          empty="Nothing billed yet."
        />
      </Card>
    </div>
  );
}

const receiptColumns: ColumnDef<ReceiptListItem, unknown>[] = [
  {
    accessorKey: "docNo",
    header: "Receipt",
    cell: (c) =>
      c.getValue() ? (
        <Mono>{c.getValue() as string}</Mono>
      ) : (
        <span className="text-fg-3">Draft</span>
      ),
  },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "mode",
    header: "Mode",
    cell: (c) => MODE_LABEL[c.getValue() as ReceiptListItem["mode"]],
  },
  {
    accessorKey: "amount",
    header: "Amount",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "unallocated",
    header: "On account",
    meta: { numeric: true },
    cell: (c) =>
      Number(c.getValue()) ? <Badge tone="warning">{rupees(c.getValue() as string)}</Badge> : "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge tone={MONEY_TONE[c.getValue() as ReceiptListItem["status"]]}>
        {c.getValue() as string}
      </Badge>
    ),
  },
];

export function CustomerReceiptsTab({
  customerId,
  canCreate,
}: {
  customerId: string;
  canCreate: boolean;
}) {
  const { data, isLoading } = useQuery(moneyListQuery("receipts", { partyId: customerId }));
  const navigate = useNavigate();
  return (
    <Card
      title="Receipts"
      padded={false}
      actions={
        canCreate ? (
          <Button asChild size="sm" variant="secondary" icon={Plus}>
            <Link
              to="/collections/$kind/new"
              params={{ kind: "receipts" }}
              search={{ partyId: customerId }}
            >
              New receipt
            </Link>
          </Button>
        ) : null
      }
    >
      <DataTable
        caption="Customer's receipts"
        data={data ?? []}
        loading={isLoading}
        columns={receiptColumns}
        getRowId={(r) => r.id}
        empty="No money received yet."
        onRowClick={(r) =>
          void navigate({
            to: "/collections/$kind/$moneyId",
            params: { kind: "receipts", moneyId: r.id },
          })
        }
      />
    </Card>
  );
}
