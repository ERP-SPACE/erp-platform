import { useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Boxes, ScanLine, TriangleAlert } from "lucide-react";
import { SectionTabs } from "../../components/section-tabs.js";
import { stockQuery } from "../../lib/purchase.js";

export const Route = createFileRoute("/_app/inventory")({ component: InventoryLayout });

function InventoryLayout() {
  const { data } = useQuery(stockQuery("sku"));
  return (
    <div className="grid gap-6">
      <SectionTabs
        label="Inventory sections"
        tabs={[
          { to: "/inventory", label: "Stock", icon: Boxes },
          {
            to: "/inventory/unmapped",
            label: "Unmapped rolls",
            icon: TriangleAlert,
            count: data?.totals.unmappedRolls,
          },
          {
            to: "/inventory/rolls",
            label: "Rolls & inspector",
            icon: ScanLine,
            match: ["/inventory/roll/"],
          },
        ]}
      />
      <Outlet />
    </div>
  );
}
