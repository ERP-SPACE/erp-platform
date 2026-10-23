import { Button, Dialog, Field, TextInput } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ApiError, api, call, registerStepUpHandler } from "../lib/api.js";
import { meQuery } from "../lib/queries.js";

/**
 * Re-confirmation for sensitive actions (ADR-0021). Any API call that returns STEP_UP_REQUIRED
 * opens this dialog; on success the original call is retried automatically.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const me = useQuery({ ...meQuery, enabled: false });
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const needsCode = Boolean(me.data?.user.twoFactorEnabled);

  useEffect(() => {
    registerStepUpHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setPassword("");
          setCode("");
          setError(undefined);
          setOpen(true);
        }),
    );
    return () => registerStepUpHandler(null);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await call(() =>
        api.POST("/api/identity/step-up", { body: { password, ...(needsCode && { code }) } }),
      );
      finish(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : "Could not confirm. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : finish(false))}
        title="Confirm it's you"
        description="This change is sensitive. Re-enter your password to continue — you won't be asked again for five minutes."
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={!password || (needsCode && code.length !== 6)}
              onClick={submit}
            >
              Confirm
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Password" error={error}>
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
          {needsCode ? (
            <Field label="Authenticator code">
              {(p) => (
                <TextInput
                  {...p}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="tnum tracking-[0.3em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              )}
            </Field>
          ) : null}
          <button type="submit" hidden />
        </form>
      </Dialog>
    </>
  );
}
