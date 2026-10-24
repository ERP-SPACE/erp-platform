import type { SalesmanDetail, SalesmanItem } from "@erp/contracts";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Mono,
  PageHeader,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, api, call } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { flattenIssues, nullable, salesmenQuery } from "../../../lib/masters.js";
import { can, keys, meQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/salesmen/")({ component: SalesmenPage });

const BLOCK_TONE = { None: "success", All: "danger", Selective: "warning" } as const;

const columns: ColumnDef<SalesmanItem, unknown>[] = [
  {
    accessorKey: "code",
    header: "Code",
    cell: (c) => <Mono>{c.getValue() as string}</Mono>,
    meta: { width: "7rem" },
  },
  {
    accessorKey: "name",
    header: "Salesman",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  { accessorKey: "phone", header: "Phone", cell: (c) => (c.getValue() as string | null) ?? "—" },
  { accessorKey: "customerCount", header: "Customers", meta: { numeric: true } },
  {
    accessorKey: "targetSalesM",
    header: "Monthly target",
    meta: { numeric: true },
    cell: (c) => {
      const v = c.getValue() as number | null;
      return v ? `${v.toLocaleString("en-IN")} m` : "—";
    },
  },
  {
    accessorKey: "blockMode",
    header: "Blocking",
    cell: (c) => {
      const mode = c.getValue() as SalesmanItem["blockMode"];
      return (
        <Badge tone={BLOCK_TONE[mode]}>
          {mode === "None"
            ? "Not blocked"
            : mode === "All"
              ? "All customers"
              : "Selected customers"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "active",
    header: "Status",
    cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
  },
];

function SalesmenPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(salesmenQuery("all"));
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const open = (s: SalesmanItem) =>
    void navigate({ to: "/salesmen/$salesmanId", params: { salesmanId: s.id } });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Salesmen"
        description="Salesmen and brokers. Their default terms and rates pre-fill the customers they bring in."
        breadcrumbs={[{ label: "Masters" }, { label: "Salesmen" }]}
        actions={
          can(me, "salesmen.manage") ? (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New salesman
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Salesmen"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(s) => s.id}
        onRowClick={open}
        searchPlaceholder="Search salesmen"
      />
      {creating ? <NewSalesmanDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function NewSalesmanDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      call<SalesmanDetail>(() =>
        api.POST("/api/salesmen", {
          body: { name: name.trim(), phone: nullable(phone), whatsapp: nullable(phone) },
        }),
      ),
    onSuccess: async (s) => {
      toast({
        tone: "success",
        title: `${s.name} added as ${s.code}`,
        description: "Set their default terms and rates next.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.salesmen });
      void navigate({
        to: "/salesmen/$salesmanId",
        params: { salesmanId: s.id },
        search: { tab: "defaults" },
      });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      onError(error);
    },
  });
  return (
    <Dialog
      open
      width="sm"
      onOpenChange={(o) => !o && onClose()}
      title="New salesman"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length < 2}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Add salesman
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" required error={errors.name}>
          {(p) => (
            <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="Mobile / WhatsApp" error={errors.phone}>
          {(p) => (
            <TextInput
              {...p}
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
