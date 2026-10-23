import { Button, Field, Mono, Rule, TextInput } from "@erp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useState } from "react";
import { AuthLayout } from "../components/auth-layout.js";
import { ApiError } from "../lib/api.js";
import { authClient } from "../lib/auth.js";
import { keys, meQuery } from "../lib/queries.js";

export const Route = createFileRoute("/setup-2fa")({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
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
  const [enrolment, setEnrolment] = useState<{
    qr: string;
    secret: string;
    backupCodes: string[];
  }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(undefined);
    const result = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (result.error || !result.data || !("totpURI" in result.data)) {
      setError("Password is incorrect.");
      return;
    }
    const uri = result.data.totpURI;
    const secret = new URL(uri).searchParams.get("secret") ?? "";
    const qr = await QRCode.toDataURL(uri, {
      margin: 1,
      width: 192,
      color: { dark: "#1b2433", light: "#ffffff" },
    });
    setEnrolment({ qr, secret, backupCodes: result.data.backupCodes });
  };

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    const result = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (result.error) {
      setError("That code didn't match. Check the time on your phone and try again.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: keys.me });
    setConfirmed(true);
  };

  if (confirmed && enrolment) {
    return (
      <AuthLayout
        title="Two-step verification is on"
        subtitle="Keep these one-time backup codes somewhere safe. Each works once if you lose your phone."
      >
        <ol
          className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xs border border-rule bg-sheet p-4"
          data-testid="backup-codes"
        >
          {enrolment.backupCodes.map((c) => (
            <li key={c}>
              <Mono>{c}</Mono>
            </li>
          ))}
        </ol>
        <Button
          className="mt-6 w-full"
          variant="primary"
          onClick={() => void navigate({ to: "/" })}
        >
          Continue to the ledger
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
          <Button type="submit" variant="primary" busy={busy} disabled={!password}>
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
              className="rounded-xs border border-rule"
            />
            <div className="min-w-0 text-sm text-ink-2">
              <p>Scan with Google Authenticator, Microsoft Authenticator or 1Password.</p>
              <p className="mt-3 smallcaps">Or enter this key</p>
              <Mono className="break-all text-ink" data-testid="totp-secret">
                {enrolment.secret}
              </Mono>
            </div>
          </div>
          <Rule />
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
          <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6}>
            Turn on two-step verification
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
