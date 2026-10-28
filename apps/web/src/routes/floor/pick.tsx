import type { DcCutResult, DcDetail } from "@erp/contracts";
import { istToday } from "@erp/domain";
import { Badge, Button, ConfirmDialog, Dialog, Field, NumberInput, cn, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Printer,
  Scissors,
  Truck,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ScanInput } from "../../components/scan-input.js";
import { ApiError, api, call } from "../../lib/api.js";
import { useApiErrorToast } from "../../lib/errors.js";
import { scanFeedback } from "../../lib/floor.js";
import { printLabels, rollQuery } from "../../lib/purchase.js";
import { keys, queryClient as rootClient } from "../../lib/queries.js";
import {
  allocationQuery,
  count,
  dcListQuery,
  dcQuery,
  docAction,
  metres,
  soListQuery,
  soQuery,
} from "../../lib/sales.js";

export const Route = createFileRoute("/floor/pick")({
  validateSearch: z.object({ dc: z.string().optional() }),
  component: FloorPick,
});

/** Picking at the godown (PRD §6.3): choose a job, scan rolls, cut when told, dispatch. */
function FloorPick() {
  const { dc } = Route.useSearch();
  return dc ? <PickChallan dcId={dc} /> : <PickJobs />;
}

function PickJobs() {
  const { data: drafts } = useQuery(dcListQuery({ status: "Draft" }));
  const { data: orders } = useQuery(soListQuery());
  const navigate = useNavigate();
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const busyIds = new Set((drafts ?? []).map((d) => d.soId));
  const ready = (orders ?? []).filter(
    (o) => (o.status === "Confirmed" || o.status === "PartiallyFulfilled") && !busyIds.has(o.id),
  );
  const start = useMutation({
    mutationFn: (soId: string) =>
      call<DcDetail>(() =>
        api.POST("/api/delivery-challans", { body: { soId, date: istToday() } }),
      ),
    onSuccess: async (d) => {
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      void navigate({ to: "/floor/pick", search: { dc: d.id } });
    },
    onError: (e) => onError(e, keys.sales),
  });
  return (
    <div className="grid grid-cols-1 gap-5">
      <h1 className="text-xl font-semibold text-fg">Pick orders</h1>
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold text-fg-2">In progress</h2>
        {drafts?.length ? (
          <ul className="grid gap-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link
                  to="/floor/pick"
                  search={{ dc: d.id }}
                  className="flex items-center gap-3 rounded-xl bg-surface p-4 shadow-card hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold text-fg">
                      {d.customerName}
                    </span>
                    <span className="font-mono text-sm text-fg-3">
                      {d.dcNo} · {count(d.rollCount, "roll")} · {metres(d.metres)}
                    </span>
                  </span>
                  <ChevronRight className="size-6 text-fg-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-fg-3 shadow-card">
            No challan is being picked.
          </p>
        )}
      </section>
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold text-fg-2">Ready to pick</h2>
        {ready.length ? (
          <ul className="grid gap-2">
            {ready.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-3 rounded-xl bg-surface p-4 shadow-card"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold text-fg">
                    {o.customerName}
                  </span>
                  <span className="font-mono text-sm text-fg-3">
                    {o.soNo} · {metres(o.orderedM - o.dispatchedM)} to go
                  </span>
                </span>
                <Button
                  variant="primary"
                  className="h-12 px-5 text-base"
                  busy={start.isPending && start.variables === o.id}
                  onClick={() => start.mutate(o.id)}
                >
                  Start
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-fg-3 shadow-card">
            No confirmed orders waiting.
          </p>
        )}
      </section>
    </div>
  );
}

function PickChallan({ dcId }: { dcId: string }) {
  const { data: dc } = useQuery(dcQuery(dcId));
  const { data: so } = useQuery({ ...soQuery(dc?.soId ?? ""), enabled: Boolean(dc) });
  const allocation = useQuery({
    ...allocationQuery(dc?.soId ?? ""),
    enabled: dc?.status === "Draft",
  });
  const [problem, setProblem] = useState<string>();
  const [cut, setCut] = useState<{
    lineId: string;
    rollId: string;
    barcode: string;
    lengthM: number;
    cutM: number;
  } | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.sales }),
      queryClient.invalidateQueries({ queryKey: keys.inventory }),
    ]);

  const pick = useMutation({
    mutationFn: (v: { soLineId: string; barcode?: string; rollId?: string }) =>
      call<DcDetail>(() =>
        api.POST("/api/delivery-challans/{id}/pick", { params: { path: { id: dcId } }, body: v }),
      ),
    onSuccess: async (_d, v) => {
      scanFeedback(true);
      setProblem(undefined);
      toast({ tone: "success", title: `Picked ${v.barcode ?? "roll"}` });
      await refresh();
    },
    onError: (e) => {
      scanFeedback(false);
      setProblem(
        e instanceof ApiError
          ? e.problem.title
          : "Couldn't pick — check the connection and scan again.",
      );
    },
  });
  const unpick = useMutation({
    mutationFn: (rollId: string) =>
      call<DcDetail>(() =>
        api.POST("/api/delivery-challans/{id}/unpick", {
          params: { path: { id: dcId } },
          body: { rollId },
        }),
      ),
    onSuccess: refresh,
    onError: (e) => onError(e, keys.sales),
  });
  const doCut = useMutation({
    mutationFn: (v: { soLineId: string; rollId: string; cutM: number; wasteM: number }) =>
      call<DcCutResult>(() =>
        api.POST("/api/delivery-challans/{id}/cut", { params: { path: { id: dcId } }, body: v }),
      ),
    onSuccess: async (r) => {
      setCut(null);
      toast({
        tone: "success",
        title: `Cut ${metres(r.child.lengthM)} → ${r.child.barcode}`,
        description: "Print both labels now.",
      });
      void printLabels({ rollIds: r.labelRollIds, reprint: true }, "Roll cut at picking").catch(
        (e) => onError(e),
      );
      await refresh();
    },
    onError: (e) => onError(e, keys.sales),
  });
  const dispatch = useMutation({
    mutationFn: () =>
      docAction<DcDetail>("/api/delivery-challans/{id}/post", dcId, { version: dc!.version }),
    onSuccess: async (d) => {
      setDispatching(false);
      toast({ tone: "success", title: `${d.dcNo} dispatched` });
      await refresh();
      void navigate({ to: "/floor/pick", search: {} });
    },
    onError: (e) => onError(e, keys.sales),
  });

  if (!dc) return <p className="p-6 text-center text-fg-3">Loading…</p>;
  if (dc.status !== "Draft") {
    return (
      <div className="grid gap-4 rounded-xl bg-surface p-6 text-center shadow-card">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
        <p className="text-lg font-semibold">
          {dc.dcNo} is {dc.status === "Open" ? "dispatched" : dc.status.toLowerCase()}.
        </p>
        <Button asChild variant="secondary" className="h-12 text-base">
          <Link to="/floor/pick" search={{}}>
            Back to orders
          </Link>
        </Button>
      </div>
    );
  }

  // A scanned roll goes to the line of its product that still needs metres.
  const onScan = async (barcode: string) => {
    setProblem(undefined);
    let lineId = dc.lines.find((l) => l.balanceM > 0)?.soLineId ?? dc.lines[0]!.soLineId;
    if (dc.lines.length > 1 && so) {
      try {
        const roll = await rootClient.fetchQuery({ ...rollQuery(barcode), retry: 1 });
        const match = so.lines.filter((l) => l.skuId === roll.skuId);
        const open =
          match.find((l) => dc.lines.find((d) => d.soLineId === l.id)!.balanceM > 0) ?? match[0];
        if (!open) {
          scanFeedback(false);
          return setProblem(`${barcode} is ${roll.description} — not on this order.`);
        }
        lineId = open.id;
      } catch {
        scanFeedback(false);
        return setProblem(`No roll has barcode ${barcode}.`);
      }
    }
    pick.mutate({ soLineId: lineId, barcode });
  };

  const pickedIds = new Set(dc.rolls.map((r) => r.rollId));
  const short = dc.lines.some((l) => l.balanceM > 0);
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex items-center gap-2">
        <Link
          to="/floor/pick"
          search={{}}
          aria-label="Back to orders"
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-muted"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-fg">{dc.customerName}</h1>
          <p className="font-mono text-sm text-fg-3">
            {dc.dcNo} · {dc.soNo}
          </p>
        </div>
      </div>
      <ScanInput onScan={(b) => void onScan(b)} label="Scan the next roll" />
      {problem ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 font-medium text-danger"
        >
          {problem}
        </p>
      ) : null}
      {dc.lines.map((l) => {
        const got = l.orderedM ? Math.min(100, Math.round((l.pickedM / l.orderedM) * 100)) : 0;
        const s = allocation.data?.lines.find((a) => a.soLineId === l.soLineId);
        const next = s?.rolls.filter((r) => !pickedIds.has(r.rollId)) ?? [];
        return (
          <section key={l.soLineId} className="grid gap-3 rounded-xl bg-surface p-5 shadow-card">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-fg">{l.description}</h2>
              {l.balanceM > 0 ? (
                <Badge tone="warning" className="text-sm">
                  {metres(l.balanceM)} to go
                </Badge>
              ) : (
                <Badge tone="success" className="text-sm">
                  Done
                </Badge>
              )}
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={got}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${l.description} picked`}
            >
              <div
                className={cn("h-full rounded-full", got >= 100 ? "bg-success" : "bg-primary")}
                style={{ width: `${got}%` }}
              />
            </div>
            <p className="text-sm text-fg-2">
              {metres(l.pickedM)} of {metres(l.orderedM)} picked
            </p>
            {l.balanceM > 0 && next.length ? (
              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                  Take next (oldest first)
                </p>
                {next.slice(0, 4).map((r) => (
                  <div
                    key={r.rollId}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-base text-fg">{r.barcode}</span>
                      <span className="text-sm text-fg-3">
                        {metres(r.lengthM)} · {r.ageDays} days old
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      className="h-11"
                      busy={pick.isPending && pick.variables?.rollId === r.rollId}
                      onClick={() => pick.mutate({ soLineId: l.soLineId, rollId: r.rollId })}
                    >
                      Pick
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {l.balanceM > 0 && s?.cut && l.allowCut ? (
              <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
                <Scissors className="size-5 text-warning" aria-hidden />
                <span className="min-w-0 flex-1 text-sm text-warning">
                  Cut <strong>{metres(s.cut.cutM)}</strong> from{" "}
                  <span className="font-mono">{s.cut.barcode}</span>
                </span>
                <Button
                  variant="secondary"
                  className="h-11"
                  onClick={() =>
                    setCut({
                      lineId: l.soLineId,
                      rollId: s.cut!.rollId,
                      barcode: s.cut!.barcode,
                      lengthM: s.cut!.cutM + s.cut!.leftoverM,
                      cutM: s.cut!.cutM,
                    })
                  }
                >
                  Cut
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
      {dc.rolls.length ? (
        <section className="grid gap-2 rounded-xl bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-fg">
            Picked · {count(dc.rolls.length, "roll")}
          </h2>
          <ul className="divide-y divide-border">
            {dc.rolls.map((r) => (
              <li key={r.rollId} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-fg">{r.barcode}</span>
                  <span className="text-sm text-fg-3">
                    {metres(r.lengthM)}
                    {r.cutFromBarcode ? ` · cut from ${r.cutFromBarcode}` : ""}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  icon={Undo2}
                  className="h-11"
                  busy={unpick.isPending && unpick.variables === r.rollId}
                  onClick={() => unpick.mutate(r.rollId)}
                >
                  Put back
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Button
        variant="primary"
        icon={Truck}
        className="h-14 text-lg"
        disabled={!dc.rolls.length}
        onClick={() => setDispatching(true)}
      >
        Dispatch {count(dc.rolls.length, "roll")}
      </Button>
      <ConfirmDialog
        open={dispatching}
        onOpenChange={setDispatching}
        title={`Dispatch ${dc.dcNo}?`}
        description={`${count(dc.rolls.length, "roll")} (${metres(dc.rolls.reduce((s, r) => s + r.lengthM, 0))}) leave the godown.${short ? " Some lines are short; the rest stays on the order." : ""}`}
        confirmLabel="Dispatch"
        busy={dispatch.isPending}
        onConfirm={() => dispatch.mutate()}
      />
      {cut ? (
        <CutSheet
          cut={cut}
          busy={doCut.isPending}
          onClose={() => setCut(null)}
          onCut={(v) => doCut.mutate({ soLineId: cut.lineId, rollId: cut.rollId, ...v })}
        />
      ) : null}
    </div>
  );
}

function CutSheet({
  cut,
  busy,
  onClose,
  onCut,
}: {
  cut: { barcode: string; lengthM: number; cutM: number };
  busy: boolean;
  onClose: () => void;
  onCut: (v: { cutM: number; wasteM: number }) => void;
}) {
  const [cutM, setCutM] = useState(String(cut.cutM));
  const [wasteM, setWasteM] = useState("0");
  const left = cut.lengthM - Number(cutM || 0) - Number(wasteM || 0);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cut ${cut.barcode}`}
      description="The cut piece gets a new barcode and is picked. The roll keeps its barcode, shorter — both labels print."
      footer={
        <>
          <Button variant="secondary" className="h-12 text-base" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            icon={Printer}
            className="h-12 text-base"
            busy={busy}
            disabled={left < 0 || !Number(cutM)}
            onClick={() => onCut({ cutM: Number(cutM), wasteM: Number(wasteM || 0) })}
          >
            Cut & print
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cut length">
            {(p) => (
              <NumberInput {...p} value={cutM} onValueChange={setCutM} decimals={0} suffix="m" />
            )}
          </Field>
          <Field label="Waste">
            {(p) => (
              <NumberInput
                {...p}
                value={wasteM}
                onValueChange={setWasteM}
                decimals={0}
                suffix="m"
              />
            )}
          </Field>
        </div>
        <p className={cn("text-base", left < 0 ? "font-medium text-danger" : "text-fg-2")}>
          {left < 0 ? "More than the roll holds." : `${metres(left)} stays on the roll.`}
        </p>
      </div>
    </Dialog>
  );
}
