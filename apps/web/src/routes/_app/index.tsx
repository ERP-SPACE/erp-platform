import { fyLabel, istToday } from "@erp/domain";
import { EmptyState, Mono, PageTitle, Rule, StatusMark } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { clock, greeting, longDate } from "../../lib/format.js";
import { can, meQuery, seriesQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/_app/")({ component: TodayPage });

interface NeedsYou {
  id: string;
  title: string;
  why: string;
  to: string;
  cta: string;
}

/** "Today" — a written morning brief and a worklist, instead of a dashboard of tiles (brief B4.1). */
function TodayPage() {
  const { data: me } = useQuery(meQuery);
  const series = useQuery({ ...seriesQuery, enabled: can(me, "settings.series.view") });
  if (!me) return null;

  const firstName = me.user.name.split(" ")[0];
  const company = me.company.tradeName || me.company.legalName;
  const nextInvoice = series.data?.find((s) => s.entityType === "SI")?.nextNumber;

  const needs: NeedsYou[] = [];
  if (me.company.isPlaceholder && can(me, "settings.company.update")) {
    needs.push({
      id: "company",
      title: "Complete the company GST profile",
      why: "Legal name, GSTIN, address and bank details print on every invoice and decide CGST/SGST vs IGST.",
      to: "/settings/company",
      cta: "Open profile",
    });
  }
  if (!me.user.twoFactorEnabled) {
    needs.push({
      id: "2fa",
      title: "Turn on two-step verification",
      why: "A code from your phone at sign-in keeps your account safe even if your password leaks.",
      to: "/setup-2fa",
      cta: "Set up",
    });
  }
  if (can(me, "settings.series.update")) {
    needs.push({
      id: "series",
      title: "Review document numbering before the first invoice",
      why: "Invoice numbers must run without gaps for the whole financial year; formats are easiest to change before anything is posted.",
      to: "/settings/series",
      cta: "Review series",
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-10">
      <PageTitle
        eyebrow={`${greeting()}, ${firstName}`}
        title="Today"
        dateline={`${longDate()} · as of ${clock()}`}
      />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-10">
          <p className="max-w-[62ch] font-serif text-[1.35rem] leading-relaxed text-ink">
            The ledger for <span className="italic">{company}</span> is open for financial year{" "}
            {fyLabel(istToday())}. Its foundations are in place: gapless numbering, settings and a
            complete audit trail. Parties and the catalogue come next, then purchasing, stock and
            sales.
          </p>

          <section aria-labelledby="needs-you">
            <div className="flex items-baseline justify-between border-b border-rule-strong pb-2">
              <h2 id="needs-you" className="text-lg">
                Needs you
              </h2>
              <span className="tnum text-xs text-ink-3">
                {needs.length ? `${needs.length} open` : "clear"}
              </span>
            </div>
            {needs.length ? (
              <ol>
                {needs.map((item, index) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-rule py-4"
                  >
                    <span className="tnum font-serif text-sm italic text-ink-3">{index + 1}.</span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 text-sm text-ink-2">{item.why}</p>
                    </div>
                    <Link
                      to={item.to}
                      className="whitespace-nowrap text-sm font-medium text-accent underline-offset-4 hover:underline"
                    >
                      {item.cta} →
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="Nothing needs you right now."
                hint="Approvals, credit blocks and unmapped rolls will collect here once trading begins."
              />
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section className="border-l border-rule-strong pl-4">
            <h3 className="smallcaps mb-3 font-sans">In this ledger</h3>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-ink-3">Financial year</dt>
                <dd className="tnum text-ink">{fyLabel(istToday())}</dd>
              </div>
              {nextInvoice ? (
                <div>
                  <dt className="text-ink-3">Next sales invoice</dt>
                  <dd>
                    <Mono className="text-ink">{nextInvoice}</Mono>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-ink-3">Company profile</dt>
                <dd>
                  {me.company.isPlaceholder ? (
                    <StatusMark tone="caution">Placeholder details</StatusMark>
                  ) : (
                    <StatusMark tone="positive">Complete</StatusMark>
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <Rule />
          <p className="font-serif text-sm italic leading-relaxed text-ink-3">
            Press <kbd className="font-mono not-italic">Ctrl K</kbd> to jump anywhere, or{" "}
            <kbd className="font-mono not-italic">?</kbd> for shortcuts.
          </p>
        </aside>
      </div>
    </div>
  );
}
