import type { EInvoiceInfo, EInvoiceQueueItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { ApiError, api, call } from "../../../lib/api.js";
import { can, keys, meQuery } from "../../../lib/queries.js";
import { IRN_TONE, STATUS_LABEL, irnQueueQuery, rupees } from "../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/irn")({ component: IrnQueuePage });

/** ADR-0011: posted B2B documents still without an IRN, oldest first, with the deadline. */
function IrnQueuePage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(irnQueueQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const retry = useMutation({
    mutationFn: (q: EInvoiceQueueItem) =>
      call<EInvoiceInfo>(() =>
        api.POST("/api/einvoice/{docType}/{id}/generate", {
          params: { path: { docType: q.docType, id: q.id } },
        }),
      ),
    onSuccess: async (_r, q) => {
      toast({ tone: "success", title: `IRN generated for ${q.docNo}` });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: async (e, q) => {
      toast({
        tone: "danger",
        title: `${q.docNo}: the portal didn't accept it`,
        description: e instanceof ApiError ? e.problem.title : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
  });
  const manage = can(me, "compliance.einvoice.manage");
  const columns: ColumnDef<EInvoiceQueueItem, unknown>[] = [
    {
      accessorKey: "docNo",
      header: "Document",
      cell: (c) => (
        <span className="flex items-center gap-2">
          <Badge tone="neutral">{c.row.original.docType}</Badge>
          <Mono>{c.getValue() as string}</Mono>
        </span>
      ),
    },
    { accessorKey: "date", header: "Date" },
    {
      accessorKey: "customerName",
      header: "Customer",
      cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
    },
    {
      accessorKey: "total",
      header: "Total",
      meta: { numeric: true },
      cell: (c) => rupees(c.getValue() as string),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: (c) => {
        const s = c.getValue() as EInvoiceQueueItem["status"];
        return <Badge tone={IRN_TONE[s]}>{STATUS_LABEL[s] ?? s}</Badge>;
      },
    },
    {
      accessorKey: "daysLeft",
      header: "Deadline",
      meta: { numeric: true },
      cell: (c) => {
        const d = c.getValue() as number;
        return (
          <span className={d <= 5 ? "font-medium text-danger" : undefined}>
            {d < 0 ? "Passed" : `${d} days`}
          </span>
        );
      },
    },
    {
      accessorKey: "lastError",
      header: "Last error",
      cell: (c) => (
        <span className="line-clamp-2 max-w-sm text-xs text-fg-2">
          {(c.getValue() as string) ?? "—"}
        </span>
      ),
    },
    ...(manage
      ? [
          {
            id: "retry",
            header: "",
            cell: (c: { row: { original: EInvoiceQueueItem } }) => (
              <Button
                size="sm"
                variant="secondary"
                icon={RefreshCw}
                busy={retry.isPending && retry.variables?.id === c.row.original.id}
                onClick={(e) => {
                  e.stopPropagation();
                  retry.mutate(c.row.original);
                }}
              >
                Retry
              </Button>
            ),
          } as ColumnDef<EInvoiceQueueItem, unknown>,
        ]
      : []),
  ];
  return (
    <div className="grid gap-6">
      <PageHeader
        title="IRN queue"
        description="Posted invoices and notes still waiting for their IRN. Outages retry by themselves; rejected ones need fixing."
        breadcrumbs={[{ label: "Sales" }, { label: "IRN queue" }]}
      />
      <DataTable
        caption="Documents waiting for an IRN"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        empty="Every posted invoice and note has its IRN."
        onRowClick={(r) =>
          void (r.docType === "SI"
            ? navigate({ to: "/sales/invoices/$siId", params: { siId: r.id } })
            : navigate({ to: "/sales/notes/$noteId", params: { noteId: r.id } }))
        }
      />
    </div>
  );
}
