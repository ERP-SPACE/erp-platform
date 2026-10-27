import type { PurchaseReturnDetail } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DefinitionList,
  Mono,
  PageHeader,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { DOC_TONE, returnQuery } from "../../../../lib/purchase.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/returns/$prId")({ component: ReturnPage });

type RollLine = PurchaseReturnDetail["rolls"][number];
const columns: ColumnDef<RollLine, unknown>[] = [
  {
    accessorKey: "barcode",
    header: "Roll",
    cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
  },
  { accessorKey: "description", header: "Item" },
  {
    accessorKey: "lengthM",
    header: "Length",
    meta: { numeric: true },
    cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "ratePerM",
    header: "Rate ₹/m",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
  {
    accessorKey: "amount",
    header: "Amount",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
];

function ReturnPage() {
  const { prId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: pr } = useQuery(returnQuery(prId));
  const [confirm, setConfirm] = useState<"post" | "cancel" | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const act = useMutation({
    mutationFn: (action: "post" | "cancel") =>
      call<PurchaseReturnDetail>(() =>
        action === "post"
          ? api.POST("/api/purchase-returns/{id}/post", {
              params: { path: { id: prId } },
              body: { version: pr!.version },
            })
          : api.POST("/api/purchase-returns/{id}/cancel", {
              params: { path: { id: prId } },
              body: { version: pr!.version },
            }),
      ),
    onSuccess: async (saved) => {
      setConfirm(null);
      toast({
        tone: "success",
        title: saved.status === "Posted" ? `Posted · debit note ${saved.dnNo}` : "Return cancelled",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.purchase }),
        queryClient.invalidateQueries({ queryKey: keys.inventory }),
      ]);
    },
    onError: (e) => onError(e, keys.purchase),
  });
  if (!pr) return null;
  const manage = can(me, "purchase.return.manage") && pr.status === "Draft";
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {pr.prNo ? <Mono>{pr.prNo}</Mono> : "Draft return"}
            <Badge tone={DOC_TONE[pr.status]}>{pr.status}</Badge>
          </span>
        }
        description={`${pr.supplierName} · ${pr.date} · ${pr.reason}`}
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Returns", href: "/purchase/returns" },
          { label: pr.prNo ?? "Draft" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
        actions={
          manage ? (
            <>
              <Button variant="secondary" onClick={() => setConfirm("cancel")}>
                Cancel draft
              </Button>
              <Button variant="primary" icon={CheckCircle2} onClick={() => setConfirm("post")}>
                Post and issue debit note
              </Button>
            </>
          ) : null
        }
      />
      <Card>
        <DefinitionList
          columns={3}
          items={[
            { label: "Rolls", value: `${pr.rollCount} · ${pr.metres.toLocaleString("en-IN")} m` },
            {
              label: "Taxable value",
              value: <span className="tnum">{formatINR(pr.totals.taxable)}</span>,
            },
            {
              label: "GST",
              value: (
                <span className="tnum">
                  {formatINR(
                    (
                      Number(pr.totals.cgst) +
                      Number(pr.totals.sgst) +
                      Number(pr.totals.igst)
                    ).toFixed(2),
                  )}
                </span>
              ),
            },
            {
              label: "Debit note total",
              value: <span className="tnum font-semibold">{formatINR(pr.totals.total)}</span>,
            },
            { label: "Debit note", value: pr.dnNo ? <Mono>{pr.dnNo}</Mono> : "Issued on posting" },
            { label: "Notes", value: pr.notes ?? "—" },
          ]}
        />
      </Card>
      <Card title="Rolls" padded={false}>
        <DataTable
          caption="Returned rolls"
          data={pr.rolls}
          columns={columns}
          getRowId={(r) => r.rollId}
          pageSize={false}
        />
      </Card>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "post" ? "Post this return?" : "Cancel this draft?"}
        description={
          confirm === "post"
            ? `The rolls leave stock and debit note for ${formatINR(pr.totals.total)} is issued.`
            : "The rolls become available again."
        }
        confirmLabel={confirm === "post" ? "Post return" : "Cancel draft"}
        tone={confirm === "cancel" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </div>
  );
}
