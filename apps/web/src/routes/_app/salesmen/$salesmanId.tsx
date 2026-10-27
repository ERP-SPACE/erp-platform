import {
  type COMMISSION_METHODS,
  type COMMISSION_TRIGGERS,
  KYC_DOC_TYPES,
  type CommissionRuleItem,
  type KycDocumentItem,
  type SalesmanDetail,
} from "@erp/contracts";
import { istToday } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  FormSection,
  Mono,
  NumberInput,
  PageHeader,
  Segmented,
  Select,
  Switch,
  Tabs,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AddressFields } from "../../../components/master-fields.js";
import { ApiError, api, call } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { dateTime } from "../../../lib/format.js";
import {
  type AddressForm,
  STATE_OPTIONS,
  commissionRulesQuery,
  customersQuery,
  emptyAddress,
  flattenIssues,
  fromAddressForm,
  nullable,
  productsQuery,
  salesmanQuery,
  toAddressForm,
} from "../../../lib/masters.js";
import { can, keys, meQuery } from "../../../lib/queries.js";

const TABS = ["profile", "defaults", "customers", "kyc", "blocking"] as const;

export const Route = createFileRoute("/_app/salesmen/$salesmanId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: SalesmanPage,
});

function SalesmanPage() {
  const { salesmanId } = Route.useParams();
  const { tab = "profile" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: me } = useQuery(meQuery);
  const { data: s } = useQuery(salesmanQuery(salesmanId));
  if (!s) return null;
  const editable = can(me, "salesmen.manage");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Mono>{s.code}</Mono>
            <span>·</span>
            <span>{s.customerCount} customers</span>
            {s.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
            {s.blockMode !== "None" ? (
              <Badge tone="danger">
                Blocked: {s.blockMode === "All" ? "all customers" : "selected customers"}
              </Badge>
            ) : null}
          </span>
        }
        breadcrumbs={[
          { label: "Masters" },
          { label: "Salesmen", href: "/salesmen" },
          { label: s.name },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <Tabs
        value={tab}
        onValueChange={(t) =>
          void navigate({ search: { tab: t as (typeof TABS)[number] }, replace: true })
        }
        tabs={[
          {
            value: "profile",
            label: "Profile",
            content: <ProfileTab key={s.version} s={s} editable={editable} />,
          },
          {
            value: "defaults",
            label: "Defaults",
            content: <DefaultsTab key={s.version} s={s} editable={editable} />,
          },
          {
            value: "customers",
            label: "Customers & commission",
            count: s.customerCount,
            content: <CustomersTab s={s} editable={can(me, "commission.manage")} />,
          },
          {
            value: "kyc",
            label: "KYC documents",
            count: s.kycDocuments.length,
            content: <KycTab s={s} editable={editable} />,
          },
          {
            value: "blocking",
            label: "Blocking",
            content: <BlockingTab key={s.version} s={s} editable={editable} />,
          },
        ]}
      />
    </div>
  );
}

function useSave(s: SalesmanDetail, title: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  return {
    queryClient,
    toast,
    onError,
    done: async () => {
      toast({ tone: "success", title });
      await queryClient.invalidateQueries({ queryKey: keys.salesmen });
    },
    reloadKey: salesmanQuery(s.id).queryKey,
  };
}

/** The full update body with the current values; tabs override what they edit. */
function baseBody(s: SalesmanDetail) {
  return {
    name: s.name,
    phone: s.phone,
    whatsapp: s.whatsapp,
    email: s.email,
    address: s.address,
    stateCode: s.stateCode,
    targetSalesM: s.targetSalesM,
    defaultCreditLimit: s.defaultCreditLimit,
    defaultCreditDays: s.defaultCreditDays,
    defaultGraceDays: s.defaultGraceDays,
    active: s.active,
    version: s.version,
  };
}

function ProfileTab({ s, editable }: { s: SalesmanDetail; editable: boolean }) {
  const h = useSave(s, "Profile saved");
  const [f, setF] = useState({
    name: s.name,
    phone: s.phone ?? "",
    whatsapp: s.whatsapp ?? "",
    email: s.email ?? "",
    stateCode: s.stateCode ?? "",
    target: s.targetSalesM ? String(s.targetSalesM) : "",
    active: s.active,
  });
  const [address, setAddress] = useState<AddressForm>(toAddressForm(s.address));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hasAddress = Object.values(address).some((v) => v.trim());
  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.PATCH("/api/salesmen/{id}", {
          params: { path: { id: s.id } },
          body: {
            ...baseBody(s),
            name: f.name.trim(),
            phone: nullable(f.phone),
            whatsapp: nullable(f.whatsapp),
            email: nullable(f.email),
            stateCode: f.stateCode || null,
            targetSalesM: f.target ? Number(f.target) : null,
            address: hasAddress ? fromAddressForm(address) : null,
            active: f.active,
          },
        }),
      ),
    onSuccess: h.done,
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      h.onError(error, h.reloadKey);
    },
  });
  const text = (
    key: "name" | "phone" | "whatsapp" | "email",
    label: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Field label={label} error={errors[key]} required={key === "name"}>
      {(p) => (
        <TextInput
          {...p}
          {...extra}
          disabled={!editable}
          value={f[key]}
          onChange={(e) => setF({ ...f, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <Card
      footer={
        editable ? (
          <div className="flex justify-end">
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              Save profile
            </Button>
          </div>
        ) : undefined
      }
    >
      <FormSection
        title="Contact"
        description="Salesmen don't sign in; the office keeps their details here."
      >
        {text("name", "Name")}
        {text("email", "Email", { type: "email" })}
        {text("phone", "Mobile", { inputMode: "tel" })}
        {text("whatsapp", "WhatsApp", { inputMode: "tel" })}
        <Field label="Monthly target" error={errors.targetSalesM}>
          {(p) => (
            <NumberInput
              {...p}
              disabled={!editable}
              decimals={0}
              suffix="m"
              value={f.target}
              onValueChange={(v) => setF({ ...f, target: v })}
            />
          )}
        </Field>
        <Field label="GST state">
          {(p) => (
            <Select
              {...p}
              disabled={!editable}
              value={f.stateCode || undefined}
              onValueChange={(v) => setF({ ...f, stateCode: v })}
              placeholder="Not set"
              options={STATE_OPTIONS}
            />
          )}
        </Field>
      </FormSection>
      <FormSection title="Address" description="Optional.">
        <AddressFields
          value={address}
          onChange={setAddress}
          errors={hasAddress ? errors : {}}
          disabled={!editable}
        />
        {editable && hasAddress ? (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setAddress(emptyAddress)}
          >
            Clear address
          </Button>
        ) : null}
      </FormSection>
      <FormSection title="Status">
        <div className="sm:col-span-2">
          <Switch
            label="Active"
            description="Inactive salesmen can't be assigned to customers."
            checked={f.active}
            onCheckedChange={(v) => setF({ ...f, active: v })}
            disabled={!editable}
          />
        </div>
      </FormSection>
    </Card>
  );
}

function DefaultsTab({ s, editable }: { s: SalesmanDetail; editable: boolean }) {
  const h = useSave(s, "Defaults saved");
  const { data: products } = useQuery(productsQuery);
  const [limit, setLimit] = useState(s.defaultCreditLimit ?? "");
  const [days, setDays] = useState(s.defaultCreditDays?.toString() ?? "");
  const [grace, setGrace] = useState(s.defaultGraceDays?.toString() ?? "");
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(s.defaultRates.map((r) => [r.productId, r.baseRate44])),
  );
  const [filter, setFilter] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      await call(() =>
        api.PATCH("/api/salesmen/{id}", {
          params: { path: { id: s.id } },
          body: {
            ...baseBody(s),
            defaultCreditLimit: limit || null,
            defaultCreditDays: days ? Number(days) : null,
            defaultGraceDays: grace ? Number(grace) : null,
          },
        }),
      );
      await call(() =>
        api.PUT("/api/salesmen/{id}/default-rates", {
          params: { path: { id: s.id } },
          body: {
            rates: Object.entries(rates)
              .filter(([, v]) => v.trim())
              .map(([productId, baseRate44]) => ({ productId, baseRate44 })),
          },
        }),
      );
    },
    onSuccess: h.done,
    onError: (error) => h.onError(error, h.reloadKey),
  });
  const visible = (products ?? []).filter(
    (p) => p.active && p.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Card
      footer={
        editable ? (
          <div className="flex justify-end">
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              Save defaults
            </Button>
          </div>
        ) : undefined
      }
    >
      <FormSection
        title="Credit terms"
        description="Copied to every new customer of this salesman. Blank values use the company default."
      >
        <Field label="Credit limit">
          {(p) => (
            <NumberInput
              {...p}
              disabled={!editable}
              decimals={2}
              prefix="₹"
              value={limit}
              onValueChange={setLimit}
            />
          )}
        </Field>
        <Field label="Credit days">
          {(p) => (
            <NumberInput
              {...p}
              disabled={!editable}
              decimals={0}
              suffix="days"
              value={days}
              onValueChange={setDays}
            />
          )}
        </Field>
        <Field label="Grace days" hint="Internal only — never printed">
          {(p) => (
            <NumberInput
              {...p}
              disabled={!editable}
              decimals={0}
              suffix="days"
              value={grace}
              onValueChange={setGrace}
            />
          )}
        </Field>
      </FormSection>
      <FormSection
        title="Default rates"
        description="₹ per metre at 44″. New customers get these as their rates from the day they're added."
      >
        <div className="grid gap-3 sm:col-span-2">
          <TextInput
            aria-label="Filter products"
            placeholder="Filter products"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Default rates per product</caption>
              <thead className="sticky top-0 bg-muted text-left text-xs text-fg-3">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Product
                  </th>
                  <th scope="col" className="w-44 px-4 py-2 text-right font-medium">
                    ₹/m at 44″
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-1.5">{p.name}</td>
                    <td className="px-4 py-1.5">
                      <NumberInput
                        aria-label={`Rate for ${p.name}`}
                        disabled={!editable}
                        decimals={4}
                        prefix="₹"
                        value={rates[p.id] ?? ""}
                        onValueChange={(v) => setRates({ ...rates, [p.id]: v })}
                        className="text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </FormSection>
    </Card>
  );
}

