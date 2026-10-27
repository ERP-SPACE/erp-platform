import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { FileInput, FileText, PackageCheck, Undo2 } from "lucide-react";
import { SectionTabs } from "../../components/section-tabs.js";

export const Route = createFileRoute("/_app/purchase")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, "") === "/purchase")
      throw redirect({ to: "/purchase/orders" });
  },
  component: PurchaseLayout,
});

const TABS = [
  { to: "/purchase/orders", label: "Purchase orders", icon: FileText },
  { to: "/purchase/receipts", label: "Goods receipts", icon: PackageCheck },
  { to: "/purchase/invoices", label: "Purchase invoices", icon: FileInput },
  { to: "/purchase/returns", label: "Returns", icon: Undo2 },
];

function PurchaseLayout() {
  return (
    <div className="grid gap-6">
      <SectionTabs tabs={TABS} label="Purchase sections" />
      <Outlet />
    </div>
  );
}
