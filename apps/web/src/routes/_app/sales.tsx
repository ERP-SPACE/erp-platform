import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  FileCheck2,
  FileMinus2,
  FileText,
  KanbanSquare,
  ReceiptText,
  ShieldCheck,
  Truck,
  Undo2,
} from "lucide-react";
import { SectionTabs } from "../../components/section-tabs.js";

export const Route = createFileRoute("/_app/sales")({ component: SalesLayout });

const TABS = [
  { to: "/sales", label: "Board", icon: KanbanSquare, match: [] },
  { to: "/sales/orders", label: "Orders", icon: FileText },
  { to: "/sales/challans", label: "Challans", icon: Truck },
  { to: "/sales/invoices", label: "Invoices", icon: ReceiptText },
  { to: "/sales/proformas", label: "Proformas", icon: FileCheck2 },
  { to: "/sales/returns", label: "Returns", icon: Undo2 },
  { to: "/sales/notes", label: "Credit & debit notes", icon: FileMinus2 },
  { to: "/sales/irn", label: "IRN queue", icon: ShieldCheck },
];

function SalesLayout() {
  return (
    <div className="grid gap-6">
      <SectionTabs tabs={TABS} label="Sales sections" />
      <Outlet />
    </div>
  );
}