function CustomersTab({ s, editable }: { s: SalesmanDetail; editable: boolean }) {
  const { data: customers } = useQuery(customersQuery);
  const { data: rules } = useQuery(commissionRulesQuery(s.id));
  const assigned = (customers ?? []).filter((c) => c.salesmanId === s.id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState<(typeof COMMISSION_METHODS)[number]>("PERCENT_SALES");
  const [rate, setRate] = useState("");
  const [trigger, setTrigger] =
    useState<(typeof COMMISSION_TRIGGERS)[number]>("ON_PAYMENT_RECEIVED");
  const [from, setFrom] = useState(istToday());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reload = () => queryClient.invalidateQueries({ queryKey: keys.salesmen });

  const add = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST("/api/salesmen/{id}/commission-rules", {
          params: { path: { id: s.id } },
          body: { customerId, method, rate, triggerEvent: trigger, validFrom: from },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: "Commission rule added" });
      setRate("");
      setErrors({});
      await reload();
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      onError(error);
    },
  });
  const close = useMutation({
    mutationFn: (rule: CommissionRuleItem) =>
      call(() =>
        api.PATCH("/api/commission-rules/{ruleId}", {
          params: { path: { ruleId: rule.id } },
          body: { validTo: istToday() },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: "Rule ends today" });
      await reload();
    },
    onError: (error) => onError(error),
  });

  const ruleColumns: ColumnDef<CommissionRuleItem, unknown>[] = [
    { accessorKey: "customerName", header: "Customer" },
    {
      id: "rate",
      header: "Commission",
      accessorFn: (r) =>
        r.method === "PER_METER" ? `₹${r.rate}/m` : `${r.rate}% of taxable value`,
    },
    {
      accessorKey: "triggerEvent",
      header: "Earned when",
      cell: (c) => (c.getValue() === "ON_SI_POSTED" ? "Invoice posted" : "Payment received"),
    },
    {
      id: "validity",
      header: "Valid",
      accessorFn: (r) => `${r.validFrom} → ${r.validTo ?? "open"}`,
    },
    {
      id: "status",
      header: "",
      cell: (c) =>
        c.row.original.current ? (
          editable && !c.row.original.validTo ? (
            <Button size="sm" variant="ghost" onClick={() => close.mutate(c.row.original)}>
              End today
            </Button>
          ) : (
            <Badge tone="success">Current</Badge>
          )
        ) : (
          <Badge>Ended</Badge>
        ),
    },
  ];

  return (
    <div className="grid gap-6">
      <Card
        title="Assigned customers"
        description="Customers whose salesman is set to this person."
        padded={false}
      >
        {assigned.length ? (
          <ul className="divide-y divide-border">
            {assigned.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <Link
                  to="/customers/$customerId"
                  params={{ customerId: c.id }}
                  className="font-medium text-primary hover:underline"
                >
                  {c.legalName}
                </Link>
                <span className="text-fg-3">{c.city}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No customers yet"
            hint="Choose this salesman on a customer to assign them."
          />
        )}
      </Card>
      <Card
        title="Commission rules"
        description="Accrual starts with invoicing (Stage 4). Rules for one customer can't overlap in time."
      >
        {editable ? (
          <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/50 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Customer" error={errors.customerId}>
              {(p) => (
                <Select
                  {...p}
                  value={customerId || undefined}
                  onValueChange={setCustomerId}
                  placeholder="Choose"
                  options={(customers ?? [])
                    .filter((c) => c.active)
                    .map((c) => ({ value: c.id, label: c.legalName }))}
                />
              )}
            </Field>
            <Field label="Method">
              {(p) => (
                <Select
                  {...p}
                  value={method}
                  onValueChange={(v) => setMethod(v as typeof method)}
                  options={[
                    { value: "PERCENT_SALES", label: "% of taxable value" },
                    { value: "PER_METER", label: "₹ per metre" },
                  ]}
                />
              )}
            </Field>
            <Field label={method === "PER_METER" ? "₹ per metre" : "Percent"} error={errors.rate}>
              {(p) => (
                <NumberInput
                  {...p}
                  decimals={4}
                  suffix={method === "PER_METER" ? "₹/m" : "%"}
                  value={rate}
                  onValueChange={setRate}
                />
              )}
            </Field>
            <Field label="Earned when">
              {(p) => (
                <Select
                  {...p}
                  value={trigger}
                  onValueChange={(v) => setTrigger(v as typeof trigger)}
                  options={[
                    { value: "ON_PAYMENT_RECEIVED", label: "Payment received" },
                    { value: "ON_SI_POSTED", label: "Invoice posted" },
                  ]}
                />
              )}
            </Field>
            <Field label="From" error={errors.validFrom}>
              {(p) => (
                <TextInput
                  {...p}
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              )}
            </Field>
            <div className="sm:col-span-2 lg:col-span-5">
              <Button
                variant="primary"
                disabled={!customerId || !rate}
                busy={add.isPending}
                onClick={() => add.mutate()}
              >
                Add rule
              </Button>
            </div>
          </div>
        ) : null}
        <DataTable
          caption="Commission rules"
          data={rules ?? []}
          columns={ruleColumns}
          getRowId={(r) => r.id}
          pageSize={false}
        />
      </Card>
    </div>
  );
}

