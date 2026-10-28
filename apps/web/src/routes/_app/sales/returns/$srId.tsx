import type { SalesReturnDetail } from "@erp/contracts";
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
import { CheckCircle2, PackageCheck, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { DocTitle, TotalsCard, crumbLink } from "../../../../components/sales-bits.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import { DOC_TONE, docAction, metres, srQuery, rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/returns/$srId")({ component: SrPage });

type Roll = SalesReturnDetail["rolls"][number];

function SrPage() {
  const { srId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: sr } = useQuery(srQuery(srId));
  const [confirm, setConfirm] = useState<"post" | "cancel" | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.sales }),
      queryClient.invalidateQueries({ queryKey: keys.inventory }),
    ]);
  const act = useMutation({
    mutationFn: (a: "post" | "cancel") =>
      docAction<SalesReturnDetail>(`/api/sales-returns/{id}/${a}`, srId, { version: sr!.version }),
    onSuccess: async (saved) => {
      setConfirm(null);
      toast({
        tone: "success",
        title:
          saved.status === "Posted" ? `Posted · credit note ${saved.cnNo}` : "Return cancelled",
        description:
          saved.status === "Posted" ? "Now inspect each roll: back to stock or scrap." : undefined,
      });
      await refresh();
    },
    onError: (e) => onError(e, keys.sales),
  });
  const inspect = useMutation({
    mutationFn: (v: { rollId: string; outcome: "RESTOCK" | "SCRAP" }) =>
      docAction<SalesReturnDetail>("/api/sales-returns/{id}/inspect", srId, { ...v }),
    onSuccess: async (_s, v) => {
      toast({ tone: "success", title: v.outcome === "RESTOCK" ? "Back in stock" : "Scrapped" });
      await refresh();
    },
    onError: (e) => onError(e, keys.sales),
  });
  if (!sr) return null;
  const manage = can(me, "sales.return.manage");
  const columns: ColumnDef<Roll, unknown>[] = [
    {
      accessorKey: "barcode",
      header: "Roll",
      cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
    },
    { accessorKey: "description", header: "Product" },
    {
      accessorKey: "dispatchedM",
      header: "Sent",
      meta: { numeric: true },
      cell: (c) => metres(c.getValue() as number),
    },
    {
      accessorKey: "returnedM",
      header: "Back",
      meta: { numeric: true },
      cell: (c) => metres(c.getValue() as number),
    },
    {
      accessorKey: "taxable",
      header: "Credit (taxable)",
      meta: { numeric: true },
      cell: (c) => rupees(c.getValue() as string),
    },
    ...(sr.rolls.some((r) => r.cost !== null)
      ? [
          {
            accessorKey: "cost",
            header: "Cost back to stock",
            meta: { numeric: true },
            cell: (c: { getValue: () => unknown }) =>
              c.getValue() ? rupees(c.getValue() as string) : "—",
          } as ColumnDef<Roll, unknown>,
        ]
      : []),
    {
      id: "inspect",
      header: "Inspection",
      cell: (c) => {
        const r = c.row.original;
        if (r.rollStatus !== "Returned")
          return (
            <Badge tone={r.rollStatus === "Scrap" ? "danger" : "success"}>
              {r.rollStatus === "Scrap" ? "Scrapped" : "In stock"}
            </Badge>
          );
        if (sr.status !== "Posted" || !manage) return <Badge tone="warning">Awaiting</Badge>;
        const busy = inspect.isPending && inspect.variables?.rollId === r.rollId;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {r.suggestScrap ? <Badge tone="warning">Short — scrap?</Badge> : null}
            <Button
              size="sm"
              variant="secondary"
              icon={PackageCheck}
              busy={busy && inspect.variables?.outcome === "RESTOCK"}
              onClick={() => inspect.mutate({ rollId: r.rollId, outcome: "RESTOCK" })}
            >
              Restock
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              busy={busy && inspect.variables?.outcome === "SCRAP"}
              onClick={() => inspect.mutate({ rollId: r.rollId, outcome: "SCRAP" })}
            >
              Scrap
            </Button>
          </span>
        );
      },
    },
  ];
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <DocTitle
            number={sr.srNo}
            draftLabel="Draft return"
            status={sr.status}
            tone={DOC_TONE[sr.status] ?? "neutral"}
          />
        }
        description={
          <>
            {sr.customerName} · invoice{" "}
            <Link
              to="/sales/invoices/$siId"
              params={{ siId: sr.siId }}
              className="text-primary hover:underline"
            >
              <Mono>{sr.siNo}</Mono>
            </Link>{" "}
            · {sr.date} · {sr.reason}
          </>
        }
        breadcrumbs={[
          { label: "Sales" },
          { label: "Returns", href: "/sales/returns" },
          { label: sr.srNo ?? "Draft" },
        ]}
        renderLink={crumbLink}
        actions={
          sr.status === "Draft" && manage ? (
            <>
              <Button variant="secondary" icon={XCircle} onClick={() => setConfirm("cancel")}>
                Cancel draft
              </Button>
              <Button variant="primary" icon={CheckCircle2} onClick={() => setConfirm("post")}>
                Post and issue credit note
              </Button>
            </>
          ) : sr.cnId ? (
            <Button asChild variant="secondary">
              <Link to="/sales/notes/$noteId" params={{ noteId: sr.cnId }}>
                Credit note {sr.cnNo}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Rolls" padded={false}>
          <DataTable
            caption="Returned rolls"
            data={sr.rolls}
            columns={columns}
            getRowId={(r) => r.rollId}
            pageSize={false}
          />
        </Card>
        <div className="grid content-start gap-6">
          <TotalsCard totals={sr.totals} title="Credit note" />
          <Card>
            <DefinitionList
              columns={1}
              items={[
                { label: "Rolls", value: `${sr.rollCount} · ${metres(sr.returnedM)}` },
                { label: "Awaiting inspection", value: String(sr.awaitingInspection) },
                { label: "Notes", value: sr.notes ?? "—" },
              ]}
            />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "post" ? "Post this return?" : "Cancel this draft?"}
        description={
          confirm === "post"
            ? `The rolls come back as Returned (same barcodes, new lengths) and a credit note for ${rupees(sr.totals.total)} is issued.`
            : undefined
        }
        confirmLabel={confirm === "post" ? "Post return" : "Cancel draft"}
        tone={confirm === "cancel" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </div>
  );
}
