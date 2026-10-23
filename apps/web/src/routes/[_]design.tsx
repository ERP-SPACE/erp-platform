import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DefinitionList,
  DropdownMenu,
  EmptyState,
  Field,
  FormSection,
  Kbd,
  Money,
  Mono,
  NumberInput,
  PageHeader,
  Qty,
  Segmented,
  Select,
  StatCard,
  Stepper,
  Switch,
  Tabs,
  TextInput,
  useToast,
} from "@erp/ui";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  IndianRupee,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { type Density, type Theme, setPrefs, usePrefs } from "../lib/prefs.js";

/** Living reference for the dashboard design system (public; checked by axe in CI). */
export const Route = createFileRoute("/_design")({ component: DesignPage });

interface SampleOrder {
  no: string;
  party: string;
  metres: number;
  amount: string;
  status: "Confirmed" | "On hold" | "Draft" | "Closed";
}

const ORDERS: SampleOrder[] = [
  {
    no: "SO/2627/00142",
    party: "Shree Prints",
    metres: 12000,
    amount: "482300",
    status: "Confirmed",
  },
  {
    no: "SO/2627/00141",
    party: "Arihant Textiles",
    metres: 4500,
    amount: "176850.5",
    status: "On hold",
  },
  { no: "SO/2627/00140", party: "Navkar Digital", metres: 2000, amount: "78400", status: "Draft" },
  {
    no: "SO/2627/00139",
    party: "Om Sublimation Works",
    metres: 30000,
    amount: "1196000",
    status: "Closed",
  },
];

const TONE = {
  Confirmed: "success",
  "On hold": "warning",
  Draft: "neutral",
  Closed: "info",
} as const;

