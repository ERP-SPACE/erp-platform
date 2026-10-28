import { PageHeader } from "@erp/ui";
import { createFileRoute } from "@tanstack/react-router";
import { crumbLink } from "../../../../components/sales-bits.js";
import { SoForm } from "../../../../components/so-form.js";

export const Route = createFileRoute("/_app/sales/orders/new")({ component: NewSoPage });

function NewSoPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="New sales order"
        description="Pick the customer, then add lines. Tab or Enter moves on; Ctrl S saves."
        breadcrumbs={[
          { label: "Sales" },
          { label: "Orders", href: "/sales/orders" },
          { label: "New" },
        ]}
        renderLink={crumbLink}
      />
      <SoForm />
    </div>
  );
}
