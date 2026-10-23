import { Button, Field, TextInput } from "@erp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AuthLayout } from "../components/auth-layout.js";
import { authClient } from "../lib/auth.js";
import { keys } from "../lib/queries.js";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.me });
    await navigate({ to: redirect && redirect.startsWith("/") ? redirect : "/" });
  };

  const signIn = async () => {
    setBusy(true);
    setError(undefined);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(
        result.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Email or password is incorrect.",
      );
      return;
    }
    if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setStep("totp");
      return;
    }
    await done();
  };

  const verify = async () => {
    setBusy(true);
    setError(undefined);
    const result = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (result.error) {
      setError("That code didn't match. Codes change every 30 seconds.");
      return;
    }
    await done();
  };

  return (
    <AuthLayout
      title={step === "password" ? "Sign in" : "Two-step verification"}
      subtitle={
        step === "password"
          ? "Use the account your administrator created for you."
          : "Enter the 6-digit code from your authenticator app."
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void (step === "password" ? signIn() : verify());
        }}
      >
        {step === "password" ? (
          <>
            <Field label="Email">
              {(p) => (
                <TextInput
                  {...p}
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Password" error={error}>
              {(p) => (
                <TextInput
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : (
          <Field label="Authenticator code" error={error}>
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
        )}
        <Button
          className="w-full"
          type="submit"
          variant="primary"
          busy={busy}
          disabled={step === "totp" && code.length !== 6}
        >
          {step === "password" ? "Sign in" : "Verify"}
        </Button>
        {step === "totp" ? (
          <button
            type="button"
            className="text-left text-sm font-medium text-primary hover:underline"
            onClick={() => setStep("password")}
          >
            ← Use a different account
          </button>
        ) : null}
      </form>
    </AuthLayout>
  );
}
