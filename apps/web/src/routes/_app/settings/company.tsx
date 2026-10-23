import type { CompanyResponse } from "@erp/contracts";
import { GST_STATES, validateGstin } from "@erp/domain";
import {
  Button,
  Field,
  MarginNote,
  Select,
  Sheet,
  SheetLayout,
  StatusMark,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ReasonField } from "../../../components/reason-field.js";
import { ApiError, api, call, reasonHeader } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { dateTime } from "../../../lib/format.js";
import { can, companyQuery, keys, meQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/settings/company")({ component: CompanyPage });

interface FormState {
  legalName: string;
  tradeName: string;
  gstin: string;
  stateCode: string;
  pan: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  email: string;
  phone: string;
  signatoryName: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
}

const toForm = (c: CompanyResponse): FormState => ({
  legalName: c.legalName,
  tradeName: c.tradeName ?? "",
  gstin: c.gstin ?? "",
  stateCode: c.stateCode,
  pan: c.pan ?? "",
  line1: c.address.line1,
  line2: c.address.line2 ?? "",
  city: c.address.city,
  state: c.address.state,
  pincode: c.address.pincode,
  email: c.email ?? "",
  phone: c.phone ?? "",
  signatoryName: c.signatoryName ?? "",
  bankName: c.bank?.bankName ?? "",
  accountName: c.bank?.accountName ?? "",
  accountNumber: c.bank?.accountNumber ?? "",
  ifsc: c.bank?.ifsc ?? "",
  branch: c.bank?.branch ?? "",
});

const nullable = (v: string) => (v.trim() ? v.trim() : null);
const STATE_OPTIONS = Object.entries(GST_STATES).map(([code, name]) => ({
  value: code,
  label: `${code} · ${name}`,
}));

function CompanyPage() {
  const { data: company } = useQuery(companyQuery);
  if (!company) return null;
  // Keyed by version: a save (or someone else's change) re-initialises the form from the server.
  return <CompanyForm key={company.version} company={company} />;
}

function CompanyForm({ company }: { company: CompanyResponse }) {
  const { data: me } = useQuery(meQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [form, setForm] = useState<FormState>(() => toForm(company));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = can(me, "settings.company.update");

  const save = useMutation({
    mutationFn: (f: FormState) =>
      call(() =>
        api.PATCH("/api/company", {
          headers: reasonHeader(reason),
          body: {
            legalName: f.legalName,
            tradeName: nullable(f.tradeName),
            gstin: nullable(f.gstin.toUpperCase()),
            stateCode: f.stateCode,
            pan: nullable(f.pan.toUpperCase()),
            address: {
              line1: f.line1,
              ...(f.line2.trim() && { line2: f.line2 }),
              city: f.city,
              state: f.state,
              pincode: f.pincode,
            },
            bank: f.bankName.trim()
              ? {
                  bankName: f.bankName,
                  accountName: f.accountName,
                  accountNumber: f.accountNumber,
                  ifsc: f.ifsc.toUpperCase(),
                  ...(f.branch.trim() && { branch: f.branch }),
                }
              : null,
            email: nullable(f.email),
            phone: nullable(f.phone),
            signatoryName: nullable(f.signatoryName),
            version: company.version,
          },
        }),
      ),
    onSuccess: async () => {
      setErrors({});
      setReason("");
      toast({ tone: "positive", title: "Company profile saved" });
      await queryClient.invalidateQueries({ queryKey: keys.company });
      await queryClient.invalidateQueries({ queryKey: keys.me });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.problem.issues?.length)
        setErrors(flatten(error.fieldErrors()));
      onError(error, keys.company);
    },
  });

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  const gst = form.gstin.trim() ? validateGstin(form.gstin) : null;
  const text = (key: keyof FormState, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} error={errors[key]}>
      {(p) => (
        <TextInput {...p} {...props} disabled={!editable} value={form[key]} onChange={set(key)} />
      )}
    </Field>
  );

  return (
    <SheetLayout
      sheet={
        <Sheet
          kicker="Company GST profile"
          title={form.legalName || "Company"}
          meta={
            form.tradeName ? (
              <span className="font-serif italic">trading as {form.tradeName}</span>
            ) : null
          }
          status={
            company.isPlaceholder ? (
              <StatusMark tone="caution">Placeholder</StatusMark>
            ) : (
              <StatusMark tone="positive">On file</StatusMark>
            )
          }
          footer={
            editable ? (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <ReasonField value={reason} onChange={setReason} />
                <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(form)}>
                  Save profile
                </Button>
              </div>
            ) : null
          }
        >
          <form className="grid gap-8" onSubmit={(e) => e.preventDefault()}>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="smallcaps mb-3">Identity</legend>
              {text("legalName", "Legal name", { required: true })}
              {text("tradeName", "Trade name")}
              <Field
                label="GSTIN"
                error={errors.gstin ?? (gst && !gst.valid ? gst.error : undefined)}
                hint={
                  gst?.valid
                    ? `${GST_STATES[gst.stateCode!]} · PAN ${gst.pan}`
                    : "15 characters, e.g. 24ABCDE1234F1Z5"
                }
              >
                {(p) => (
                  <TextInput
                    {...p}
                    disabled={!editable}
                    maxLength={15}
                    className="font-mono uppercase tracking-wide"
                    value={form.gstin}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase();
                      const check = validateGstin(value);
                      setForm({
                        ...form,
                        gstin: value,
                        ...(check.valid && { stateCode: check.stateCode!, pan: check.pan! }),
                      });
                    }}
                  />
                )}
              </Field>
              <Field label="GST state" error={errors.stateCode}>
                {(p) => (
                  <Select
                    {...p}
                    disabled={!editable}
                    value={form.stateCode}
                    onValueChange={(v) => setForm({ ...form, stateCode: v })}
                    options={STATE_OPTIONS}
                  />
                )}
              </Field>
              {text("pan", "PAN", { maxLength: 10, className: "font-mono uppercase" })}
              {text("signatoryName", "Authorised signatory")}
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="smallcaps mb-3">Registered address</legend>
              <div className="sm:col-span-2">
                {text("line1", "Address line 1", { required: true })}
              </div>
              <div className="sm:col-span-2">{text("line2", "Address line 2")}</div>
              {text("city", "City")}
              {text("state", "State")}
              {text("pincode", "PIN code", {
                inputMode: "numeric",
                maxLength: 6,
                className: "tnum",
              })}
              {text("phone", "Phone", { inputMode: "tel" })}
              <div className="sm:col-span-2">
                {text("email", "Email for invoices", { type: "email" })}
              </div>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="smallcaps mb-3">Bank details printed on invoices</legend>
              {text("bankName", "Bank")}
              {text("branch", "Branch")}
              {text("accountName", "Account name")}
              {text("accountNumber", "Account number", { inputMode: "numeric", className: "tnum" })}
              {text("ifsc", "IFSC", { maxLength: 11, className: "font-mono uppercase" })}
            </fieldset>
          </form>
        </Sheet>
      }
      margin={
        <>
          <MarginNote title="Why it matters">
            The GSTIN's state code decides whether an invoice charges CGST + SGST (same state) or
            IGST. Every document prints these details.
          </MarginNote>
          <MarginNote title="Last changed">
            <span className="tnum">{dateTime(company.updatedAt)}</span>
            {can(me, "audit.view") ? (
              <Link
                to="/settings/audit"
                search={{ table: "companies" }}
                className="mt-1 block text-accent hover:underline"
              >
                See history →
              </Link>
            ) : null}
          </MarginNote>
        </>
      }
    />
  );
}

/** Server paths like "address.pincode" / "bank.ifsc" map to the flat form keys. */
function flatten(errors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors).map(([path, message]) => [path.split(".").at(-1)!, message]),
  );
}
