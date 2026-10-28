import type { SalesReturnDetail } from "@erp/contracts";
import { istToday } from "@erp/domain";
import {
  Button,
  Card,
  Checkbox,
  Field,
  FormSection,
  Mono,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { crumbLink } from "../../../../components/sales-bits.js";
import { ApiError, api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { keys } from "../../../../lib/queries.js";
import { metres, siListQuery, siQuery } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/returns/new")({
  validateSearch: z.object({ siId: z.string().optional() }),
  component: NewReturnPage,
});

/** PRD §11.4 / ADR-0015: rolls come back whole or in part and keep their barcode. */
function NewReturnPage() {
  const search = Route.useSearch();
  const [siId, setSiId] = useState(search.siId ?? "");
  const [date, setDate] = useState(istToday());
  const [reason, setReason] = useState("");
  const [back, setBack] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: invoices } = useQuery(siListQuery({ status: "Posted" }));
  const { data: si } = useQuery({ ...siQuery(siId), enabled: Boolean(siId) });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();
  const rolls = (si?.lines ?? []).flatMap((l) =>
    l.rolls.map((r) => ({ ...r, description: l.description })),
  );
  const chosen = Object.entries(back).filter(([, m]) => Number(m) > 0);

  const save = useMutation({
    mutationFn: () =>
      call<SalesReturnDetail>(() =>
        api.POST("/api/sales-returns", {
          body: {
            siId,
            date,
            reason,
            rolls: chosen.map(([rollId, m]) => ({ rollId, returnedM: Number(m) })),
          },
        }),
      ),
    onSuccess: async (sr) => {
      toast({
        tone: "success",
        title: "Return recorded",
        description: "Post it when the rolls are in the godown.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      void navigate({ to: "/sales/returns/$srId", params: { srId: sr.id } });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      onError(e, keys.sales);
    },
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="New sales return"
        description="Choose the invoice, then how much of each roll came back. A credit note is issued when you post it."
        breadcrumbs={[
          { label: "Sales" },
          { label: "Returns", href: "/sales/returns" },
          { label: "New" },
        ]}
        renderLink={crumbLink}
      />
      <Card
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void navigate({ to: "/sales/returns" })}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={save.isPending}
              disabled={!siId || chosen.length === 0 || reason.trim().length < 3}
              onClick={() => save.mutate()}
            >
              Record return
            </Button>
          </div>
        }
      >
        <FormSection title="Return">
          <Field label="Invoice" required error={errors.siId}>
            {(p) => (
              <Select
                {...p}
                value={siId || undefined}
                onValueChange={(v) => {
                  setSiId(v);
                  setBack({});
                }}
                placeholder="Which invoice?"
                options={(invoices ?? []).map((i) => ({
                  value: i.id,
                  label: `${i.siNo} · ${i.customerName}`,
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
          <Field label="Reason" required error={errors.reason} className="sm:col-span-2">
            {(p) => (
              <TextInput
                {...p}
                value={reason}
                placeholder="e.g. Coating defect on part of the roll"
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </FormSection>
        {si ? (
          <div className="grid gap-2 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Rolls on {si.siNo}</h3>
            {errors.rolls ? <p className="text-sm text-danger">{errors.rolls}</p> : null}
            {rolls.map((r) => {
              const on = back[r.rollId] !== undefined;
              return (
                <div
                  key={r.rollId}
                  className="grid items-center gap-3 rounded-md border border-border px-3 py-2 sm:grid-cols-[1fr_160px]"
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) =>
                      setBack((b) => {
                        const next = { ...b };
                        if (v) next[r.rollId] = String(r.lengthM);
                        else delete next[r.rollId];
                        return next;
                      })
                    }
                    label={
                      <span>
                        <Mono>{r.barcode}</Mono> · {r.description} · sent {metres(r.lengthM)}
                      </span>
                    }
                  />
                  {on ? (
                    <NumberInput
                      aria-label={`Metres returned of ${r.barcode}`}
                      value={back[r.rollId]!}
                      onValueChange={(v) => setBack((b) => ({ ...b, [r.rollId]: v }))}
                      decimals={0}
                      suffix="m back"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
