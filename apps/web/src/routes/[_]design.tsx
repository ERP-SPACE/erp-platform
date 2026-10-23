import {
  Button,
  Checkbox,
  ConfirmDialog,
  DefinitionList,
  EmptyState,
  Field,
  Kbd,
  MarginNote,
  Money,
  Mono,
  NumberInput,
  PageTitle,
  Qty,
  Register,
  Rule,
  Segmented,
  Select,
  Sheet,
  SheetLayout,
  StatusMark,
  Stepper,
  Switch,
  Tabs,
  TextInput,
  Timeline,
  useToast,
} from "@erp/ui";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useState } from "react";
import { type Density, type Theme, setPrefs, usePrefs } from "../lib/prefs.js";

/** Living reference for the Editorial Ledger design system (public; checked by axe in CI). */
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
  Confirmed: "positive",
  "On hold": "caution",
  Draft: "neutral",
  Closed: "info",
} as const;

const orderColumns: ColumnDef<SampleOrder, unknown>[] = [
  { accessorKey: "no", header: "Order", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  { accessorKey: "party", header: "Party" },
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
      <StatusMark tone={TONE[c.getValue() as SampleOrder["status"]]}>
        {c.getValue() as string}
      </StatusMark>
    ),
  },
];

function Specimen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-rule pt-6" aria-label={title}>
      <h2 className="text-lg">{title}</h2>
      {children}
    </section>
  );
}

function DesignPage() {
  const prefs = usePrefs();
  const toast = useToast();
  const [selected, setSelected] = useState(ORDERS[0]!.no);
  const [rate, setRate] = useState("1800.00");
  const [width, setWidth] = useState("44");
  const [checked, setChecked] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState("profile");

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-8 py-10">
      <PageTitle
        eyebrow="Design system"
        title="Editorial Ledger"
        dateline="Calm, typographic, exact — an interactive ledger book."
        actions={
          <div className="flex items-center gap-3">
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

      <Specimen title="Type & numbers">
        <div className="grid gap-3">
          <p className="font-serif text-2xl text-ink">Every roll, every rupee.</p>
          <p className="max-w-prose text-sm text-ink-2">
            Inter for the interface with tabular, lining figures; Newsreader for titles; JetBrains
            Mono for numbers that are identifiers like <Mono>SI/2627/00001</Mono> and{" "}
            <Mono>24AAACB1234C1Z5</Mono>.
          </p>
          <p className="flex flex-wrap gap-6 text-base">
            <Money value="482300" />
            <Money value="-1200.5" />
            <Qty value={1000} unit="m" />
            <Qty value={44} unit="in" />
            <Qty value={12} unit="rolls" />
          </p>
        </div>
      </Specimen>

      <Specimen title="Status">
        <div className="flex flex-wrap gap-5">
          <StatusMark tone="positive">Confirmed</StatusMark>
          <StatusMark tone="caution">On hold</StatusMark>
          <StatusMark tone="critical">Overdue 12 days</StatusMark>
          <StatusMark tone="info">GST document</StatusMark>
          <StatusMark>Draft</StatusMark>
        </div>
      </Specimen>

      <Specimen title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" shortcut="P">
            Post invoice
          </Button>
          <Button>Save draft</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Mark as scrap</Button>
          <Button variant="primary" busy>
            Posting
          </Button>
          <Button size="sm">Small</Button>
          <span className="text-sm text-ink-2">
            Press <Kbd>Ctrl K</Kbd> anywhere
          </span>
        </div>
      </Specimen>

      <Specimen title="Fields">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Party" hint="Search by name, GSTIN or code">
            {(p) => <TextInput {...p} placeholder="Shree Prints" />}
          </Field>
          <Field
            label="Rate at 44″"
            error={Number(rate) > 5000 ? "Unusually high — check the rate" : undefined}
          >
            {(p) => <NumberInput {...p} value={rate} onValueChange={setRate} suffix="₹/m" />}
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
          <Checkbox label="Allow cutting rolls" checked={checked} onCheckedChange={setChecked} />
          <Switch
            label="Restart numbering every 1 April"
            checked={checked}
            onCheckedChange={setChecked}
          />
        </div>
      </Specimen>

      <Specimen title="Register">
        <Register
          caption="Sample sales orders"
          data={ORDERS}
          columns={orderColumns}
          getRowId={(r) => r.no}
          selectedId={selected}
          onSelect={(r) => setSelected(r.no)}
        />
      </Specimen>

      <Specimen title="Sheet with margin notes">
        <SheetLayout
          sheet={
            <Sheet
              kicker="Sales order"
              title="Shree Prints"
              number="SO/2627/00142"
              status={<StatusMark tone="positive">Confirmed</StatusMark>}
              meta={<span className="font-serif italic">Ring Road, Surat · 24AAACB1234C1Z5</span>}
              footer={
                <div className="flex justify-end gap-2">
                  <Button>Print</Button>
                  <Button variant="primary" shortcut="D">
                    Create challan
                  </Button>
                </div>
              }
            >
              <DefinitionList
                items={[
                  { label: "Order date", value: "23 Oct 2026" },
                  { label: "Salesman", value: "Ketan Shah" },
                  { label: "Credit", value: <StatusMark tone="positive">Within limit</StatusMark> },
                  { label: "Deal rate", value: <Money value="1800" /> },
                ]}
              />
              <Rule className="my-6" />
              <div className="flex justify-between text-sm">
                <span className="text-ink-2">Total (incl. GST)</span>
                <Money value="482300" className="text-lg" />
              </div>
              <Rule double className="mt-2" />
            </Sheet>
          }
          margin={
            <>
              <MarginNote title="Progress">
                <Stepper steps={["Order", "Challan", "Invoice"]} current={1} />
              </MarginNote>
              <MarginNote title="History">
                <Timeline
                  entries={[
                    {
                      id: "1",
                      what: "Confirmed after credit check",
                      when: "23 Oct, 11:02",
                      who: "Ketan",
                    },
                    { id: "2", what: "Created", when: "23 Oct, 10:48", who: "Ketan" },
                  ]}
                />
              </MarginNote>
            </>
          }
        />
      </Specimen>

      <Specimen title="Tabs, dialogs, toasts, empty states">
        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            {
              value: "profile",
              label: "Profile",
              content: <p className="text-sm text-ink-2">Contacts, addresses, GST type.</p>,
            },
            {
              value: "credit",
              label: "Credit",
              content: <p className="text-sm text-ink-2">Exposure, limit and grace window.</p>,
            },
          ]}
        />
        <div className="flex gap-3">
          <Button onClick={() => setConfirmOpen(true)}>Open confirm dialog</Button>
          <Button
            onClick={() =>
              toast({
                tone: "positive",
                title: "Invoice SI/2627/00001 posted",
                description: "Voucher queued for the accounting stage.",
              })
            }
          >
            Show toast
          </Button>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Post this invoice?"
          description="Posted invoices can only be corrected with a credit note."
          confirmLabel="Post"
          onConfirm={() => setConfirmOpen(false)}
        />
        <EmptyState
          title="No unmapped rolls."
          hint="Rolls received without a SKU appear here until someone maps them."
        />
      </Specimen>
    </main>
  );
}
