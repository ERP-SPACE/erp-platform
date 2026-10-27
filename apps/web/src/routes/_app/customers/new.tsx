import { PageHeader } from "@erp/ui";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CustomerForm } from "../../../components/customer-form.js";

export const Route = createFileRoute("/_app/customers/new")({ component: NewCustomerPage });

function NewCustomerPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="New customer"
        description="The customer code (CUST-0001…) is assigned when you save."
        breadcrumbs={[
          { label: "Masters" },
          { label: "Customers", href: "/customers" },
          { label: "New" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <CustomerForm />
    </div>
  );
}
