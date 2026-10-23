import type { ReactNode } from "react";
import { longDate } from "../lib/format.js";

/** The sign-in page as a title page: a ruled ledger cover with the form set on the right. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)]">
      <section
        aria-hidden
        className="relative hidden overflow-hidden border-r border-rule bg-wash lg:block"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0, transparent 31px, color-mix(in oklab, var(--rule) 70%, transparent) 31px, color-mix(in oklab, var(--rule) 70%, transparent) 32px)",
        }}
      >
        <div className="absolute inset-y-0 left-24 w-px bg-accent/35" />
        <div className="absolute inset-y-0 left-[100px] w-px bg-accent/20" />
        <div className="relative flex h-full flex-col justify-between py-16 pl-36 pr-16">
          <p className="smallcaps">Sublimation &amp; speciality paper · Surat</p>
          <div>
            <p className="font-serif text-[3.5rem] leading-[1.02] tracking-tight text-ink">
              Every roll,
              <br />
              every rupee,
              <br />
              <span className="italic text-accent">accounted for.</span>
            </p>
            <p className="mt-6 max-w-md font-serif text-lg italic text-ink-2">
              Purchase to dispatch to collection, kept in one ledger.
            </p>
          </div>
          <p className="font-serif text-sm italic text-ink-3">{longDate()}</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <p className="font-serif text-[1.6rem] font-medium tracking-tight text-ink">
            Ledger<span className="text-accent">·</span>
          </p>
          <h1 className="mt-10 text-xl text-ink">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-ink-2">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}
