import { PageHeader } from "@erp/ui";
import { createFileRoute } from "@tanstack/react-router";
import { ProformaForm } from "../../../../components/proforma-form.js";
import { crumbLink } from "../../../../components/sales-bits.js";

export const Route = createFileRoute("/_app/sales/proformas/new")({ component: NewPfPage });

function NewPfPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="New proforma"
        breadcrumbs={[
          { label: "Sales" },
          { label: "Proformas", href: "/sales/proformas" },
          { label: "New" },
        ]}
        renderLink={crumbLink}
      />
      <ProformaForm />
    </div>
  );
}
