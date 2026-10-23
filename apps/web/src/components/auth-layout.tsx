import { Barcode, ShieldCheck, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "./brand.js";

const HIGHLIGHTS = [
  {
    icon: Barcode,
    title: "Roll-level traceability",
    text: "Every roll barcoded from inward to dispatch.",
  },
  {
    icon: ShieldCheck,
    title: "Credit control",
    text: "Exposure checked live; overdue accounts held automatically.",
  },
  {
    icon: TrendingUp,
    title: "GST-ready billing",
    text: "E-invoices, e-way bills and clean books from day one.",
  },
];

/** Sign-in layout: brand panel on the left (wide screens), form card on the right. */
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
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(480px,1fr)]">
      <section
        aria-hidden
        className="relative hidden overflow-hidden bg-[linear-gradient(145deg,#0f2a7a_0%,#1f4fd8_55%,#3b6cf0_100%)] text-white lg:flex lg:flex-col lg:justify-between lg:p-12"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <BrandMark inverted />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Run purchasing, stock, sales and collections in one place.
          </h2>
          <ul className="mt-10 grid gap-6">
            {HIGHLIGHTS.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-white/80">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">Sublimation & speciality paper · Surat</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <div className="rounded-xl border border-border bg-surface p-8 shadow-card">
            <h1 className="text-xl font-semibold text-fg">{title}</h1>
            {subtitle ? <p className="mt-1.5 text-sm text-fg-2">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
