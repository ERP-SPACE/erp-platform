import {
  type BLOCK_RULES,
  GST_TYPES,
  WHATSAPP_LANGUAGES,
  type CustomerDetail,
} from "@erp/contracts";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  FormSection,
  Kbd,
  NumberInput,
  Select,
  Switch,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Star, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ApiError, api, call } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import {
  type AddressForm,
  customerDefaultsQuery,
  customerGroupsQuery,
  emptyAddress,
  flattenIssues,
  fromAddressForm,
  nullable,
  salesmenQuery,
  toAddressForm,
} from "../lib/masters.js";
import { keys } from "../lib/queries.js";
import { AddressFields, GstFields } from "./master-fields.js";

interface Contact {
  name: string;
  phone: string;
  email: string;
  role: string;
  isPrimary: boolean;
}
interface Shipping {
  label: string;
  address: AddressForm;
  stateCode: string;
  isDefault: boolean;
}
interface FormState {
  legalName: string;
  tradeName: string;
  businessType: string;
  phone: string;
  email: string;
  gstType: (typeof GST_TYPES)[number];
  gstin: string;
  stateCode: string;
  pan: string;
  billing: AddressForm;
  contacts: Contact[];
  shipping: Shipping[];
  groupIds: string[];
  salesmanId: string;
  applySalesmanRates: boolean;
  creditLimit: string;
  creditDays: string;
  graceDays: string;
  blockRule: (typeof BLOCK_RULES)[number];
  autoBlock: boolean;
  whatsappNumber: string;
  whatsappLanguage: (typeof WHATSAPP_LANGUAGES)[number];
  whatsappConsent: boolean;
  monthlyCapacityM: string;
  targetSalesM: string;
  allowCut: boolean;
  referralSource: string;
  referralName: string;
  referralContact: string;
  active: boolean;
}

const blankContact: Contact = { name: "", phone: "", email: "", role: "", isPrimary: false };

function initial(c?: CustomerDetail): FormState {
  return {
    legalName: c?.legalName ?? "",
    tradeName: c?.tradeName ?? "",
    businessType: c?.businessType ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    gstType: c?.gstType ?? "Regular",
    gstin: c?.gstin ?? "",
    stateCode: c?.stateCode ?? "24",
    pan: c?.pan ?? "",
    billing: toAddressForm(c?.billingAddress),
    contacts: c?.contacts.map((x) => ({
      name: x.name,
      phone: x.phone ?? "",
      email: x.email ?? "",
      role: x.role ?? "",
      isPrimary: x.isPrimary,
    })) ?? [{ ...blankContact, isPrimary: true }],
    shipping:
      c?.shippingAddresses.map((s) => ({
        label: s.label,
        address: toAddressForm(s.address),
        stateCode: s.stateCode,
        isDefault: s.isDefault,
      })) ?? [],
    groupIds: c?.groups.map((g) => g.id) ?? [],
    salesmanId: c?.salesmanId ?? "",
    applySalesmanRates: true,
    creditLimit: c?.creditPolicy.creditLimit ?? "",
    creditDays: c ? String(c.creditPolicy.creditDays) : "",
    graceDays: c ? String(c.creditPolicy.graceDays) : "",
    blockRule: c?.creditPolicy.blockRule ?? "BOTH",
    autoBlock: c?.creditPolicy.autoBlock ?? true,
    whatsappNumber: c?.whatsappNumber ?? "",
    whatsappLanguage: c?.whatsappLanguage ?? "English",
    whatsappConsent: c?.whatsappConsent ?? false,
    monthlyCapacityM: c?.monthlyCapacityM?.toString() ?? "",
    targetSalesM: c?.targetSalesM?.toString() ?? "",
    allowCut: c?.allowCut ?? true,
    referralSource: c?.referral?.source ?? "",
    referralName: c?.referral?.name ?? "",
    referralContact: c?.referral?.contact ?? "",
    active: c?.active ?? true,
  };
}

