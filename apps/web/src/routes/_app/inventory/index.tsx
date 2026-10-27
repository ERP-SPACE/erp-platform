import type { StockRow } from "@erp/contracts";
import { formatINR, formatINRCompact } from "@erp/domain";
import { Button, Card, DataTable, Mono, PageHeader, Segmented, StatCard, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Boxes, Clock, RefreshCw, Ruler, TriangleAlert, Wallet } from "lucide-react";
import { z } from "zod";
import { api, call } from "../../../lib/api.js";
import { dateTime } from "../../../lib/format.js";
import { stockQuery } from "../../../lib/purchase.js";
import { can, keys, meQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/inventory/")({
  validateSearch: z.object({ by: z.enum(["sku", "batch", "supplier"]).optional() }),
  component: StockPage,
});

const LABEL = { sku: "Product", batch: "Lot", supplier: "Supplier" } as const;

function StockPage() {
  const { by = "sku" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(stockQuery(by));
  const showCost = can(me, "inventory.view_cost");
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = useMutation({
    mutationFn: () => call(() => api.POST("/api/inventory/stock/refresh")),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.inventory });
      toast({ tone: "success", title: "Stock figures refreshed" });
    },
  });

  const columns: ColumnDef<StockRow, unknown>[] = [
    {
      accessorKey: "description",
      header: LABEL[by],
      cell: (c) => (
        <div>
          <p className="font-medium">{c.getValue() as string}</p>
          {c.row.original.skuCode ? (
            <Mono className="text-xs text-fg-3">{c.row.original.skuCode}</Mono>
          ) : by === "sku" ? (
            <span className="text-xs text-warning">Unmapped</span>
          ) : null}
        </div>
      ),
    },
    { accessorKey: "rolls", header: "Rolls", meta: { numeric: true } },
    {
      accessorKey: "metres",
      header: "Metres",
      meta: { numeric: true },
      cell: (c) => (c.getValue() as number).toLocaleString("en-IN"),
    },
    ...(showCost
      ? [
          {
            accessorKey: "value",
            header: "Value",
            meta: { numeric: true },
            // Zero means no cost yet (no PO rate or invoice), not free paper.
            cell: (c: { getValue: () => unknown }) =>
              Number(c.getValue()) ? formatINR(c.getValue() as string) : "Not costed",
          } satisfies ColumnDef<StockRow, unknown>,
        ]
      : []),
    {
      accessorKey: "oldestDays",
      header: "Oldest",
      meta: { numeric: true },
      cell: (c) => `${c.getValue() as number} d`,
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Stock"
        description={
          data
            ? `As of ${dateTime(data.asOf)} — refreshed every 3 minutes during business hours.`
            : "Rolls in the godown."
        }
        breadcrumbs={[{ label: "Inventory" }, { label: "Stock" }]}
        actions={
          <Button
            variant="secondary"
            icon={RefreshCw}
            busy={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            Refresh now
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Rolls in stock"
          value={(data?.totals.rolls ?? 0).toLocaleString("en-IN")}
          icon={Boxes}
        />
        <StatCard
          label="Metres"
          value={(data?.totals.metres ?? 0).toLocaleString("en-IN")}
          icon={Ruler}
        />
        {showCost ? (
          <StatCard
            label="Stock value"
            value={data?.totals.value ? formatINRCompact(data.totals.value) : "—"}
            icon={Wallet}
            hint="At landed cost"
          />
        ) : null}
        <StatCard
          label="Unmapped rolls"
          value={String(data?.totals.unmappedRolls ?? 0)}
          icon={TriangleAlert}
          hint="Need a product"
          onClick={() => void navigate({ to: "/inventory/unmapped" })}
        />
        <StatCard
          label="Dead stock"
          value={String(data?.totals.deadStockRolls ?? 0)}
          icon={Clock}
          hint="Older than the dead-stock days setting"
        />
      </div>
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">Stock by {LABEL[by].toLowerCase()}</h2>
          <Segmented
            label="Group stock by"
            value={by}
            onValueChange={(v) => void navigate({ search: { by: v }, replace: true })}
            options={[
              { value: "sku", label: "Product" },
              { value: "batch", label: "Lot" },
              { value: "supplier", label: "Supplier" },
            ]}
          />
        </div>
        <DataTable
          caption="Stock"
          data={data?.rows ?? []}
          loading={isLoading}
          columns={columns}
          getRowId={(r) => `${r.skuId ?? r.description}`}
          searchPlaceholder="Search stock"
        />
      </Card>
    </div>
  );
}