const orderColumns: ColumnDef<SampleOrder, unknown>[] = [
  {
    accessorKey: "no",
    header: "Order",
    cell: (c) => <Mono className="font-medium">{c.getValue() as string}</Mono>,
  },
  { accessorKey: "party", header: "Customer" },
  {
    accessorKey: "metres",
    header: "Metres",
    cell: (c) => <Qty value={c.getValue() as number} unit="m" />,
    meta: { numeric: true },
  },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: (c) => <Money value={c.getValue() as string} />,
    meta: { numeric: true },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge tone={TONE[c.getValue() as SampleOrder["status"]]}>{c.getValue() as string}</Badge>
    ),
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    enableHiding: false,
    meta: { width: "3rem" },
    cell: () => (
      <span onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          trigger={
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={MoreHorizontal}
              aria-label="Row actions"
            />
          }
          items={[
            { label: "Edit", icon: Pencil, onSelect: () => {} },
            "separator",
            { label: "Cancel order", icon: Trash2, tone: "danger", onSelect: () => {} },
          ]}
        />
      </span>
    ),
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4" aria-label={title}>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function DesignPage() {
  const prefs = usePrefs();
  const toast = useToast();
  const [selected, setSelected] = useState(ORDERS[0]!.no);
  const [rate, setRate] = useState("6.25");
  const [width, setWidth] = useState("44");
  const [checked, setChecked] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState("profile");

  return (
    <main className="mx-auto grid max-w-6xl gap-10 bg-canvas px-4 py-10 sm:px-8 [&>*]:min-w-0">
      <PageHeader
        title="Design system"
        description="Professional dashboard style — components used across the ERP."
        breadcrumbs={[{ label: "Reference" }, { label: "Design system" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Theme>
              label="Theme"
              value={prefs.theme}
              onValueChange={(t) => setPrefs({ theme: t })}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
            <Segmented<Density>
              label="Density"
              value={prefs.density}
              onValueChange={(d) => setPrefs({ density: d })}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </div>
        }
      />

      <Section title="KPI cards">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Sales this month"
            value="₹ 48.2 L"
            icon={IndianRupee}
            delta={8.4}
            deltaLabel="vs last month"
            trend={[12, 18, 15, 22, 19, 26, 31]}
          />
          <StatCard
            label="Receivables"
            value="₹ 12.6 L"
            icon={Users}
            delta={-2.1}
            deltaLabel="vs last month"
            trend={[30, 28, 27, 29, 25, 24, 22]}
          />
          <StatCard label="Rolls in stock" value="1,204" icon={Package} hint="Across 46 SKUs" />
          <StatCard label="Credit-blocked" value="3" icon={ShieldAlert} hint="₹ 2.4 L exposure" />
        </div>
      </Section>

      <Section title="Buttons & badges">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Plus}>
            New order
          </Button>
          <Button>Export</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger" icon={Trash2}>
            Delete
          </Button>
          <Button variant="primary" busy>
            Saving
          </Button>
          <Button size="sm">Small</Button>
          <span className="text-sm text-fg-2">
            Press <Kbd>Ctrl K</Kbd> to search
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">Confirmed</Badge>
          <Badge tone="warning">On hold</Badge>
          <Badge tone="danger">Overdue 12 days</Badge>
          <Badge tone="info">GST document</Badge>
          <Badge tone="primary">Wholesale</Badge>
          <Badge>Draft</Badge>
        </div>
      </Section>

      <Section title="Data table">
        <DataTable
          caption="Sample sales orders"
          data={ORDERS}
          columns={orderColumns}
          getRowId={(r) => r.no}
          selectedId={selected}
          onRowClick={(r) => setSelected(r.no)}
          searchPlaceholder="Search orders"
          toolbar={
            <Button variant="primary" size="sm" icon={Plus}>
              New order
            </Button>
          }
        />
      </Section>

      <Section title="Form">
        <Card title="New customer" description="Sections keep long forms scannable.">
          <FormSection title="Business" description="Legal identity and GST.">
            <Field label="Customer name" required>
              {(p) => <TextInput {...p} placeholder="Shree Prints" />}
            </Field>
            <Field label="GSTIN" hint="State and PAN are filled in automatically">
              {(p) => (
                <TextInput {...p} className="font-mono uppercase" placeholder="24ABCDE1234F1Z5" />
              )}
            </Field>
          </FormSection>
          <FormSection
            title="Pricing"
            description="Per-metre rate at 44″; other widths are derived."
          >
            <Field
              label="Rate at 44″"
              error={Number(rate) > 50 ? "Unusually high — check the rate" : undefined}
            >
              {(p) => (
                <NumberInput {...p} value={rate} onValueChange={setRate} prefix="₹" suffix="/m" />
              )}
            </Field>
            <Field label="Width">
              {(p) => (
                <Select
                  {...p}
                  value={width}
                  onValueChange={setWidth}
                  options={[24, 36, 44, 63].map((w) => ({ value: String(w), label: `${w}″` }))}
                />
              )}
            </Field>
            <Checkbox label="Allow cut rolls" checked={checked} onCheckedChange={setChecked} />
            <Switch
              label="Auto-block on overdue"
              description="Holds new orders past credit + grace days."
              checked={checked}
              onCheckedChange={setChecked}
            />
          </FormSection>
        </Card>
      </Section>

      <Section title="Record page">
        <Card padded>
          <Tabs
            value={tab}
            onValueChange={setTab}
            tabs={[
              {
                value: "profile",
                label: "Profile",
                content: (
                  <DefinitionList
                    columns={3}
                    items={[
                      { label: "Customer code", value: <Mono>CUST-0001</Mono> },
                      { label: "GSTIN", value: <Mono>24AAACB1234C1Z5</Mono> },
                      { label: "Credit limit", value: <Money value="100000" /> },
                      { label: "Credit days", value: "30 + 15 grace" },
                      { label: "Salesman", value: "Ketan Shah" },
                      { label: "Status", value: <Badge tone="success">Active</Badge> },
                    ]}
                  />
                ),
              },
              {
                value: "rates",
                label: "Rates",
                count: 12,
                content: <p className="text-sm text-fg-2">Rates and history.</p>,
              },
              {
                value: "activity",
                label: "Activity",
                content: (
                  <ActivityFeed
                    entries={[
                      {
                        id: "1",
                        who: "Ketan Shah",
                        what: "confirmed SO/2627/00142",
                        when: "23 Oct 2026, 11:02",
                      },
                      {
                        id: "2",
                        who: "Utsav J",
                        what: "changed the credit limit to ₹ 1,00,000",
                        when: "23 Oct 2026, 10:48",
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      </Section>

      <Section title="Feedback">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setConfirmOpen(true)}>Open confirm dialog</Button>
          <Button
            onClick={() =>
              toast({
                tone: "success",
                title: "Customer saved",
                description: "CUST-0042 · Shree Prints",
              })
            }
          >
            Show toast
          </Button>
        </div>
        <Stepper steps={["Scope", "Change", "Preview", "Apply"]} current={1} />
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Post this invoice?"
          description="Posted invoices can only be corrected with a credit note."
          confirmLabel="Post invoice"
          onConfirm={() => setConfirmOpen(false)}
        />
        <Card padded={false}>
          <EmptyState
            title="No unmapped rolls"
            hint="Rolls received without a SKU appear here until someone maps them."
          />
        </Card>
      </Section>
    </main>
  );
}
