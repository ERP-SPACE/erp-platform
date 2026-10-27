import { PageHeader } from "@erp/ui";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { GrnForm } from "../../../../components/grn-form.js";

export const Route = createFileRoute("/_app/purchase/receipts/new")({
  validateSearch: z.object({ poId: z.string().optional() }),
  component: NewGrnPage,
});

function NewGrnPage() {
  const { poId } = Route.useSearch();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Receive goods"
        description="Saved as a draft first; posting creates the rolls and their labels."
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Goods receipts", href: "/purchase/receipts" },
          { label: "New" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <GrnForm poId={poId} />
    </div>
  );
}
