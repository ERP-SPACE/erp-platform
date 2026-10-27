import { formatINR } from "@erp/domain";
import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  DefinitionList,
  EmptyState,
  Mono,
  PageHeader,
} from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Printer, Ruler, Trash2 } from "lucide-react";
import { useState } from "react";
import { RollActionDialog } from "../../../components/roll-actions.js";
import { ApiError } from "../../../lib/api.js";
import { dateTime } from "../../../lib/format.js";
import { ROLL_LABEL, ROLL_TONE, printLabels, rollQuery } from "../../../lib/purchase.js";
import { can, meQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/inventory/roll/$rollId")({
  component: RollInspectorPage,
});

/** Roll Inspector (PRD UAT §11.2): supplier → lot → GRN → PI → cost → every movement. */
function RollInspectorPage() {
  const { rollId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: roll, error } = useQuery(rollQuery(rollId));
  const [action, setAction] = useState<"reprint" | "scrap" | "length" | null>(null);
  const [printing, setPrinting] = useState(false);

  if (error instanceof ApiError) {
    return (
      <EmptyState
        title="Roll not found"
        hint={error.problem.title}
        action={
          <Button asChild variant="secondary">
            <Link to="/inventory/rolls">Back to rolls</Link>
          </Button>
        }
      />
    );
  }
  if (!roll) return null;
  const inStock = ["Unmapped", "Mapped", "Returned"].includes(roll.status);
  const showCost = roll.baseValue !== null;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{roll.barcode}</Mono>
            <Badge tone={ROLL_TONE[roll.status]}>{ROLL_LABEL[roll.status] ?? roll.status}</Badge>
          </span>
        }
        description={roll.description}
        breadcrumbs={[
          { label: "Inventory" },
          { label: "Rolls", href: "/inventory/rolls" },
          { label: roll.barcode },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
        actions={
          <>
            {can(me, "labels.print") ? (
              roll.labelPrints ? (
                <Button variant="secondary" icon={Printer} onClick={() => setAction("reprint")}>
                  Reprint label
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  icon={Printer}
                  busy={printing}
                  onClick={async () => {
                    setPrinting(true);
                    try {
                      await printLabels({ rollIds: [roll.id] });
                    } finally {
                      setPrinting(false);
                    }
                  }}
                >
                  Print label
                </Button>
              )
            ) : null}
            {can(me, "inventory.adjust") &&
            roll.status !== "Allocated" &&
            inStock &&
            roll.currentLengthM === roll.originalLengthM &&
            !roll.parentRollId ? (
              <Button variant="secondary" icon={Ruler} onClick={() => setAction("length")}>
                Correct length
              </Button>
            ) : null}
            {can(me, "inventory.adjust") && inStock ? (
              <Button variant="danger" icon={Trash2} onClick={() => setAction("scrap")}>
                Scrap
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          <Card title="Roll">
            <DefinitionList
              columns={2}
              items={[
                {
                  label: "Product",
                  value: roll.skuCode ? (
                    <Mono>{roll.skuCode}</Mono>
                  ) : (
                    <Badge tone="warning">Unmapped</Badge>
                  ),
                },
                {
                  label: "Spec",
                  value: `${roll.gsm} GSM · ${roll.widthIn}″${roll.qualityName ? ` · ${roll.qualityName}` : ""}`,
                },
                {
                  label: "Length",
                  value: (
                    <span className="tnum">
                      {roll.currentLengthM.toLocaleString("en-IN")} m
                      {roll.currentLengthM !== roll.originalLengthM
                        ? ` (of ${roll.originalLengthM.toLocaleString("en-IN")} m)`
                        : ""}
                    </span>
                  ),
                },
                {
                  label: "Weight (approx.)",
                  value: <span className="tnum">{roll.weightKg} kg</span>,
                },
                { label: "Age", value: `${roll.ageDays} days` },
                { label: "Labels printed", value: String(roll.labelPrints) },
              ]}
            />
          </Card>
          <Card title="Where it came from">
            <DefinitionList
              columns={2}
              items={[
                { label: "Supplier", value: roll.supplierName },
                {
                  label: "Lot",
                  value: (
                    <span>
                      <Mono>{roll.batchCode}</Mono>
                      {roll.supplierBatchRef ? ` · ${roll.supplierBatchRef}` : ""}
                    </span>
                  ),
                },
                {
                  label: "Goods receipt",
                  value: (
                    <Link
                      className="text-primary hover:underline"
                      to="/purchase/receipts/$grnId"
                      params={{ grnId: roll.grnId }}
                    >
                      {roll.grnNo}
                    </Link>
                  ),
                },
                { label: "Received", value: dateTime(roll.receivedAt) },
                {
                  label: "Purchase invoice",
                  value: roll.piId ? (
                    <Link
                      className="text-primary hover:underline"
                      to="/purchase/invoices/$piId"
                      params={{ piId: roll.piId }}
                    >
                      {roll.supplierInvoiceNo} · {roll.piNo}
                    </Link>
                  ) : (
                    "Not invoiced yet"
                  ),
                },
              ]}
            />
          </Card>
          {showCost ? (
            <Card title="Cost">
              <DefinitionList
                columns={2}
                items={[
                  {
                    label: "Base value",
                    value: <span className="tnum">{formatINR(roll.baseValue!)}</span>,
                  },
                  {
                    label: "Landed cost",
                    value: <span className="tnum">{formatINR(roll.landedCost!)}</span>,
                  },
                  {
                    label: "Base ₹/m",
                    value: (
                      <span className="tnum">
                        {roll.baseCostPerM ? formatINR(roll.baseCostPerM, { decimals: 4 }) : "—"}
                      </span>
                    ),
                  },
                  {
                    label: "Full cost ₹/m",
                    value: (
                      <span className="tnum font-semibold">
                        {roll.landedCostPerM
                          ? formatINR(roll.landedCostPerM, { decimals: 4 })
                          : "—"}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </div>
        <Card title="History">
          {roll.events.length ? (
            <ActivityFeed
              entries={roll.events.map((e, i) => ({
                id: String(i),
                who: e.byName ?? "System",
                what: (
                  <>
                    <span className="font-medium">{e.title}</span>
                    {e.detail ? <span className="text-fg-3"> — {e.detail}</span> : null}
                  </>
                ),
                when: dateTime(e.at),
              }))}
            />
          ) : (
            <EmptyState title="No history yet" />
          )}
        </Card>
      </div>
      {action ? (
        <RollActionDialog
          action={action}
          rollIds={[roll.id]}
          roll={roll}
          onClose={() => setAction(null)}
        />
      ) : null}
    </div>
  );
}
