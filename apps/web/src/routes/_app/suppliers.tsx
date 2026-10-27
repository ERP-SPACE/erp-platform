import type { SupplierItem } from "@erp/contracts";
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  Field,
  Mono,
  NumberInput,
  PageHeader,
  Segmented,
  Switch,
  TextArea,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { AddressFields, GstFields } from "../../components/master-fields.js";
import { ApiError, api, call } from "../../lib/api.js";
import { useApiErrorToast } from "../../lib/errors.js";
import {
  type AddressForm,
  flattenIssues,
  fromAddressForm,
  nullable,
  stateName,
  suppliersQuery,
  toAddressForm,
} from "../../lib/masters.js";
import { can, keys, meQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/_app/suppliers")({
  validateSearch: z.object({
    id: z.string().optional(),
    status: z.enum(["active", "inactive", "all"]).optional(),
  }),
  component: SuppliersPage,
});

const columns: ColumnDef<SupplierItem, unknown>[] = [
  {
    accessorKey: "code",
    header: "Code",
    cell: (c) => <Mono>{c.getValue() as string}</Mono>,
    meta: { width: "7rem" },
  },
  {
    accessorKey: "name",
    header: "Supplier",
    cell: (c) => (
      <div>
        <p className="font-medium text-fg">{c.row.original.name}</p>
        <p className="text-xs text-fg-3">{c.row.original.address.city}</p>
      </div>
    ),
  },
  {
    accessorKey: "shortCode",
    header: "Barcode code",
    cell: (c) => (
      <Mono className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.getValue() as string}</Mono>
    ),
  },
  {
    accessorKey: "gstin",
    header: "GSTIN",
    cell: (c) => <Mono>{(c.getValue() as string | null) ?? "—"}</Mono>,
  },
  { id: "state", header: "State", accessorFn: (s) => stateName(s.stateCode) },
  { accessorKey: "paymentDays", header: "Payment days", meta: { numeric: true } },
  {
    accessorKey: "active",
    header: "Status",
    cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
  },
];

function SuppliersPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(suppliersQuery("all"));
  const { id, status = "active" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const editable = can(me, "suppliers.manage");
  const rows = useMemo(
    () => (data ?? []).filter((s) => status === "all" || s.active === (status === "active")),
    [data, status],
  );
  const selected = id && id !== "new" ? data?.find((s) => s.id === id) : undefined;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Suppliers"
        description="Mills and traders you buy from. The 3-character code is printed in every roll barcode."
        breadcrumbs={[{ label: "Masters" }, { label: "Suppliers" }]}
        actions={
          editable ? (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => void navigate({ search: (s) => ({ ...s, id: "new" }) })}
            >
              New supplier
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Suppliers"
        data={rows}
        loading={isLoading}
        columns={columns}
        getRowId={(s) => s.id}
        selectedId={selected?.id ?? null}
        onRowClick={(s) => void navigate({ search: (p) => ({ ...p, id: s.id }), replace: true })}
        searchPlaceholder="Search name, code, GSTIN"
        toolbar={
          <Segmented
            label="Status"
            value={status}
            onValueChange={(v) =>
              void navigate({ search: (p) => ({ ...p, status: v }), replace: true })
            }
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />
      {id === "new" || selected ? (
        <SupplierDrawer
          key={selected ? `${selected.id}:${selected.version}` : "new"}
          supplier={selected}
          editable={editable}
          onClose={() => void navigate({ search: (p) => ({ ...p, id: undefined }), replace: true })}
        />
      ) : null}
    </div>
  );
}

interface FormState {
  name: string;
  shortCode: string;
  gstin: string;
  stateCode: string;
  pan: string;
  address: AddressForm;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  paymentDays: string;
  notes: string;
  active: boolean;
}

function SupplierDrawer({
  supplier,
  editable,
  onClose,
}: {
  supplier?: SupplierItem;
  editable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [f, setF] = useState<FormState>(() => ({
    name: supplier?.name ?? "",
    shortCode: supplier?.shortCode ?? "",
    gstin: supplier?.gstin ?? "",
    stateCode: supplier?.stateCode ?? "24",
    pan: supplier?.pan ?? "",
    address: toAddressForm(supplier?.address),
    contactName: supplier?.contactName ?? "",
    contactPhone: supplier?.contactPhone ?? "",
    contactEmail: supplier?.contactEmail ?? "",
    paymentDays: String(supplier?.paymentDays ?? 30),
    notes: supplier?.notes ?? "",
    active: supplier?.active ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        ...(f.shortCode.trim() && { shortCode: f.shortCode.trim().toUpperCase() }),
        gstin: nullable(f.gstin),
        stateCode: f.stateCode,
        pan: nullable(f.pan.toUpperCase()),
        address: fromAddressForm(f.address),
        contactName: nullable(f.contactName),
        contactPhone: nullable(f.contactPhone),
        contactEmail: nullable(f.contactEmail),
        paymentDays: Number(f.paymentDays || 0),
        notes: nullable(f.notes),
      };
      return supplier
        ? call<SupplierItem>(() =>
            api.PATCH("/api/suppliers/{id}", {
              params: { path: { id: supplier.id } },
              body: { ...body, active: f.active, version: supplier.version },
            }),
          )
        : call<SupplierItem>(() => api.POST("/api/suppliers", { body }));
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: supplier ? "Supplier saved" : `Supplier ${saved.code} added`,
        description: `Barcode code ${saved.shortCode}`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.suppliers });
      if (!supplier) onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      onError(error, keys.suppliers);
    },
  });

  const text = (
    key: "name" | "contactName" | "contactPhone" | "contactEmail" | "pan" | "shortCode",
    label: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Field
      label={label}
      error={errors[key]}
      required={key === "name"}
      hint={extra.hint as string | undefined}
    >
      {(p) => (
        <TextInput
          {...p}
          {...extra}
          disabled={!editable}
          value={f[key]}
          onChange={(e) => set(key, e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={supplier ? supplier.name : "New supplier"}
      description={
        supplier
          ? `${supplier.code} · barcode code ${supplier.shortCode}`
          : "The supplier code (SUP-0001…) is assigned on save."
      }
      footer={
        editable ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              {supplier ? "Save supplier" : "Add supplier"}
            </Button>
          </>
        ) : null
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="sm:col-span-2">
          {text("name", "Supplier name", { autoFocus: !supplier })}
        </div>
        {text("shortCode", "Barcode code", {
          maxLength: 3,
          className: "font-mono uppercase",
          hint: supplier
            ? "Changing it affects new barcodes only"
            : "Leave blank to derive from the name",
        })}
        <Field label="Payment terms" error={errors.paymentDays}>
          {(p) => (
            <NumberInput
              {...p}
              disabled={!editable}
              decimals={0}
              suffix="days"
              value={f.paymentDays}
              onValueChange={(v) => set("paymentDays", v)}
            />
          )}
        </Field>
        <GstFields
          gstin={f.gstin}
          stateCode={f.stateCode}
          errors={errors}
          disabled={!editable}
          onGstin={(gstin, d) =>
            setF((prev) => ({
              ...prev,
              gstin,
              ...(d && {
                stateCode: d.stateCode,
                pan: d.pan,
                address: { ...prev.address, state: prev.address.state || d.stateName },
              }),
            }))
          }
          onState={(code) => set("stateCode", code)}
        />
        {text("pan", "PAN", { maxLength: 10, className: "font-mono uppercase" })}
        <div className="sm:col-span-2 mt-2 border-t border-border pt-4 text-sm font-semibold text-fg">
          Address
        </div>
        <AddressFields
          value={f.address}
          onChange={(a) => set("address", a)}
          errors={errors}
          disabled={!editable}
        />
        <div className="sm:col-span-2 mt-2 border-t border-border pt-4 text-sm font-semibold text-fg">
          Contact
        </div>
        {text("contactName", "Contact person")}
        {text("contactPhone", "Phone", { inputMode: "tel" })}
        <div className="sm:col-span-2">{text("contactEmail", "Email", { type: "email" })}</div>
        <Field label="Notes" className="sm:col-span-2">
          {(p) => (
            <TextArea
              {...p}
              disabled={!editable}
              rows={3}
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          )}
        </Field>
        {supplier ? (
          <div className="sm:col-span-2">
            <Switch
              label="Active"
              description="Inactive suppliers can't be used on new purchase orders."
              checked={f.active}
              onCheckedChange={(v) => set("active", v)}
              disabled={!editable}
            />
          </div>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
