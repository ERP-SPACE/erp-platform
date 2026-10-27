import type { TransporterItem } from "@erp/contracts";
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  Field,
  Mono,
  PageHeader,
  Switch,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { GstFields } from "../../components/master-fields.js";
import { ApiError, api, call } from "../../lib/api.js";
import { useApiErrorToast } from "../../lib/errors.js";
import { flattenIssues, nullable, stateName, transportersQuery } from "../../lib/masters.js";
import { can, keys, meQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/_app/transporters")({
  validateSearch: z.object({ id: z.string().optional() }),
  component: TransportersPage,
});

const columns: ColumnDef<TransporterItem, unknown>[] = [
  {
    accessorKey: "code",
    header: "Code",
    cell: (c) => <Mono>{c.getValue() as string}</Mono>,
    meta: { width: "6rem" },
  },
  {
    accessorKey: "name",
    header: "Transporter",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    id: "gst",
    header: "GSTIN / Transporter ID",
    accessorFn: (t) => t.gstin ?? t.transporterId ?? "",
    cell: (c) => <Mono>{(c.getValue() as string) || "—"}</Mono>,
  },
  { id: "state", header: "State", accessorFn: (t) => stateName(t.stateCode) },
  { accessorKey: "phone", header: "Phone", cell: (c) => (c.getValue() as string | null) ?? "—" },
  {
    accessorKey: "active",
    header: "Status",
    cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
  },
];

function TransportersPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(transportersQuery);
  const { id } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const editable = can(me, "transporters.manage");
  const selected = id && id !== "new" ? data?.find((t) => t.id === id) : undefined;
  const close = () => void navigate({ search: {}, replace: true });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Transporters"
        description="Carriers for dispatch. E-way bills need a GSTIN or a transporter ID."
        breadcrumbs={[{ label: "Masters" }, { label: "Transporters" }]}
        actions={
          editable ? (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => void navigate({ search: { id: "new" } })}
            >
              New transporter
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Transporters"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(t) => t.id}
        selectedId={selected?.id ?? null}
        onRowClick={(t) => void navigate({ search: { id: t.id }, replace: true })}
        searchPlaceholder="Search transporters"
      />
      {id === "new" || selected ? (
        <TransporterDrawer
          key={selected ? `${selected.id}:${selected.version}` : "new"}
          transporter={selected}
          editable={editable}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

function TransporterDrawer({
  transporter,
  editable,
  onClose,
}: {
  transporter?: TransporterItem;
  editable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [name, setName] = useState(transporter?.name ?? "");
  const [gstin, setGstin] = useState(transporter?.gstin ?? "");
  const [transporterId, setTransporterId] = useState(transporter?.transporterId ?? "");
  const [stateCode, setStateCode] = useState(transporter?.stateCode ?? "24");
  const [phone, setPhone] = useState(transporter?.phone ?? "");
  const [contactName, setContactName] = useState(transporter?.contactName ?? "");
  const [active, setActive] = useState(transporter?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        gstin: nullable(gstin),
        transporterId: nullable(transporterId.toUpperCase()),
        stateCode,
        phone: nullable(phone),
        contactName: nullable(contactName),
      };
      return transporter
        ? call<TransporterItem>(() =>
            api.PATCH("/api/transporters/{id}", {
              params: { path: { id: transporter.id } },
              body: { ...body, active, version: transporter.version },
            }),
          )
        : call<TransporterItem>(() => api.POST("/api/transporters", { body }));
    },
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: transporter ? "Transporter saved" : `Transporter ${saved.code} added`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.transporters });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      onError(error, keys.transporters);
    },
  });

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={transporter ? transporter.name : "New transporter"}
      description={transporter?.code ?? "The code (TRN-001…) is assigned on save."}
      footer={
        editable ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              {transporter ? "Save transporter" : "Add transporter"}
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
        <Field label="Name" required error={errors.name} className="sm:col-span-2">
          {(p) => (
            <TextInput
              {...p}
              autoFocus={!transporter}
              disabled={!editable}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <GstFields
          gstin={gstin}
          stateCode={stateCode}
          errors={errors}
          disabled={!editable}
          onGstin={(g, d) => {
            setGstin(g);
            if (d) setStateCode(d.stateCode);
          }}
          onState={setStateCode}
        />
        <Field
          label="Transporter ID"
          hint="For e-way bills when there is no GSTIN"
          error={errors.transporterId}
        >
          {(p) => (
            <TextInput
              {...p}
              disabled={!editable}
              maxLength={15}
              className="font-mono uppercase"
              value={transporterId}
              onChange={(e) => setTransporterId(e.target.value)}
            />
          )}
        </Field>
        <Field label="Phone" error={errors.phone}>
          {(p) => (
            <TextInput
              {...p}
              disabled={!editable}
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <Field label="Contact person" className="sm:col-span-2">
          {(p) => (
            <TextInput
              {...p}
              disabled={!editable}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          )}
        </Field>
        {transporter ? (
          <div className="sm:col-span-2">
            <Switch
              label="Active"
              checked={active}
              onCheckedChange={setActive}
              disabled={!editable}
            />
          </div>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
