import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Download, LayoutGrid, Table2 } from "lucide-react";
import { SectionTabs } from "../../components/section-tabs.js";

export const Route = createFileRoute("/_app/reports")({ component: ReportsLayout });

const TABS = [
  { to: "/reports", label: "Reports", icon: LayoutGrid, permission: "reports.view" },
  { to: "/reports/pivot", label: "Pivot builder", icon: Table2, permission: "reports.view" },
  { to: "/reports/exports", label: "My exports", icon: Download, permission: "reports.export" },
];

function ReportsLayout() {
  return (
    <div className="grid gap-6">
      <SectionTabs tabs={TABS} label="Reports sections" />
      <Outlet />
    </div>
  );
}
