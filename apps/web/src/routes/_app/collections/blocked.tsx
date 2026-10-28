import type { BlockedOrderItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { api, call } from "../../../lib/api.js";
import { blockedOrdersQuery } from "../../../lib/collections.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { dateTime } from "../../../lib/format.js";
import { can, keys, meQuery } from "../../../lib/queries.js";
import { CREDIT_REASON_LABEL, rupees } from "../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/blocked")({ component: BlockedPage });

const columns: ColumnDef<BlockedOrderItem, unknown>[] = [
  { accessorKey: "soNo", header: "Order", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "total",
    header: "Order value",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "reasons",
    header: "Why",
    cell: (c) => {
      const r = c.getValue() as BlockedOrderItem["reasons"];
      return r.length ? (
        <span className="flex flex-wrap gap-1">
          {r.map((x) => (
            <Badge key={x} tone="danger">
              {CREDIT_REASON_LABEL[x]}
            </Badge>
          ))}
        </span>
      ) : (
        <Badge tone="neutral">Held by hand</Badge>
      );
    },
  },
  {
    id: "exposure",
    header: "Exposure / limit",
    meta: { numeric: true },
    accessorFn: (r) => Number(r.exposure),
    cell: (c) => `${rupees(c.row.original.exposure)} / ${rupees(c.row.original.limit)}`,
  },
  {
    accessorKey: "maxDaysPastDue",
    header: "Overdue",
    meta: { numeric: true },
    cell: (c) => ((c.getValue() as number) > 0 ? `${c.getValue() as number} days` : "—"),
  },
  {
    id: "lastReceipt",
    header: "Last receipt",
    cell: (c) =>
      c.row.original.lastReceiptDate
        ? `${rupees(c.row.original.lastReceiptAmount!)} · ${c.row.original.lastReceiptDate}`
        : "None",
  },
  {
    accessorKey: "heldSince",
    header: "Held since",
    cell: (c) => dateTime(c.getValue() as string | null),
  },
];

/** Orders on hold, with why and the customer's latest payment; open one to re-check or release. */
function BlockedPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(blockedOrdersQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const nightly = useMutation({
    mutationFn: () =>
      call<{ checked: number; blocked: number; unblocked: number }>(() =>
        api.POST("/api/credit/nightly-check"),
      ),
    onSuccess: async (r) => {
      toast({
        tone: "success",
        title: `${r.checked} customers checked`,
        description: `${r.blocked} newly blocked, ${r.unblocked} unblocked.`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.collections });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: (e) => onError(e),
  });
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Blocked orders"
        description="Orders held for credit. Payments re-check them automatically; a manager can release one with a reason."
        breadcrumbs={[{ label: "Collections" }, { label: "Blocked orders" }]}
        actions={
          can(me, "customers.credit.manage") ? (
            <Button
              variant="secondary"
              icon={RefreshCw}
              busy={nightly.isPending}
              onClick={() => nightly.mutate()}
            >
              Run credit check now
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Blocked orders"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.soId}
        empty="No orders on hold."
        onRowClick={(r) => void navigate({ to: "/sales/orders/$soId", params: { soId: r.soId } })}
        searchPlaceholder="Search order or customer"
      />
    </div>
  );
}