function KycTab({ s, editable }: { s: SalesmanDetail; editable: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<(typeof KYC_DOC_TYPES)[number]>("PAN");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<KycDocumentItem | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("docType", docType); // text fields must precede the file
      if (notes.trim()) form.append("notes", notes.trim());
      form.append("file", file!);
      const res = await fetch(`/api/salesmen/${s.id}/kyc`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new ApiError(res.status, await res.json());
    },
    onSuccess: async () => {
      toast({ tone: "success", title: `${docType} uploaded` });
      setFile(null);
      setNotes("");
      setError(undefined);
      if (fileRef.current) fileRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: keys.salesmen });
    },
    onError: (e) => {
      if (e instanceof ApiError) setError(e.problem.issues?.[0]?.message ?? e.problem.title);
      onError(e);
    },
  });
  const remove = useMutation({
    mutationFn: (doc: KycDocumentItem) =>
      call(() => api.DELETE("/api/kyc-documents/{docId}", { params: { path: { docId: doc.id } } })),
    onSuccess: async () => {
      setRemoving(null);
      toast({ tone: "success", title: "Document removed" });
      await queryClient.invalidateQueries({ queryKey: keys.salesmen });
    },
    onError: (e) => onError(e),
  });

  return (
    <div className="grid gap-6">
      {editable ? (
        <Card title="Upload a document" description="PDF, PNG or JPEG up to 5 MB.">
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Document type">
              {(p) => (
                <Select
                  {...p}
                  value={docType}
                  onValueChange={(v) => setDocType(v as typeof docType)}
                  options={KYC_DOC_TYPES.map((t) => ({ value: t, label: t }))}
                />
              )}
            </Field>
            <Field label="File" error={error}>
              {(p) => (
                <input
                  {...p}
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-fg-2 file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg"
                />
              )}
            </Field>
            <Field label="Notes">
              {(p) => (
                <TextInput
                  {...p}
                  maxLength={300}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </Field>
            <Button
              variant="primary"
              icon={Upload}
              disabled={!file}
              busy={upload.isPending}
              onClick={() => upload.mutate()}
            >
              Upload
            </Button>
          </div>
        </Card>
      ) : null}
      <Card title="Documents" padded={false}>
        {s.kycDocuments.length ? (
          <ul className="divide-y divide-border">
            {s.kycDocuments.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <FileText className="size-5 text-fg-3" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {d.docType} <span className="font-normal text-fg-3">· {d.fileName}</span>
                  </p>
                  <p className="text-xs text-fg-3">
                    {(d.sizeBytes / 1024).toFixed(0)} KB · uploaded {dateTime(d.uploadedAt)}
                    {d.uploadedByName ? ` by ${d.uploadedByName}` : ""}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </p>
                </div>
                {editable ? (
                  <>
                    <Button asChild size="sm" variant="secondary" icon={Download}>
                      <a href={`/api/kyc-documents/${d.id}/file`} download={d.fileName}>
                        Download
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      iconOnly
                      aria-label={`Remove ${d.docType}`}
                      onClick={() => setRemoving(d)}
                    />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={FileText}
            title="No KYC documents"
            hint="Upload PAN, Aadhaar, agreement and bank proof."
          />
        )}
      </Card>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this document?"
        description={
          removing ? `${removing.docType} · ${removing.fileName} will be deleted.` : undefined
        }
        confirmLabel="Remove"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </div>
  );
}

function BlockingTab({ s, editable }: { s: SalesmanDetail; editable: boolean }) {
  const h = useSave(s, "Blocking saved");
  const { data: customers } = useQuery(customersQuery);
  const assigned = useMemo(
    () => (customers ?? []).filter((c) => c.salesmanId === s.id),
    [customers, s.id],
  );
  const [mode, setMode] = useState(s.blockMode);
  const [selected, setSelected] = useState<string[]>(s.blockedCustomerIds);
  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.PUT("/api/salesmen/{id}/block", {
          params: { path: { id: s.id } },
          body: {
            blockMode: mode,
            customerIds: mode === "Selective" ? selected : [],
            version: s.version,
          },
        }),
      ),
    onSuccess: h.done,
    onError: (error) => h.onError(error, h.reloadKey),
  });
  return (
    <Card
      title="Block new deliveries and invoices"
      description="Use when a salesman leaves or their accounts are under review. Takes effect on new delivery challans and invoices."
      footer={
        editable ? (
          <div className="flex justify-end">
            <Button
              variant="primary"
              busy={save.isPending}
              disabled={mode === "Selective" && selected.length === 0}
              onClick={() => save.mutate()}
            >
              Save blocking
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <Segmented
          label="Block mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "None", label: "Not blocked" },
            { value: "All", label: "All customers" },
            { value: "Selective", label: "Selected customers" },
          ]}
        />
        {mode === "Selective" ? (
          assigned.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {assigned.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.legalName}
                  disabled={!editable}
                  checked={selected.includes(c.id)}
                  onCheckedChange={(on) =>
                    setSelected(on ? [...selected, c.id] : selected.filter((x) => x !== c.id))
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-3">This salesman has no customers to choose from.</p>
          )
        ) : null}
      </div>
    </Card>
  );
}
