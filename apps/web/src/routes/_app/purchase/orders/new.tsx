import { PageHeader } from "@erp/ui";
import { Link, createFileRoute } from "@tanstack/react-router";
import { PoForm } from "../../../../components/po-form.js";

export const Route = createFileRoute("/_app/purchase/orders/new")({ component: NewPoPage });

function NewPoPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="New purchase order"
        description="The PO number is assigned when you save."
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Purchase orders", href: "/purchase/orders" },
          { label: "New" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <PoForm />
    </div>
  );
}
