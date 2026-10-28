import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { BadgeIndianRupee, CalendarClock, HandCoins, PauseCircle, Send } from "lucide-react";
import { SectionTabs } from "../../components/section-tabs.js";

export const Route = createFileRoute("/_app/collections")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, "") === "/collections")
      throw redirect({ to: "/collections/$kind", params: { kind: "receipts" } });
  },
  component: CollectionsLayout,
});

const TABS = [
  {
    to: "/collections/receipts",
    label: "Receipts",
    icon: HandCoins,
    permission: "collections.view",
  },
  {
    to: "/collections/payments",
    label: "Supplier payments",
    icon: Send,
    permission: "payables.view",
  },
  {
    to: "/collections/aging",
    label: "Aging",
    icon: CalendarClock,
    permission: "collections.view",
    match: ["/collections/statement"],
  },
  {
    to: "/collections/blocked",
    label: "Blocked orders",
    icon: PauseCircle,
    permission: "collections.view",
  },
  {
    to: "/collections/commission",
    label: "Commission",
    icon: BadgeIndianRupee,
    permission: "commission.view",
  },
];

function CollectionsLayout() {
  return (
    <div className="grid gap-6">
      <SectionTabs tabs={TABS} label="Collections sections" />
      <Outlet />
    </div>
  );
}
