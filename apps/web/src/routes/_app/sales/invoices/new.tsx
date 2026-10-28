import type { SiDetail } from "@erp/contracts";
import { istToday } from "@erp/domain";
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  FormSection,
  Mono,
  PageHeader,
  Segmented,
  Select,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { type PickedRoll, RollPicker } from "../../../../components/roll-picker.js";
import { crumbLink } from "../../../../components/sales-bits.js";
import { api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { customersQuery } from "../../../../lib/masters.js";
import { keys } from "../../../../lib/queries.js";
import {
  dcListQuery,
  dcQuery,
  metres,
  pfListQuery,
  pfQuery,
  soListQuery,
  soQuery,
} from "../../../../lib/sales.js";

const SOURCES = ["DC", "DIRECT", "PROFORMA"] as const;
export const Route = createFileRoute("/_app/sales/invoices/new")({
  validateSearch: z.object({
    source: z.enum(SOURCES).optional(),
    dcId: z.string().optional(),
    soId: z.string().optional(),
    proformaId: z.string().optional(),
  }),
  component: NewSiPage,
});

function NewSiPage() {
  const search = Route.useSearch();
  const [source, setSource] = useState<(typeof SOURCES)[number]>(search.source ?? "DC");
  const [date, setDate] = useState(istToday());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [body, setBody] = useState<Record<string, unknown> | null>(null);

  const create = useMutation({
    mutationFn: () =>
      call<SiDetail>(() => api.POST("/api/sales-invoices", { body: { ...body, date } as never })),
    onSuccess: async (si) => {
      toast({
        tone: "success",
        title: "Draft invoice ready",
        description: "Check it, then post to number it and request the IRN.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      void navigate({ to: "/sales/invoices/$siId", params: { siId: si.id } });
    },
    onError: (e) => onError(e, keys.sales),
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="New sales invoice"
        description="Bill dispatched challans, a direct sale from an order, or a proforma."
        breadcrumbs={[
          { label: "Sales" },
          { label: "Invoices", href: "/sales/invoices" },
          { label: "New" },
        ]}
        renderLink={crumbLink}
      />
      <Card
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void navigate({ to: "/sales/invoices" })}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={create.isPending}
              disabled={!body}
              onClick={() => create.mutate()}
            >
              Create draft invoice
            </Button>
          </div>
        }
      >
        <FormSection title="Invoice" description="The invoice number is given when you post it.">
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-fg">Bill from</span>
            {
              <Segmented
                label="Bill from"
                value={source}
                onValueChange={(v) => {
                  setSource(v);
                  setBody(null);
                }}
                options={[
                  { value: "DC", label: "Dispatched challans" },
                  { value: "DIRECT", label: "Direct sale (order)" },
                  { value: "PROFORMA", label: "Proforma" },
                ]}
              />
            }
          </div>
          <Field label="Invoice date" required>
            {(p) => (
              <TextInput
                {...p}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
        </FormSection>
        <div className="border-t border-border pt-5">
          {source === "DC" ? <FromChallans dcId={search.dcId} onBody={setBody} /> : null}
          {source === "DIRECT" ? <FromOrder soId={search.soId} onBody={setBody} /> : null}
          {source === "PROFORMA" ? (
            <FromProforma proformaId={search.proformaId} onBody={setBody} />
          ) : null}
        </div>
      </Card>
    </div>
  );
}

type OnBody = (body: Record<string, unknown> | null) => void;

/** Q29: one invoice may cover several open challans of one customer. */
function FromChallans({ dcId, onBody }: { dcId?: string; onBody: OnBody }) {
  const { data: preset } = useQuery({ ...dcQuery(dcId ?? ""), enabled: Boolean(dcId) });
  const { data: customers } = useQuery(customersQuery);
  const [picked, setCustomerId] = useState("");
  const customerId = picked || preset?.customerId || "";
  const [chosen, setChosen] = useState<string[]>(dcId ? [dcId] : []);
  const { data: dcs } = useQuery({
    ...dcListQuery({ customerId, status: "Open" }),
    enabled: Boolean(customerId),
  });
  const open = (dcs ?? []).filter((d) => !d.invoiced);
  useEffect(() => onBody(chosen.length ? { source: "DC", dcIds: chosen } : null), [chosen, onBody]);
  return (
    <div className="grid gap-4">
      <Field label="Customer">
        {(p) => (
          <Select
            {...p}
            value={customerId || undefined}
            onValueChange={(v) => {
              setCustomerId(v);
              setChosen([]);
            }}
            placeholder="Whose challans?"
            options={(customers ?? []).map((c) => ({ value: c.id, label: c.legalName }))}
          />
        )}
      </Field>
      {customerId && open.length === 0 ? (
        <EmptyState title="No dispatched challans waiting to be invoiced" />
      ) : null}
      <ul className="grid gap-2">
        {open.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <Checkbox
              checked={chosen.includes(d.id)}
              onCheckedChange={(on) =>
                setChosen((c) => (on ? [...c, d.id] : c.filter((x) => x !== d.id)))
              }
              label={
                <span>
                  <Mono>{d.dcNo}</Mono> · {d.date} · order <Mono className="text-xs">{d.soNo}</Mono>
                </span>
              }
            />
            <span className="tnum text-sm text-fg-2">
              {d.rollCount} rolls · {metres(d.metres)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Q22: a direct sale from a confirmed order, rolls scanned here (no challan). */
function FromOrder({ soId: preset, onBody }: { soId?: string; onBody: OnBody }) {
  const [soId, setSoId] = useState(preset ?? "");
  const { data: orders } = useQuery(soListQuery());
  const { data: so } = useQuery({ ...soQuery(soId), enabled: Boolean(soId) });
  const [picked, setPicked] = useState<PickedRoll[]>([]);
  const lines = useMemo(
    () =>
      (so?.lines ?? [])
        .filter((l) => l.balanceM > 0)
        .map((l) => ({
          id: l.id,
          label: `${l.description} · ${l.ratePerM}/m`,
          wantedM: l.balanceM,
        })),
    [so],
  );
  useEffect(
    () =>
      onBody(
        soId && picked.length
          ? {
              source: "DIRECT",
              soId,
              rolls: picked.map((p) => ({ lineId: p.lineId, rollId: p.rollId })),
            }
          : null,
      ),
    [soId, picked, onBody],
  );
  return (
    <div className="grid gap-4">
      <Field label="Order">
        {(p) => (
          <Select
            {...p}
            value={soId || undefined}
            onValueChange={(v) => {
              setSoId(v);
              setPicked([]);
            }}
            placeholder="A confirmed order"
            options={(orders ?? [])
              .filter((o) => o.status === "Confirmed" || o.status === "PartiallyFulfilled")
              .map((o) => ({ value: o.id, label: `${o.soNo} · ${o.customerName}` }))}
          />
        )}
      </Field>
      {so ? <RollPicker key={so.id} lines={lines} picked={picked} onChange={setPicked} /> : null}
    </div>
  );
}

function FromProforma({ proformaId: preset, onBody }: { proformaId?: string; onBody: OnBody }) {
  const [proformaId, setId] = useState(preset ?? "");
  const { data: list } = useQuery(pfListQuery());
  const { data: pf } = useQuery({ ...pfQuery(proformaId), enabled: Boolean(proformaId) });
  const [picked, setPicked] = useState<PickedRoll[]>([]);
  const lines = useMemo(
    () =>
      (pf?.lines ?? []).map((l) => ({
        id: l.id,
        label: `${l.description} · ${l.ratePerM}/m`,
        wantedM: l.metres,
      })),
    [pf],
  );
  useEffect(
    () =>
      onBody(
        proformaId && picked.length
          ? {
              source: "PROFORMA",
              proformaId,
              rolls: picked.map((p) => ({ lineId: p.lineId, rollId: p.rollId })),
            }
          : null,
      ),
    [proformaId, picked, onBody],
  );
  return (
    <div className="grid gap-4">
      <Field label="Proforma">
        {(p) => (
          <Select
            {...p}
            value={proformaId || undefined}
            onValueChange={(v) => {
              setId(v);
              setPicked([]);
            }}
            placeholder="A sent proforma"
            options={(list ?? [])
              .filter((x) => x.status === "Sent" || x.status === "Draft")
              .map((x) => ({ value: x.id, label: `${x.proformaNo} · ${x.customerName}` }))}
          />
        )}
      </Field>
      {pf ? <RollPicker key={pf.id} lines={lines} picked={picked} onChange={setPicked} /> : null}
    </div>
  );
}
