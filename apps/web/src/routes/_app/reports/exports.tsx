import type { ExportItem } from "@erp/contracts";
import { Badge, Button, DataTable, PageHeader, type Tone } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { crumbLink } from "../../../components/sales-bits.js";
import { dateTime } from "../../../lib/format.js";
import { exportsQuery } from "../../../lib/reports.js";

export const Route = createFileRoute("/_app/reports/exports")({ component: ExportsPage });

const TONE: Record<ExportItem["status"], Tone> = {
  Queued: "neutral",
  Running: "info",
  Ready: "success",
  Failed: "danger",
  Expired: "neutral",
};
const size = (b: number | null) =>
  b === null
    ? "—"
    : b < 1024
      ? `${b} B`
      : b < 1024 * 1024
        ? `${(b / 1024).toFixed(0)} KB`
        : `${(b / 1024 / 1024).toFixed(1)} MB`;

const columns: ColumnDef<ExportItem, unknown>[] = [
  {
    accessorKey: "title",
    header: "Export",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  { accessorKey: "format", header: "Format", cell: (c) => (c.getValue() as string).toUpperCase() },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span title={row.original.error ?? undefined}>
        <Badge tone={TONE[row.original.status]}>
          {row.original.status === "Running" ? "Building" : row.original.status}
        </Badge>
      </span>
    ),
  },
  {
    accessorKey: "rowCount",
    header: "Rows",
    meta: { numeric: true },
    cell: (c) => (c.getValue() as number | null)?.toLocaleString("en-IN") ?? "—",
  },
  {
    accessorKey: "sizeBytes",
    header: "Size",
    meta: { numeric: true },
    cell: (c) => size(c.getValue() as number | null),
  },
  { accessorKey: "createdAt", header: "Requested", cell: (c) => dateTime(c.getValue() as string) },
  {
    accessorKey: "expiresAt",
    header: "Link expires",
    cell: (c) => dateTime(c.getValue() as string | null),
  },
  {
    id: "download",
    header: "",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.downloadUrl ? (
        <Button asChild size="sm" variant="secondary" icon={Download}>
          <a href={row.original.downloadUrl} download>
            Download
          </a>
        </Button>
      ) : null,
  },
];

/** The user's own exports (ADR-0025): built in the background, kept for the link lifetime. */
function ExportsPage() {
  const { data, isLoading } = useQuery(exportsQuery);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="My exports"
        description="Reports and pivots you exported. Files are ready in a few seconds and kept for 7 days."
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "My exports" }]}
        renderLink={crumbLink}
      />
      <DataTable
        caption="My exports"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(e) => e.id}
        empty="Nothing exported yet. Use Export on any report or pivot."
      />
    </div>
  );
}