/** Enter moves to the next text field instead of submitting (brief: keyboard-first forms). */
function enterToNext(e: KeyboardEvent<HTMLFormElement>) {
  const target = e.target as HTMLElement;
  if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (
    !(target instanceof HTMLInputElement) ||
    ["checkbox", "radio", "file", "submit"].includes(target.type)
  )
    return;
  e.preventDefault();
  const focusables = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>(
      "input:not([type=hidden]):not([disabled]), button[role=combobox]:not([disabled]), button[role=switch]:not([disabled]), button[role=checkbox]:not([disabled]), textarea:not([disabled])",
    ),
  ).filter((el) => el.offsetParent !== null);
  const next = focusables[focusables.indexOf(target) + 1];
  next?.focus();
}

/**
 * New / edit customer (PRD §5.5). Fully keyboard-operable: Enter moves to the next field,
 * Ctrl+S saves. Choosing a salesman pre-fills credit terms and shows the rates the customer
 * will start with (Stage 1 gate). Credit terms on an existing customer change from Customer 360
 * (step-up + reason), not here.
 */
export function CustomerForm({ customer }: { customer?: CustomerDetail }) {
  const isNew = !customer;
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [f, setF] = useState<FormState>(() => initial(customer));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));

  const { data: groups } = useQuery(customerGroupsQuery);
  const { data: salesmen } = useQuery(salesmenQuery("true"));
  const defaults = useQuery({
    ...customerDefaultsQuery(f.salesmanId || undefined),
    enabled: isNew,
  });

  // A new customer's credit fields follow the chosen salesman's defaults (else the company's).
  // Adjusted during render when a new defaults response arrives (React's derived-state pattern).
  const [appliedDefaults, setAppliedDefaults] = useState<typeof defaults.data>(undefined);
  if (isNew && defaults.data && defaults.data !== appliedDefaults) {
    const d = defaults.data.creditPolicy;
    setAppliedDefaults(defaults.data);
    setF((prev) => ({
      ...prev,
      creditLimit: d.creditLimit,
      creditDays: String(d.creditDays),
      graceDays: String(d.graceDays),
      blockRule: d.blockRule,
      autoBlock: d.autoBlock,
    }));
  }

  const save = useMutation({
    mutationFn: () => {
      const unregistered = f.gstType === "Unregistered";
      const body = {
        legalName: f.legalName.trim(),
        tradeName: nullable(f.tradeName),
        businessType: nullable(f.businessType),
        phone: nullable(f.phone),
        email: nullable(f.email),
        gstType: f.gstType,
        gstin: unregistered ? null : nullable(f.gstin),
        stateCode: f.stateCode,
        pan: nullable(f.pan.toUpperCase()),
        billingAddress: fromAddressForm(f.billing),
        contacts: f.contacts
          .filter((c) => c.name.trim())
          .map((c) => ({
            name: c.name.trim(),
            phone: nullable(c.phone),
            email: nullable(c.email),
            role: nullable(c.role),
            isPrimary: c.isPrimary,
          })),
        shippingAddresses: f.shipping
          .filter((s) => s.label.trim())
          .map((s) => ({
            label: s.label.trim(),
            address: fromAddressForm(s.address),
            stateCode: s.stateCode,
            isDefault: s.isDefault,
          })),
        groupIds: f.groupIds,
        salesmanId: f.salesmanId || null,
        whatsappNumber: nullable(f.whatsappNumber),
        whatsappLanguage: f.whatsappLanguage,
        whatsappConsent: f.whatsappConsent,
        monthlyCapacityM: f.monthlyCapacityM ? Number(f.monthlyCapacityM) : null,
        targetSalesM: f.targetSalesM ? Number(f.targetSalesM) : null,
        allowCut: f.allowCut,
        tcsApplicable: false,
        referral:
          f.referralSource || f.referralName || f.referralContact
            ? {
                source: nullable(f.referralSource),
                name: nullable(f.referralName),
                contact: nullable(f.referralContact),
              }
            : null,
      };
      return isNew
        ? call<CustomerDetail>(() =>
            api.POST("/api/customers", {
              body: {
                ...body,
                applySalesmanRates: f.applySalesmanRates,
                creditPolicy: {
                  creditLimit: f.creditLimit || "0",
                  creditDays: Number(f.creditDays || 0),
                  graceDays: Number(f.graceDays || 0),
                  blockRule: f.blockRule,
                  autoBlock: f.autoBlock,
                },
              },
            }),
          )
        : call<CustomerDetail>(() =>
            api.PATCH("/api/customers/{id}", {
              params: { path: { id: customer.id } },
              body: { ...body, active: f.active, version: customer.version },
            }),
          );
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: isNew ? `Customer ${saved.code} created` : "Customer saved",
        description: saved.legalName,
      });
      await queryClient.invalidateQueries({ queryKey: keys.customers });
      await queryClient.invalidateQueries({ queryKey: keys.dashboard });
      void navigate({ to: "/customers/$customerId", params: { customerId: saved.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      onError(error, keys.customers);
    },
  });

  // Ctrl+S saves from anywhere on the page.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const text = (
    key:
      | "legalName"
      | "tradeName"
      | "businessType"
      | "phone"
      | "email"
      | "pan"
      | "whatsappNumber"
      | "referralSource"
      | "referralName"
      | "referralContact",
    label: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Field label={label} error={errors[key]} required={key === "legalName"}>
      {(p) => (
        <TextInput {...p} {...extra} value={f[key]} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );
  const setContact = (i: number, patch: Partial<Contact>) =>
    set(
      "contacts",
      f.contacts.map((c, idx) =>
        idx === i ? { ...c, ...patch } : patch.isPrimary ? { ...c, isPrimary: false } : c,
      ),
    );
  const setShipping = (i: number, patch: Partial<Shipping>) =>
    set(
      "shipping",
      f.shipping.map((s, idx) =>
        idx === i ? { ...s, ...patch } : patch.isDefault ? { ...s, isDefault: false } : s,
      ),
    );
  const salesmanDefaults = defaults.data;

  return (
    <form
      ref={formRef}
      aria-label={isNew ? "New customer" : "Edit customer"}
      onKeyDown={enterToNext}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-fg-3">
              <Kbd>Enter</Kbd> next field · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> save
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void (customer
                    ? navigate({
                        to: "/customers/$customerId",
                        params: { customerId: customer.id },
                      })
                    : navigate({ to: "/customers" }))
                }
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={save.isPending} shortcut="Ctrl S">
                {isNew ? "Create customer" : "Save customer"}
              </Button>
            </div>
          </div>
        }
      >
        <FormSection title="Business" description="As it should appear on invoices.">
          {text("legalName", "Legal name", { autoFocus: true })}
          {text("tradeName", "Trade name")}
          {text("phone", "Phone", { inputMode: "tel" })}
          {text("email", "Email", { type: "email" })}
          {text("businessType", "Business type", { placeholder: "e.g. Textile printer" })}
        </FormSection>

        <FormSection title="GST" description="A valid GSTIN fills the state and PAN.">
          <Field label="GST registration" required>
            {(p) => (
              <Select
                {...p}
                value={f.gstType}
                onValueChange={(v) => set("gstType", v as FormState["gstType"])}
                options={GST_TYPES.map((t) => ({ value: t, label: t }))}
              />
            )}
          </Field>
          <GstFields
            gstin={f.gstin}
            stateCode={f.stateCode}
            errors={errors}
            hideGstin={f.gstType === "Unregistered"}
            gstinRequired
            onGstin={(gstin, d) =>
              setF((prev) => ({
                ...prev,
                gstin,
                ...(d && {
                  stateCode: d.stateCode,
                  pan: d.pan,
                  billing: { ...prev.billing, state: prev.billing.state || d.stateName },
                }),
              }))
            }
            onState={(code) => set("stateCode", code)}
          />
          {text("pan", "PAN", { maxLength: 10, className: "font-mono uppercase" })}
        </FormSection>

        <FormSection title="Billing address">
          <AddressFields value={f.billing} onChange={(b) => set("billing", b)} errors={errors} />
        </FormSection>

        <FormSection
          title="Contacts"
          description="One contact is primary; invoices and reminders go to them."
        >
          <div className="grid gap-3 sm:col-span-2">
            {f.contacts.map((c, i) => (
              <div
                key={i}
                className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
              >
                <Field label="Name">
                  {(p) => (
                    <TextInput
                      {...p}
                      value={c.name}
                      onChange={(e) => setContact(i, { name: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Phone">
                  {(p) => (
                    <TextInput
                      {...p}
                      inputMode="tel"
                      value={c.phone}
                      onChange={(e) => setContact(i, { phone: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Role">
                  {(p) => (
                    <TextInput
                      {...p}
                      placeholder="Owner, Accounts…"
                      value={c.role}
                      onChange={(e) => setContact(i, { role: e.target.value })}
                    />
                  )}
                </Field>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={c.isPrimary ? "secondary" : "ghost"}
                    icon={Star}
                    aria-pressed={c.isPrimary}
                    onClick={() => setContact(i, { isPrimary: true })}
                  >
                    {c.isPrimary ? "Primary" : "Make primary"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    iconOnly
                    aria-label={`Remove contact ${i + 1}`}
                    onClick={() =>
                      set(
                        "contacts",
                        f.contacts.filter((_, idx) => idx !== i),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Plus}
              className="justify-self-start"
              onClick={() =>
                set("contacts", [
                  ...f.contacts,
                  { ...blankContact, isPrimary: f.contacts.length === 0 },
                ])
              }
            >
              Add contact
            </Button>
          </div>
        </FormSection>

        <FormSection
          title="Shipping addresses"
          description="Optional. Leave empty to ship to the billing address."
        >
          <div className="grid gap-3 sm:col-span-2">
            {f.shipping.map((s, i) => (
              <div
                key={i}
                className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
              >
                <Field label="Label">
                  {(p) => (
                    <TextInput
                      {...p}
                      placeholder="Godown 2"
                      value={s.label}
                      onChange={(e) => setShipping(i, { label: e.target.value })}
                    />
                  )}
                </Field>
                <GstFields
                  hideGstin
                  gstin=""
                  stateCode={s.stateCode}
                  onGstin={() => undefined}
                  onState={(code) => setShipping(i, { stateCode: code })}
                />
                <AddressFields value={s.address} onChange={(a) => setShipping(i, { address: a })} />
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Switch
                    label="Default shipping address"
                    checked={s.isDefault}
                    onCheckedChange={(on) => setShipping(i, { isDefault: on })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    className="ml-auto"
                    onClick={() =>
                      set(
                        "shipping",
                        f.shipping.filter((_, idx) => idx !== i),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Plus}
              className="justify-self-start"
              onClick={() =>
                set("shipping", [
                  ...f.shipping,
                  {
                    label: "",
                    address: emptyAddress,
                    stateCode: f.stateCode,
                    isDefault: f.shipping.length === 0,
                  },
                ])
              }
            >
              Add shipping address
            </Button>
          </div>
        </FormSection>

        <FormSection
          title="Salesman & groups"
          description={
            isNew ? "Choosing a salesman pre-fills credit terms and starting rates." : undefined
          }
        >
          <Field label="Salesman" error={errors.salesmanId}>
            {(p) => (
              <Select
                {...p}
                value={f.salesmanId || "none"}
                onValueChange={(v) => set("salesmanId", v === "none" ? "" : v)}
                options={[
                  { value: "none", label: "No salesman" },
                  ...(salesmen ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.code}` })),
                ]}
              />
            )}
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">Groups</legend>
            <div className="flex flex-wrap gap-4">
              {(groups ?? []).map((g) => (
                <Checkbox
                  key={g.id}
                  label={g.name}
                  checked={f.groupIds.includes(g.id)}
                  onCheckedChange={(on) =>
                    set(
                      "groupIds",
                      on ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
          {isNew && f.salesmanId && salesmanDefaults ? (
            <div
              className="rounded-lg border border-primary/20 bg-primary-soft/60 p-4 text-sm sm:col-span-2"
              data-testid="salesman-defaults"
            >
              <p className="font-medium text-fg">
                {salesmanDefaults.creditSource === "salesman"
                  ? "Credit terms pre-filled from this salesman"
                  : "This salesman has no credit defaults — company defaults apply"}
              </p>
              {salesmanDefaults.rates.length ? (
                <>
                  <p className="mt-2 text-fg-2">Starting rates (₹/m at 44″):</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {salesmanDefaults.rates.map((r) => (
                      <li key={r.productId}>
                        <Badge tone="primary" dot={false}>
                          {r.productName}: <span className="tnum">₹{r.baseRate44}</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <Switch
                      label="Apply these rates to the new customer"
                      checked={f.applySalesmanRates}
                      onCheckedChange={(v) => set("applySalesmanRates", v)}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-1 text-fg-3">No default rates set for this salesman.</p>
              )}
            </div>
          ) : null}
        </FormSection>

        {isNew ? (
          <FormSection
            title="Credit"
            description="Grace days are internal and never printed. Change later from the customer's Credit tab."
          >
            <Field label="Credit limit" error={errors.creditLimit}>
              {(p) => (
                <NumberInput
                  {...p}
                  decimals={2}
                  prefix="₹"
                  value={f.creditLimit}
                  onValueChange={(v) => set("creditLimit", v)}
                />
              )}
            </Field>
            <Field label="Credit days" error={errors.creditDays}>
              {(p) => (
                <NumberInput
                  {...p}
                  decimals={0}
                  suffix="days"
                  value={f.creditDays}
                  onValueChange={(v) => set("creditDays", v)}
                />
              )}
            </Field>
            <Field label="Grace days" error={errors.graceDays}>
              {(p) => (
                <NumberInput
                  {...p}
                  decimals={0}
                  suffix="days"
                  value={f.graceDays}
                  onValueChange={(v) => set("graceDays", v)}
                />
              )}
            </Field>
            <Field label="Block when">
              {(p) => (
                <Select
                  {...p}
                  value={f.blockRule}
                  onValueChange={(v) => set("blockRule", v as FormState["blockRule"])}
                  options={[
                    { value: "BOTH", label: "Over limit or overdue" },
                    { value: "OVER_LIMIT", label: "Over credit limit" },
                    { value: "OVER_DUE", label: "Overdue past grace" },
                  ]}
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Switch
                label="Block automatically"
                description="New orders stop when the rule is breached."
                checked={f.autoBlock}
                onCheckedChange={(v) => set("autoBlock", v)}
              />
            </div>
          </FormSection>
        ) : null}

        <FormSection
          title="WhatsApp"
          description="Messages start in a later stage; consent is recorded now."
        >
          {text("whatsappNumber", "WhatsApp number", { inputMode: "tel" })}
          <Field label="Language">
            {(p) => (
              <Select
                {...p}
                value={f.whatsappLanguage}
                onValueChange={(v) => set("whatsappLanguage", v as FormState["whatsappLanguage"])}
                options={WHATSAPP_LANGUAGES.map((l) => ({ value: l, label: l }))}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Switch
              label="Customer agreed to receive WhatsApp messages"
              description="Recorded with today's date and your name."
              checked={f.whatsappConsent}
              onCheckedChange={(v) => set("whatsappConsent", v)}
            />
          </div>
        </FormSection>

        <FormSection title="Business size & referral">
          <Field label="Monthly capacity">
            {(p) => (
              <NumberInput
                {...p}
                decimals={0}
                suffix="m"
                value={f.monthlyCapacityM}
                onValueChange={(v) => set("monthlyCapacityM", v)}
              />
            )}
          </Field>
          <Field label="Monthly target">
            {(p) => (
              <NumberInput
                {...p}
                decimals={0}
                suffix="m"
                value={f.targetSalesM}
                onValueChange={(v) => set("targetSalesM", v)}
              />
            )}
          </Field>
          {text("referralSource", "Referral source", {
            placeholder: "Exhibition, existing customer…",
          })}
          {text("referralName", "Referred by")}
          <div className="sm:col-span-2 grid gap-3">
            <Switch
              label="Accepts cut rolls"
              description="Allows part rolls to be cut at picking for this customer."
              checked={f.allowCut}
              onCheckedChange={(v) => set("allowCut", v)}
            />
            {!isNew ? (
              <Switch label="Active" checked={f.active} onCheckedChange={(v) => set("active", v)} />
            ) : null}
          </div>
        </FormSection>
      </Card>
    </form>
  );
}
