import type { PurchaseReturnDetail } from "@erp/contracts";
import { istToday } from "@erp/domain";
import {
  Button,
  Card,
  Field,
  FormSection,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { RollTable } from "../../../../components/roll-table.js";
import { ApiError, api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { nullable, suppliersQuery } from "../../../../lib/masters.js";
import { rollsQuery } from "../../../../lib/purchase.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/returns/new")({ component: NewReturnPage });

function NewReturnPage() {
  const { data: me } = useQuery(meQuery);
  const { data: suppliers } = useQuery(suppliersQuery("true"));
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(istToday());
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [rollIds, setRollIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rolls = useQuery({
    ...rollsQuery({ supplierId, inStock: "true" }),
    enabled: Boolean(supplierId),
  });
  const returnable = (rolls.data?.items ?? []).filter((r) => r.status !== "Allocated");
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate();
  const save = useMutation({
    mutationFn: () =>
      call<PurchaseReturnDetail>(() =>
        api.POST("/api/purchase-returns", {
          body: { supplierId, date, reason: reason.trim(), rollIds, notes: nullable(notes) },
        }),
      ),
    onSuccess: async (saved) => {
      toast({
        tone: "success",
        title: "Return saved as draft",
        description: "Post it to issue the debit note.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.purchase });
      void navigate({ to: "/purchase/returns/$prId", params: { prId: saved.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      onError(error);
    },
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="New purchase return"
        description="Whole rolls go back at the rate they were invoiced at."
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Returns", href: "/purchase/returns" },
          { label: "New" },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
      />
      <Card
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-2">{rollIds.length} rolls selected</p>
            <Button
              variant="primary"
              busy={save.isPending}
              disabled={!supplierId || !rollIds.length || reason.trim().length < 3}
              onClick={() => save.mutate()}
            >
              Save draft
            </Button>
          </div>
        }
      >
        <FormSection title="Return">
          <Field label="Supplier" required>
            {(p) => (
              <Select
                {...p}
                value={supplierId || undefined}
                onValueChange={(v) => {
                  setSupplierId(v);
                  setRollIds([]);
                }}
                placeholder="Choose a supplier"
                options={(suppliers ?? []).map((s) => ({
                  value: s.id,
                  label: `${s.name} · ${s.code}`,
                }))}
              />
            )}
          </Field>
          <Field label="Date" required>
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Reason"
            required
            className="sm:col-span-2"
            error={errors.reason}
            hint="Printed on the debit note"
          >
            {(p) => (
              <TextInput
                {...p}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Coating defect on outer layers"
              />
            )}
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            {(p) => (
              <TextArea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </FormSection>
        {errors.rollIds ? <p className="text-sm text-danger">{errors.rollIds}</p> : null}
      </Card>
      {supplierId ? (
        <Card
          title="Rolls in stock from this supplier"
          description="Only invoiced rolls can be returned."
          padded={false}
        >
          <RollTable
            caption="Returnable rolls"
            rolls={returnable}
            loading={rolls.isLoading}
            selectable
            onSelectionChange={setRollIds}
            showCost={can(me, "inventory.view_cost")}
          />
        </Card>
      ) : null}
    </div>
  );
}
