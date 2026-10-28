import type { SalesReturnDetail } from "@erp/contracts";
import { Badge, Button, ConfirmDialog, cn, useToast } from "@erp/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PackageCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { ScanInput } from "../../components/scan-input.js";
import { useApiErrorToast } from "../../lib/errors.js";
import { scanFeedback } from "../../lib/floor.js";
import { keys } from "../../lib/queries.js";
import { docAction, metres, srListQuery, srQuery } from "../../lib/sales.js";

export const Route = createFileRoute("/floor/inspect")({ component: FloorInspect });

type Waiting = SalesReturnDetail["rolls"][number] & {
  returnId: string;
  srNo: string | null;
  customerName: string;
  reason: string;
};

/**
 * Returned rolls waiting for inspection (ADR-0015): scan one, look at it, then back to stock
 * (same barcode, its new length) or scrap. Short pieces are suggested for scrap.
 */
function FloorInspect() {
  const { data: list } = useQuery(srListQuery({ status: "Posted" }));
  const open = (list ?? []).filter((r) => r.awaitingInspection > 0);
  const details = useQueries({ queries: open.map((r) => srQuery(r.id)) });
  const waiting: Waiting[] = details.flatMap((d) =>
    d.data
      ? d.data.rolls
          .filter((r) => r.rollStatus === "Returned")
          .map((r) => ({
            ...r,
            returnId: d.data!.id,
            srNo: d.data!.srNo,
            customerName: d.data!.customerName,
            reason: d.data!.reason,
          }))
      : [],
  );
  const [current, setCurrent] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [scrapping, setScrapping] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const roll = waiting.find((w) => w.barcode === current);

  const inspect = useMutation({
    mutationFn: (v: { w: Waiting; outcome: "RESTOCK" | "SCRAP" }) =>
      docAction<SalesReturnDetail>("/api/sales-returns/{id}/inspect", v.w.returnId, {
        rollId: v.w.rollId,
        outcome: v.outcome,
      }),
    onSuccess: async (_r, v) => {
      scanFeedback(true);
      setScrapping(false);
      setCurrent(undefined);
      toast({
        tone: "success",
        title: v.outcome === "RESTOCK" ? `${v.w.barcode} back in stock` : `${v.w.barcode} scrapped`,
        description:
          v.outcome === "RESTOCK"
            ? `${metres(v.w.returnedM)} on the shelf; reprint its label if the length changed.`
            : undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.sales }),
        queryClient.invalidateQueries({ queryKey: keys.inventory }),
      ]);
    },
    onError: (e) => onError(e, keys.sales),
  });

  const onScan = (barcode: string) => {
    if (waiting.some((w) => w.barcode === barcode)) {
      setProblem(undefined);
      setCurrent(barcode);
    } else {
      scanFeedback(false);
      setProblem(`${barcode} isn't waiting for inspection.`);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <h1 className="text-xl font-semibold text-fg">Inspect returns</h1>
      <ScanInput onScan={onScan} label="Scan a returned roll" />
      {problem ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 font-medium text-danger"
        >
          {problem}
        </p>
      ) : null}
      {roll ? (
        <article
          className={cn(
            "grid gap-4 rounded-xl border-2 bg-surface p-5 shadow-card",
            roll.suggestScrap ? "border-warning" : "border-primary",
          )}
        >
          <div>
            <p className="font-mono text-lg font-semibold text-fg">{roll.barcode}</p>
            <p className="text-lg text-fg">{roll.description}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="text-sm text-fg-3">Came back</dt>
              <dd className="text-base font-medium">
                {metres(roll.returnedM)} of {metres(roll.dispatchedM)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-fg-3">From</dt>
              <dd className="text-base font-medium">{roll.customerName}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-sm text-fg-3">Reason</dt>
              <dd className="text-base font-medium">{roll.reason}</dd>
            </div>
          </dl>
          {roll.suggestScrap ? (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
              Shorter than the minimum usable length — scrap unless it's needed.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              icon={Trash2}
              className="h-14 text-base"
              onClick={() => setScrapping(true)}
            >
              Scrap
            </Button>
            <Button
              variant="primary"
              icon={PackageCheck}
              className="h-14 text-base"
              busy={inspect.isPending && inspect.variables?.outcome === "RESTOCK"}
              onClick={() => inspect.mutate({ w: roll, outcome: "RESTOCK" })}
            >
              Back to stock
            </Button>
          </div>
        </article>
      ) : null}
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold text-fg-2">Waiting · {waiting.length}</h2>
        {waiting.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface shadow-card">
            {waiting.map((w) => (
              <li key={w.rollId}>
                <button
                  type="button"
                  aria-current={w.barcode === current ? "true" : undefined}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted aria-[current=true]:bg-primary-soft"
                  onClick={() => setCurrent(w.barcode)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-base text-fg">{w.barcode}</span>
                    <span className="text-sm text-fg-3">
                      {metres(w.returnedM)} · {w.customerName}
                    </span>
                  </span>
                  {w.suggestScrap ? <Badge tone="warning">Short</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-fg-3 shadow-card">
            Nothing waiting. Returns appear here once posted in the office.
          </p>
        )}
      </section>
      <ConfirmDialog
        open={scrapping && Boolean(roll)}
        onOpenChange={setScrapping}
        title={`Scrap ${roll?.barcode}?`}
        description="It leaves stock for good; its cost is written off."
        confirmLabel="Scrap roll"
        tone="danger"
        busy={inspect.isPending}
        onConfirm={() => roll && inspect.mutate({ w: roll, outcome: "SCRAP" })}
      />
    </div>
  );
}
