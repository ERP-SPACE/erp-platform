import type { DcCutResult, DcDetail } from "@erp/contracts";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  Mono,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Scissors, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import { ScanInput } from "../../../../components/scan-input.js";
import { DocTitle, PdfButton, crumbLink } from "../../../../components/sales-bits.js";
import { ApiError, api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { nullable, transportersQuery } from "../../../../lib/masters.js";
import { printLabels } from "../../../../lib/purchase.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import {
  DC_TONE,
  allocationQuery,
  dcQuery,
  docAction,
  metres,
  rupees,
} from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/challans/$dcId")({ component: DcPage });

type PickedRoll = DcDetail["rolls"][number];

function DcPage() {
  const { dcId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: dc } = useQuery(dcQuery(dcId));
  const [chosenLine, setLineId] = useState<string>("");
  const [confirm, setConfirm] = useState<"post" | "cancel" | null>(null);
  const [cut, setCut] = useState<{
    rollId: string;
    barcode: string;
    lengthM: number;
    cutM: number;
  } | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const draft = dc?.status === "Draft";
  const allocation = useQuery({
    ...allocationQuery(dc?.soId ?? ""),
    enabled: Boolean(dc && draft),
  });

  // Pick for the line the user chose, else the first one still short.
  const lineId =
    dc && dc.lines.some((l) => l.soLineId === chosenLine)
      ? chosenLine
      : ((dc?.lines.find((l) => l.balanceM > 0) ?? dc?.lines[0])?.soLineId ?? "");

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.sales }),
      queryClient.invalidateQueries({ queryKey: keys.inventory }),
    ]);
  const pick = useMutation({
    mutationFn: (by: { rollId?: string; barcode?: string }) =>
      call<DcDetail>(() =>
        api.POST("/api/delivery-challans/{id}/pick", {
          params: { path: { id: dcId } },
          body: { soLineId: lineId, ...by },
        }),
      ),
    onSuccess: async (_d, by) => {
      toast({ tone: "success", title: `Picked ${by.barcode ?? "roll"}` });
      await refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) toast({ tone: "danger", title: e.problem.title });
      else onError(e);
    },
  });
  const unpick = useMutation({
    mutationFn: (rollId: string) =>
      call<DcDetail>(() =>
        api.POST("/api/delivery-challans/{id}/unpick", {
          params: { path: { id: dcId } },
          body: { rollId },
        }),
      ),
    onSuccess: refresh,
    onError: (e) => onError(e, keys.sales),
  });
  const doCut = useMutation({
    mutationFn: (v: { rollId: string; cutM: number; wasteM: number }) =>
      call<DcCutResult>(() =>
        api.POST("/api/delivery-challans/{id}/cut", {
          params: { path: { id: dcId } },
          body: { soLineId: lineId, ...v },
        }),
      ),
    onSuccess: async (r) => {
      setCut(null);
      toast({
        tone: "success",
        title: `Cut ${r.child.lengthM} m → ${r.child.barcode}`,
        description: `${r.parent.barcode} now has ${r.parent.lengthM} m. Print both labels.`,
        action: {
          label: "Print labels",
          onClick: () =>
            void printLabels({ rollIds: r.labelRollIds, reprint: true }, "Roll cut at picking"),
        },
      });
      await refresh();
    },
    onError: (e) => onError(e, keys.sales),
  });
  const act = useMutation({
    mutationFn: (a: "post" | "cancel") =>
      docAction<DcDetail>(`/api/delivery-challans/{id}/${a}`, dcId, { version: dc!.version }),
    onSuccess: async (saved) => {
      setConfirm(null);
      toast({
        tone: "success",
        title: saved.status === "Open" ? `${saved.dcNo} dispatched` : "Challan cancelled",
        description: saved.status === "Open" ? "It is ready to invoice." : undefined,
      });
      await refresh();
    },
    onError: (e) => onError(e, keys.sales),
  });

  if (!dc) return null;
  const manage = can(me, "sales.dispatch.manage") && draft;
  const line = dc.lines.find((l) => l.soLineId === lineId);
  const suggestion = allocation.data?.lines.find((l) => l.soLineId === lineId);
  const pickedIds = new Set(dc.rolls.map((r) => r.rollId));
  const short = dc.lines.some((l) => l.balanceM > 0);

  const rollColumns: ColumnDef<PickedRoll, unknown>[] = [
    {
      accessorKey: "barcode",
      header: "Roll",
      cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
    },
    { accessorKey: "description", header: "Product" },
    {
      accessorKey: "lengthM",
      header: "Length",
      meta: { numeric: true },
      cell: (c) => metres(c.getValue() as number),
    },
    {
      accessorKey: "cutFromBarcode",
      header: "Cut from",
      cell: (c) => (c.getValue() ? <Mono className="text-xs">{c.getValue() as string}</Mono> : "—"),
    },
    ...(manage
      ? [
          {
            id: "unpick",
            header: "",
            cell: (c: { row: { original: PickedRoll } }) => (
              <Button
                variant="ghost"
                size="sm"
                icon={Undo2}
                busy={unpick.isPending && unpick.variables === c.row.original.rollId}
                onClick={(e) => {
                  e.stopPropagation();
                  unpick.mutate(c.row.original.rollId);
                }}
              >
                Unpick
              </Button>
            ),
          } as ColumnDef<PickedRoll, unknown>,
        ]
      : []),
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <DocTitle
            number={dc.dcNo}
            draftLabel="Challan"
            status={dc.status === "Open" ? "Dispatched" : dc.status}
            tone={DC_TONE[dc.status]}
          />
        }
        description={
          <>
            {dc.customerName} · order{" "}
            <Link
              to="/sales/orders/$soId"
              params={{ soId: dc.soId }}
              className="text-primary hover:underline"
            >
              <Mono>{dc.soNo}</Mono>
            </Link>{" "}
            · {dc.date}
          </>
        }
        breadcrumbs={[
          { label: "Sales" },
          { label: "Challans", href: "/sales/challans" },
          { label: dc.dcNo },
        ]}
        renderLink={crumbLink}
        actions={
          <>
            <PdfButton kind="delivery-challans" id={dc.id} label="Challan PDF" />
            {manage ? (
              <>
                <Button variant="secondary" icon={XCircle} onClick={() => setConfirm("cancel")}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  disabled={dc.rolls.length === 0}
                  onClick={() => setConfirm("post")}
                >
                  Dispatch
                </Button>
              </>
            ) : null}
            {dc.status === "Open" && !dc.invoiced && can(me, "sales.invoice.manage") ? (
              <Button asChild variant="primary">
                <Link to="/sales/invoices/new" search={{ source: "DC", dcId: dc.id }}>
                  Invoice this challan
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-6">
          <Card title="Lines" padded={false}>
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-2">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Ordered</th>
                  <th className="px-4 py-2 text-right font-medium">Picked</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {dc.lines.map((l) => (
                  <tr key={l.soLineId} className="border-t border-border">
                    <td className="px-4 py-2">
                      {l.description}
                      {l.allowCut ? null : (
                        <Badge tone="neutral" className="ml-2">
                          No cutting
                        </Badge>
                      )}
                    </td>
                    <td className="tnum px-4 py-2 text-right">{metres(l.orderedM)}</td>
                    <td className="tnum px-4 py-2 text-right">{metres(l.pickedM)}</td>
                    <td
                      className={`tnum px-4 py-2 text-right font-medium ${l.balanceM > 0 ? "text-warning" : "text-success"}`}
                    >
                      {l.balanceM > 0 ? metres(l.balanceM) : "Done"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title={`Picked rolls · ${dc.rolls.length}`} padded={false}>
            <DataTable
              caption="Picked rolls"
              data={dc.rolls}
              columns={rollColumns}
              getRowId={(r) => r.rollId}
              pageSize={false}
              empty="Scan a roll or pick a suggestion to start."
            />
          </Card>
        </div>
        <div className="grid content-start gap-6">
          {manage ? (
            <Card title="Pick">
              <div className="grid gap-4">
                {dc.lines.length > 1 ? (
                  <Field label="Picking for">
                    {(p) => (
                      <Select
                        {...p}
                        value={lineId || undefined}
                        onValueChange={setLineId}
                        options={dc.lines.map((l) => ({
                          value: l.soLineId,
                          label: `${l.description} · ${l.balanceM > 0 ? `${metres(l.balanceM)} to go` : "done"}`,
                        }))}
                      />
                    )}
                  </Field>
                ) : null}
                <ScanInput label="Scan a roll" onScan={(barcode) => pick.mutate({ barcode })} />
                {suggestion && line && line.balanceM > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-fg-2">
                      Suggested (oldest first)
                    </p>
                    {suggestion.rolls
                      .filter((r) => !pickedIds.has(r.rollId))
                      .map((r) => (
                        <div
                          key={r.rollId}
                          className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                        >
                          <span className="grid">
                            <Mono className="text-xs">{r.barcode}</Mono>
                            <span className="text-xs text-fg-3">
                              {metres(r.lengthM)} · {r.ageDays} days in stock
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="secondary"
                            busy={pick.isPending && pick.variables?.rollId === r.rollId}
                            onClick={() => pick.mutate({ rollId: r.rollId })}
                          >
                            Pick
                          </Button>
                        </div>
                      ))}
                    {suggestion.cut && can(me, "inventory.roll.cut") ? (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
                        <span className="grid text-xs">
                          <Mono>{suggestion.cut.barcode}</Mono>
                          <span className="text-warning">
                            Cut {metres(suggestion.cut.cutM)}, leaves{" "}
                            {metres(suggestion.cut.leftoverM)}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Scissors}
                          onClick={() =>
                            setCut({
                              rollId: suggestion.cut!.rollId,
                              barcode: suggestion.cut!.barcode,
                              lengthM: suggestion.cut!.cutM + suggestion.cut!.leftoverM,
                              cutM: suggestion.cut!.cutM,
                            })
                          }
                        >
                          Cut
                        </Button>
                      </div>
                    ) : null}
                    {suggestion.status === "NO_INVENTORY" ? (
                      <p className="text-sm text-danger">No stock for this line.</p>
                    ) : null}
                  </div>
                ) : null}
                {!short ? (
                  <p className="text-sm text-success">Every line is fully picked.</p>
                ) : null}
              </div>
            </Card>
          ) : null}
          <TransportCard
            dc={dc}
            editable={can(me, "sales.dispatch.manage") && dc.status !== "Cancelled"}
          />
          <Card>
            <p className="flex items-center justify-between text-sm">
              <span className="text-fg-2">Goods value</span>
              <span className="tnum font-medium">{rupees(dc.value)}</span>
            </p>
            {dc.ewayBillRequired ? (
              <p className="mt-2 text-sm text-warning">
                Above the e-way bill threshold: generate it from the invoice's IRN, or enter it
                below.
              </p>
            ) : null}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "post" ? "Dispatch this challan?" : "Cancel this challan?"}
        description={
          confirm === "post"
            ? `${dc.rolls.length} rolls (${metres(dc.rolls.reduce((s, r) => s + r.lengthM, 0))}) leave the godown.${short ? " Some lines are short; the balance stays on the order." : ""}`
            : "Picked rolls go back to stock."
        }
        confirmLabel={confirm === "post" ? "Dispatch" : "Cancel challan"}
        tone={confirm === "cancel" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
      {cut ? (
        <CutDialog
          cut={cut}
          busy={doCut.isPending}
          onClose={() => setCut(null)}
          onCut={(v) => doCut.mutate({ rollId: cut.rollId, ...v })}
        />
      ) : null}
    </div>
  );
}

function CutDialog({
  cut,
  busy,
  onClose,
  onCut,
}: {
  cut: { barcode: string; lengthM: number; cutM: number };
  busy: boolean;
  onClose: () => void;
  onCut: (v: { cutM: number; wasteM: number }) => void;
}) {
  const [cutM, setCutM] = useState(String(cut.cutM));
  const [wasteM, setWasteM] = useState("0");
  const left = cut.lengthM - Number(cutM || 0) - Number(wasteM || 0);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cut ${cut.barcode}`}
      description="The cut piece gets a new barcode and is picked; the roll keeps its barcode, shorter, and needs a new label."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            icon={Scissors}
            busy={busy}
            disabled={left < 0 || !Number(cutM)}
            onClick={() => onCut({ cutM: Number(cutM), wasteM: Number(wasteM || 0) })}
          >
            Cut and pick
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cut length" required>
          {(p) => (
            <NumberInput {...p} value={cutM} onValueChange={setCutM} decimals={0} suffix="m" />
          )}
        </Field>
        <Field label="Waste" hint="Damaged end trimmed off">
          {(p) => (
            <NumberInput {...p} value={wasteM} onValueChange={setWasteM} decimals={0} suffix="m" />
          )}
        </Field>
        <p className={`text-sm sm:col-span-2 ${left < 0 ? "text-danger" : "text-fg-2"}`}>
          {left < 0 ? "More than the roll holds." : `${metres(left)} stays on ${cut.barcode}.`}
        </p>
      </div>
    </Dialog>
  );
}

/** Transport details and the e-way bill entered by hand (generation from the IRN is on the invoice). */
function TransportCard({ dc, editable }: { dc: DcDetail; editable: boolean }) {
  const { data: transporters } = useQuery(transportersQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [f, setF] = useState({
    transporterId: dc.transporterId ?? "",
    vehicleNo: dc.vehicleNo ?? "",
    lrNo: dc.lrNo ?? "",
    lrDate: dc.lrDate ?? "",
    distanceKm: dc.distanceKm === null || dc.distanceKm === undefined ? "" : String(dc.distanceKm),
    ewayBillNo: dc.ewayBillNo ?? "",
    ewayBillDate: dc.ewayBillDate ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      call<DcDetail>(() =>
        api.PATCH("/api/delivery-challans/{id}", {
          params: { path: { id: dc.id } },
          body: {
            date: dc.date,
            notes: dc.notes,
            version: dc.version,
            transporterId: f.transporterId || null,
            vehicleNo: nullable(f.vehicleNo),
            lrNo: nullable(f.lrNo),
            lrDate: f.lrDate || null,
            distanceKm: f.distanceKm ? Number(f.distanceKm) : null,
            ewayBillNo: nullable(f.ewayBillNo),
            ewayBillDate: f.ewayBillDate || null,
          },
        }),
      ),
    onSuccess: async () => {
      setErrors({});
      toast({ tone: "success", title: "Transport details saved" });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      onError(e, keys.sales);
    },
  });
  return (
    <Card
      title="Transport"
      footer={
        editable ? (
          <div className="flex justify-end">
            <Button variant="secondary" busy={save.isPending} onClick={() => save.mutate()}>
              Save transport
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Transporter" className="sm:col-span-2">
          {(p) => (
            <Select
              {...p}
              disabled={!editable}
              value={f.transporterId || undefined}
              onValueChange={set("transporterId")}
              placeholder="Own vehicle / none"
              options={(transporters ?? []).map((t) => ({ value: t.id, label: t.name }))}
            />
          )}
        </Field>
        <Field label="Vehicle no." error={errors.vehicleNo}>
          {(p) => (
            <TextInput
              {...p}
              disabled={!editable}
              value={f.vehicleNo}
              placeholder="GJ05AB1234"
              onChange={(e) => set("vehicleNo")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Distance" error={errors.distanceKm}>
          {(p) => (
            <NumberInput
              {...p}
              disabled={!editable}
              value={f.distanceKm}
              onValueChange={set("distanceKm")}
              decimals={0}
              suffix="km"
            />
          )}
        </Field>
        <Field label="LR no.">
          {(p) => (
            <TextInput
              {...p}
              disabled={!editable}
              value={f.lrNo}
              onChange={(e) => set("lrNo")(e.target.value)}
            />
          )}
        </Field>
        <Field label="LR date">
          {(p) => (
            <TextInput
              {...p}
              type="date"
              disabled={!editable}
              value={f.lrDate}
              onChange={(e) => set("lrDate")(e.target.value)}
            />
          )}
        </Field>
        <Field label="E-way bill no." error={errors.ewayBillNo}>
          {(p) => (
            <TextInput
              {...p}
              disabled={!editable}
              inputMode="numeric"
              value={f.ewayBillNo}
              onChange={(e) => set("ewayBillNo")(e.target.value)}
            />
          )}
        </Field>
        <Field label="E-way bill date">
          {(p) => (
            <TextInput
              {...p}
              type="date"
              disabled={!editable}
              value={f.ewayBillDate}
              onChange={(e) => set("ewayBillDate")(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Card>
  );
}
