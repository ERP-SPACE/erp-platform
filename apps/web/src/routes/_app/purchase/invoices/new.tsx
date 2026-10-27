import { PageHeader } from "@erp/ui";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PiForm } from "../../../../components/pi-form.js";

export const Route = createFileRoute("/_app/purchase/invoices/new")({
  validateSearch: z.object({ grnId: z.string().optional() }),
  component: NewPiPage,
});

function NewPiPage() {
  const { grnId } = Route.useSearch();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Enter purchase invoice"
        description={
          grnId
            ? "Filled from the goods receipt — check rates and HSN against the supplier's bill."
            : "Copy the supplier's tax invoice line for line."
        }
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Purchase invoices", href: "/purchase/invoices" },
          { label: "New" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <PiForm grnId={grnId} />
    </div>
  );
}
