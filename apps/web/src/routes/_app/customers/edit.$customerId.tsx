import { PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CustomerForm } from "../../../components/customer-form.js";
import { customerQuery } from "../../../lib/masters.js";

export const Route = createFileRoute("/_app/customers/edit/$customerId")({
  component: EditCustomerPage,
});

function EditCustomerPage() {
  const { customerId } = Route.useParams();
  const { data: customer } = useQuery(customerQuery(customerId));
  if (!customer) return null;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Edit ${customer.legalName}`}
        description={customer.code}
        breadcrumbs={[
          { label: "Masters" },
          { label: "Customers", href: "/customers" },
          { label: customer.legalName, href: `/customers/${customer.id}` },
          { label: "Edit" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <CustomerForm key={customer.version} customer={customer} />
    </div>
  );
}
