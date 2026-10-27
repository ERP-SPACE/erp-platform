import type { RollItem } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import { Badge, DataTable, Mono } from "@erp/ui";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ROLL_LABEL, ROLL_TONE } from "../lib/purchase.js";

/** Rolls table used by goods receipts, the inventory roll list and unmapped staging. */
export function RollTable({
  rolls,
  loading,
  caption,
  selectable,
  onSelectionChange,
  showCost,
}: {
  rolls: RollItem[];
  loading?: boolean;
  caption: string;
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  showCost?: boolean;
}) {
  const navigate = useNavigate();
  const columns: ColumnDef<RollItem, unknown>[] = [
    {
      accessorKey: "barcode",
      header: "Barcode",
      cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
    },
    {
      accessorKey: "description",
      header: "Item",
      cell: (c) => (
        <div>
          <p className="font-medium">{c.row.original.description}</p>
          <p className="text-xs text-fg-3">
            {c.row.original.gsm} GSM · {c.row.original.widthIn}″ · lot {c.row.original.batchCode}
            {c.row.original.supplierBatchRef ? ` (${c.row.original.supplierBatchRef})` : ""}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "currentLengthM",
      header: "Length",
      meta: { numeric: true },
      cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
    },
    ...(showCost
      ? [
          {
            accessorKey: "landedCostPerM",
            header: "Cost ₹/m",
            meta: { numeric: true },
            cell: (c: { getValue: () => unknown }) =>
              c.getValue() ? formatINR(c.getValue() as string, { decimals: 4 }) : "—",
          } satisfies ColumnDef<RollItem, unknown>,
        ]
      : []),
    {
      accessorKey: "ageDays",
      header: "Age",
      meta: { numeric: true },
      cell: (c) => `${c.getValue() as number} d`,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: (c) => {
        const s = c.getValue() as RollItem["status"];
        return <Badge tone={ROLL_TONE[s]}>{ROLL_LABEL[s] ?? s}</Badge>;
      },
    },
  ];
  return (
    <DataTable
      caption={caption}
      data={rolls}
      loading={loading}
      columns={columns}
      getRowId={(r) => r.id}
      selectable={selectable}
      onSelectionChange={onSelectionChange}
      // The checkbox stops its own click, so a row click always opens the Roll Inspector.
      onRowClick={(r) => void navigate({ to: "/inventory/roll/$rollId", params: { rollId: r.id } })}
      searchPlaceholder="Search barcode or item"
      pageSize={50}
    />
  );
}
