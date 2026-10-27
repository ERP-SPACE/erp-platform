import { parseRollBarcode } from "@erp/domain";
import { Button, Card, PageHeader, SearchInput, Select } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Printer, ScanLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { RollActionDialog } from "../../../components/roll-actions.js";
import { RollTable } from "../../../components/roll-table.js";
import { rollsQuery } from "../../../lib/purchase.js";
import { can, meQuery } from "../../../lib/queries.js";

const STATUSES = [
  "all",
  "Unmapped",
  "Mapped",
  "Allocated",
  "Dispatched",
  "Returned",
  "ReturnedToSupplier",
  "Scrap",
] as const;

export const Route = createFileRoute("/_app/inventory/rolls")({
  validateSearch: z.object({ status: z.enum(STATUSES).optional() }),
  component: RollsPage,
});

function RollsPage() {
  const { status = "all" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(
    rollsQuery(status === "all" ? { inStock: "true" } : { status }),
  );
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<"reprint" | "scrap" | null>(null);

  // Scanners type the barcode and press Enter; open the Roll Inspector straight away.
  const open = () => {
    const parsed = parseRollBarcode(scan);
    if (!parsed.valid) return setScanError(parsed.error);
    setScanError(undefined);
    void navigate({ to: "/inventory/roll/$rollId", params: { rollId: scan.trim().toUpperCase() } });
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Rolls"
        description="Scan a label to open the Roll Inspector, or browse rolls by status."
        breadcrumbs={[{ label: "Inventory" }, { label: "Rolls" }]}
        actions={
          <>
            {can(me, "labels.print") ? (
              <Button
                variant="secondary"
                icon={Printer}
                disabled={!selected.length}
                onClick={() => setAction("reprint")}
              >
                Reprint labels
              </Button>
            ) : null}
            {can(me, "inventory.adjust") ? (
              <Button
                variant="danger"
                icon={Trash2}
                disabled={!selected.length}
                onClick={() => setAction("scrap")}
              >
                Scrap
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            open();
          }}
        >
          <div className="min-w-[16rem] flex-1">
            <label
              htmlFor="scan"
              className="mb-1.5 flex items-center gap-2 text-sm font-medium text-fg"
            >
              <ScanLine className="size-4 text-fg-3" aria-hidden /> Scan or type a barcode
            </label>
            <SearchInput
              id="scan"
              autoFocus
              className="font-mono uppercase"
              placeholder="2610-SBC-0001-0001-K"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              aria-describedby={scanError ? "scan-error" : undefined}
              aria-invalid={Boolean(scanError)}
            />
            {scanError ? (
              <p id="scan-error" className="mt-1 text-xs text-danger">
                {scanError}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="primary" disabled={!scan.trim()}>
            Open
          </Button>
        </form>
      </Card>
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            {status === "all" ? "In stock" : status}
          </h2>
          <div className="w-52">
            <Select
              aria-label="Status"
              value={status}
              onValueChange={(v) =>
                void navigate({
                  search: { status: v === "all" ? undefined : (v as (typeof STATUSES)[number]) },
                  replace: true,
                })
              }
              options={STATUSES.map((s) => ({
                value: s,
                label:
                  s === "all"
                    ? "In stock"
                    : s === "ReturnedToSupplier"
                      ? "Returned to supplier"
                      : s,
              }))}
            />
          </div>
        </div>
        <RollTable
          caption="Rolls"
          rolls={data?.items ?? []}
          loading={isLoading}
          selectable={can(me, "labels.print") || can(me, "inventory.adjust")}
          onSelectionChange={setSelected}
          showCost={can(me, "inventory.view_cost")}
        />
      </Card>
      {action ? (
        <RollActionDialog action={action} rollIds={selected} onClose={() => setAction(null)} />
      ) : null}
    </div>
  );
}
