import type { RollInspector } from "@erp/contracts";
import { Badge, Button, cn, useToast } from "@erp/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { History, Link2, Printer } from "lucide-react";
import { useCallback, useState } from "react";
import { z } from "zod";
import { ScanInput } from "../../components/scan-input.js";
import { ApiError } from "../../lib/api.js";
import { useApiErrorToast } from "../../lib/errors.js";
import { type RecentScan, useStoredList } from "../../lib/floor.js";
import { ROLL_LABEL, ROLL_TONE, printLabels, rollQuery } from "../../lib/purchase.js";
import { can, meQuery, queryClient } from "../../lib/queries.js";

export const Route = createFileRoute("/floor/")({
  validateSearch: z.object({ roll: z.string().optional() }),
  component: FloorScan,
});

/** Scan → inspect: what is this roll, where did it come from, what can I do with it? */
function FloorScan() {
  const { roll: initial } = Route.useSearch();
  const [barcode, setBarcode] = useState<string | undefined>(initial);
  const [recent, setRecent] = useStoredList<RecentScan>("erp:floor:recent", 20);
  const roll = useQuery({ ...rollQuery(barcode ?? ""), enabled: Boolean(barcode), retry: 2 });

  const onScan = useCallback(
    async (code: string) => {
      setBarcode(code);
      const r = await queryClient.fetchQuery({ ...rollQuery(code), retry: 2 }).catch(() => null);
      setRecent([
        { barcode: code, at: new Date().toISOString(), description: r?.description },
        ...recent.filter((x) => x.barcode !== code),
      ]);
    },
    [recent, setRecent],
  );

  return (
    <div className="grid gap-5">
      <ScanInput onScan={onScan} />
      {barcode ? (
        roll.isLoading ? (
          <p className="rounded-xl bg-surface p-6 text-center text-fg-3 shadow-card">
            Looking up {barcode}…
          </p>
        ) : roll.error ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger-soft p-5 text-danger"
          >
            <p className="text-lg font-semibold">{barcode}</p>
            <p>
              {roll.error instanceof ApiError && roll.error.status === 404
                ? "No roll has this barcode."
                : "Couldn't look it up — check the connection and scan again."}
            </p>
          </div>
        ) : roll.data ? (
          <RollCard roll={roll.data} />
        ) : null
      ) : null}
      {recent.length ? (
        <section className="grid gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-2">
            <History className="size-4" aria-hidden /> Recent scans
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface shadow-card">
            {recent.slice(0, 8).map((s) => (
              <li key={s.barcode}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start px-4 py-3 text-left hover:bg-muted"
                  onClick={() => setBarcode(s.barcode)}
                >
                  <span className="font-mono text-base text-fg">{s.barcode}</span>
                  {s.description ? (
                    <span className="text-sm text-fg-3">{s.description}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RollCard({ roll }: { roll: RollInspector }) {
  const { data: me } = useQuery(meQuery);
  const toast = useToast();
  const onError = useApiErrorToast();
  const print = useMutation({
    mutationFn: () =>
      printLabels(
        { rollIds: [roll.id], reprint: roll.labelPrints > 0 },
        roll.labelPrints > 0 ? "Reprinted at the godown" : undefined,
      ),
    onSuccess: () => toast({ tone: "success", title: "Label ready to print" }),
    onError: (e) => onError(e),
  });
  const rows: [string, string][] = [
    ["Length", `${roll.currentLengthM.toLocaleString("en-IN")} m`],
    ["Spec", `${roll.gsm} GSM · ${roll.widthIn}″`],
    ["Lot", `${roll.batchCode}${roll.supplierBatchRef ? ` · ${roll.supplierBatchRef}` : ""}`],
    ["Supplier", roll.supplierName],
    [
      "Received",
      `${roll.grnNo} · ${roll.ageDays === 0 ? "today" : roll.ageDays === 1 ? "yesterday" : `${roll.ageDays} days ago`}`,
    ],
  ];
  return (
    <article
      className={cn(
        "grid gap-4 rounded-xl border-2 bg-surface p-5 shadow-card",
        roll.status === "Unmapped" ? "border-warning" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-lg font-semibold text-fg">{roll.barcode}</p>
          <p className="text-lg text-fg">{roll.description}</p>
        </div>
        <Badge tone={ROLL_TONE[roll.status]} className="text-sm">
          {ROLL_LABEL[roll.status] ?? roll.status}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm text-fg-3">{k}</dt>
            <dd className="text-base font-medium text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 sm:grid-cols-2">
        {roll.status === "Unmapped" && can(me, "inventory.map") ? (
          <Button asChild variant="primary" icon={Link2} className="h-12 text-base">
            <Link to="/floor/map" search={{ add: roll.barcode }}>
              Map this roll
            </Link>
          </Button>
        ) : null}
        {can(me, "labels.print") ? (
          <Button
            variant="secondary"
            icon={Printer}
            className="h-12 text-base"
            busy={print.isPending}
            onClick={() => print.mutate()}
          >
            {roll.labelPrints ? "Reprint label" : "Print label"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
