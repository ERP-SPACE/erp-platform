import type { GrnDetail, GrnListItem } from "@erp/contracts";
import { Badge, Button, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Printer } from "lucide-react";
import { ApiError, api, call } from "../../lib/api.js";
import { useApiErrorToast } from "../../lib/errors.js";
import { DOC_TONE, grnListQuery, printLabels } from "../../lib/purchase.js";
import { can, keys, meQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/floor/receive")({ component: FloorReceive });

/**
 * Receiving at the godown: post the receipts the office drafted once the rolls are counted, then
 * print their labels. Over-receipts need the office's approval and are sent back there.
 */
function FloorReceive() {
  const { data, isLoading, error } = useQuery(grnListQuery);
  const drafts = (data ?? []).filter((g) => g.status === "Created");
  const posted = (data ?? []).filter((g) => g.status === "Posted").slice(0, 10);
  if (isLoading) return <p className="p-6 text-center text-fg-3">Loading receipts…</p>;
  if (error)
    return (
      <p role="alert" className="p-6 text-center text-danger">
        Couldn't load receipts — check the connection.
      </p>
    );
  return (
    <div className="grid gap-6">
      <Section
        title="To receive"
        empty="No receipts waiting. The office drafts them from purchase orders."
        items={drafts}
      />
      <Section title="Recently received" empty="Nothing received yet." items={posted} />
    </div>
  );
}

function Section({ title, empty, items }: { title: string; empty: string; items: GrnListItem[] }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {items.length ? (
        <ul className="grid gap-3">
          {items.map((g) => (
            <GrnCard key={g.id} grn={g} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-surface p-5 text-fg-3 shadow-card">{empty}</p>
      )}
    </section>
  );
}

function GrnCard({ grn }: { grn: GrnListItem }) {
  const { data: me } = useQuery(meQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const post = useMutation({
    mutationFn: () =>
      call<GrnDetail>(() =>
        api.POST("/api/goods-receipts/{id}/post", {
          params: { path: { id: grn.id } },
          body: { version: grn.version, approveOverReceipt: false },
        }),
      ),
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: `${saved.grnNo} received`,
        description: `${saved.rollCount} rolls created. Print their labels next.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.purchase }),
        queryClient.invalidateQueries({ queryKey: keys.inventory }),
      ]);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "APPROVAL_REQUIRED") {
        toast({
          tone: "warning",
          title: "More than ordered",
          description: "The office has to approve this receipt before it can be posted.",
        });
        return;
      }
      onError(e, keys.purchase);
    },
  });
  const print = useMutation({
    mutationFn: () => printLabels({ grnId: grn.id }),
    onError: (e) => onError(e),
  });
  return (
    <li className="grid gap-3 rounded-xl bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-semibold text-fg">{grn.grnNo}</p>
          <p className="truncate text-fg">{grn.supplierName}</p>
          <p className="text-sm text-fg-3">
            {grn.rollCount} rolls · {grn.acceptedM.toLocaleString("en-IN")} m
            {grn.poNo ? ` · ${grn.poNo}` : ""}
          </p>
        </div>
        <Badge tone={DOC_TONE[grn.status]}>
          {grn.status === "Posted" ? "Received" : "To receive"}
        </Badge>
      </div>
      {grn.status === "Created" && can(me, "purchase.receipt.manage") ? (
        <Button
          variant="primary"
          icon={CheckCircle2}
          className="h-12 text-base"
          busy={post.isPending}
          onClick={() => post.mutate()}
        >
          Post receipt
        </Button>
      ) : null}
      {grn.status === "Posted" && can(me, "labels.print") ? (
        <Button
          variant="secondary"
          icon={Printer}
          className="h-12 text-base"
          busy={print.isPending}
          onClick={() => print.mutate()}
        >
          Print {grn.rollCount} labels
        </Button>
      ) : null}
    </li>
  );
}
