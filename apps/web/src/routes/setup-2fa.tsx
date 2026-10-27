import { Button, Divider, Field, Mono, TextInput } from "@erp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useState } from "react";
import { AuthLayout } from "../components/auth-layout.js";
import { ApiError } from "../lib/api.js";
import { authClient } from "../lib/auth.js";
import { keys, meQuery } from "../lib/queries.js";
import { totpVerifyErrorMessage } from "../lib/totp-errors.js";

const ENROLMENT_STORAGE_KEY = "erp:totp-enrol:v1";

type Enrolment = { qr: string; secret: string; backupCodes: string[] };

async function qrFromTotpUri(uri: string): Promise<Enrolment> {
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const qr = await QRCode.toDataURL(uri, {
    margin: 1,
    width: 192,
    color: { dark: "#101828", light: "#ffffff" },
  });
  return { qr, secret, backupCodes: [] };
}

function readStoredEnrolment(): Enrolment | undefined {
  try {
    const raw = sessionStorage.getItem(ENROLMENT_STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as Enrolment;
  } catch {
    return undefined;
  }
}

function storeEnrolment(enrolment: Enrolment) {
  sessionStorage.setItem(ENROLMENT_STORAGE_KEY, JSON.stringify(enrolment));
}

function clearStoredEnrolment() {
  sessionStorage.removeItem(ENROLMENT_STORAGE_KEY);
}

export const Route = createFileRoute("/setup-2fa")({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.fetchQuery(meQuery);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw redirect({ to: "/login" });
      throw error;
    }
  },
  component: SetupTwoFactor,
});

/** Owner TOTP enrolment (ADR-0021): password → scan QR → confirm a code → save backup codes. */
function SetupTwoFactor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  // Resume a pending enrolment from this tab (lazy initial state, not an effect).
  const [enrolment, setEnrolment] = useState<Enrolment | undefined>(() => {
    const stored = readStoredEnrolment();
    return stored?.qr && stored.secret ? stored : undefined;
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const applyEnrolment = (next: Enrolment) => {
    setEnrolment(next);
    storeEnrolment(next);
  };

  /** Resume pending setup without rotating the secret (enable always mints a new secret). */
  const start = async () => {
    setBusy(true);
    setError(undefined);
    const resume = await authClient.twoFactor.getTotpUri({ password });
    if (!resume.error && resume.data?.totpURI) {
      applyEnrolment(await qrFromTotpUri(resume.data.totpURI));
      setBusy(false);
      return;
    }
    const resumeMsg = resume.error?.message ?? "";
    const pendingOnly =
      resume.error && (resume.error.code === "TOTP_NOT_ENABLED" || /not enabled/i.test(resumeMsg));
    if (resume.error && !pendingOnly) {
      setBusy(false);
      setError("Password is incorrect.");
      return;
    }

    const result = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (result.error || !result.data || !("totpURI" in result.data)) {
      setError("Password is incorrect.");
      return;
    }
    const next = await qrFromTotpUri(result.data.totpURI);
    next.backupCodes = result.data.backupCodes;
    applyEnrolment(next);
  };

  const resetQr = async () => {
    if (!password) {
      setError("Enter your password above, then use Reset QR.");
      return;
    }
    setBusy(true);
    setError(undefined);
    clearStoredEnrolment();
    await authClient.twoFactor.disable({ password });
    const result = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (result.error || !result.data || !("totpURI" in result.data)) {
      setError("Could not reset the QR code. Check your password and try again.");
      return;
    }
    setCode("");
    const next = await qrFromTotpUri(result.data.totpURI);
    next.backupCodes = result.data.backupCodes;
    applyEnrolment(next);
  };

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    const result = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (result.error) {
      setError(totpVerifyErrorMessage(result.error));
      return;
    }
    clearStoredEnrolment();
    await queryClient.invalidateQueries({ queryKey: keys.me });
    setConfirmed(true);
  };

  if (confirmed && enrolment) {
    return (
      <AuthLayout
        title="Two-step verification is on"
        subtitle="Keep these one-time backup codes somewhere safe. Each works once if you lose your phone."
      >
        {enrolment.backupCodes.length > 0 ? (
          <ol
            className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border bg-muted p-4 text-sm"
            data-testid="backup-codes"
          >
            {enrolment.backupCodes.map((c) => (
              <li key={c}>
                <Mono>{c}</Mono>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-fg-2">
            Backup codes were shown when you first opened the QR. If you did not save them, ask an
            admin to reset your two-step setup later.
          </p>
        )}
        <Button
          className="mt-6 w-full"
          variant="primary"
          onClick={() => void navigate({ to: "/" })}
        >
          Continue to dashboard
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Secure the Owner account"
      subtitle="The Owner account controls credit overrides and every setting, so it needs a second step at sign-in."
    >
      {!enrolment ? (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <Field label="Confirm your password" error={error}>
            {(p) => (
              <TextInput
                {...p}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button
            className="w-full"
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!password || busy}
          >
            Continue
          </Button>
        </form>
      ) : (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <div className="flex items-start gap-5">
            <img
              src={enrolment.qr}
              alt="QR code for your authenticator app"
              width={128}
              height={128}
              className="rounded-lg border border-border"
            />
            <div className="min-w-0 text-sm text-fg-2">
              <p>Scan once with Google Authenticator, Microsoft Authenticator or 1Password.</p>
              <p className="mt-2 text-fg-3">
                Do not refresh this page — it can invalidate the QR your phone scanned.
              </p>
              <p className="label-caps mt-3">Or enter this key</p>
              <Mono className="break-all text-fg" data-testid="totp-secret">
                {enrolment.secret}
              </Mono>
            </div>
          </div>
          <Divider />
          <Field label="6-digit code from the app" error={error}>
            {(p) => (
              <TextInput
                {...p}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                className="tnum text-center text-lg tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          <Button
            className="w-full"
            type="submit"
            variant="primary"
            busy={busy}
            disabled={code.length !== 6 || busy}
          >
            Turn on two-step verification
          </Button>
          <Field label="Password (needed to reset QR)">
            {(p) => (
              <TextInput
                {...p}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <button
            type="button"
            className="text-left text-sm font-medium text-primary hover:underline disabled:opacity-50"
            disabled={busy || !password}
            onClick={() => void resetQr()}
          >
            Reset QR — delete the old entry in your app, then scan the new code
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
