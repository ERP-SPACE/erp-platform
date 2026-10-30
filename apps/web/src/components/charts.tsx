import { formatINRCompact } from "@erp/domain";
import { curveLinear } from "@visx/curve";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { AreaClosed, Bar, LinePath } from "@visx/shape";
import { type ReactNode, useState } from "react";
import { rupees } from "../lib/sales.js";

/**
 * Today's charts (brief §B4.1): thin single-series marks in theme tokens, a hover tooltip on
 * every chart, and each chart's numbers also as a table for screen readers (WCAG, dataviz).
 */

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-card"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>
  );
}

function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            {r.map((c, i) =>
              i === 0 ? (
                <th key={i} scope="row">
                  {c}
                </th>
              ) : (
                <td key={i}>{c}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

// ── 30-day sales line ────────────────────────────────────────────────────────

export function SalesTrendChart({ data }: { data: { date: string; value: string }[] }) {
  const total = data.reduce((s, d) => s + Number(d.value), 0);
  return (
    <div className="relative">
      <div className="h-48" aria-hidden>
        <ParentSize>
          {({ width, height }) => <SalesLine data={data} width={width} height={height} />}
        </ParentSize>
      </div>
      <SrTable
        caption={`Sales (taxable) for the last 30 days, ${rupees(total.toFixed(2))} in all`}
        head={["Date", "Sales"]}
        rows={data.map((d) => [d.date, rupees(d.value)])}
      />
    </div>
  );
}

function SalesLine({
  data,
  width,
  height,
}: {
  data: { date: string; value: string }[];
  width: number;
  height: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (width < 10) return null;
  const m = { top: 8, right: 8, bottom: 22, left: 52 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const values = data.map((d) => Number(d.value));
  const max = Math.max(1, ...values);
  const x = scaleLinear({ domain: [0, data.length - 1], range: [0, w] });
  const y = scaleLinear({ domain: [0, max], range: [h, 0], nice: true });
  const ticks = y.ticks(3);
  const at = (i: number) => x(i);
  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height}>
        <Group left={m.left} top={m.top}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[11px]">
                {formatINRCompact(t)}
              </text>
            </g>
          ))}
          {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => (
            <text
              key={i}
              x={at(i)}
              y={h + 16}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              className="fill-fg-3 text-[11px]"
            >
              {shortDate(data[i]!.date)}
            </text>
          ))}
          <AreaClosed
            data={values}
            x={(_, i) => at(i)}
            y={(v) => y(v)}
            yScale={y}
            curve={curveLinear}
            fill="color-mix(in oklab, var(--primary) 10%, transparent)"
          />
          <LinePath
            data={values}
            x={(_, i) => at(i)}
            y={(v) => y(v)}
            curve={curveLinear}
            stroke="var(--primary)"
            strokeWidth={2}
          />
          {values.map((v, i) =>
            v > 0 ? <circle key={i} cx={at(i)} cy={y(v)} r={2.5} fill="var(--primary)" /> : null,
          )}
          {hover !== null ? (
            <>
              <line
                x1={at(hover)}
                x2={at(hover)}
                y1={0}
                y2={h}
                stroke="var(--border-strong)"
                strokeDasharray="3 3"
              />
              <circle
                cx={at(hover)}
                cy={y(values[hover]!)}
                r={4}
                fill="var(--primary)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </>
          ) : null}
          <rect
            width={w}
            height={h}
            fill="transparent"
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const i = Math.round(x.invert(e.clientX - box.left));
              setHover(Math.max(0, Math.min(data.length - 1, i)));
            }}
            onMouseLeave={() => setHover(null)}
          />
        </Group>
      </svg>
      {hover !== null ? (
        <Tip x={m.left + at(hover)} y={m.top + y(values[hover]!)}>
          <span className="text-fg-2">{shortDate(data[hover]!.date)}</span>{" "}
          <span className="font-medium text-fg">{rupees(data[hover]!.value)}</span>
        </Tip>
      ) : null}
    </div>
  );
}

// ── AR aging waterfall ───────────────────────────────────────────────────────

/** Each bucket's bar starts where the younger buckets end; the last bar is the total. */
export function AgingWaterfall({ data }: { data: { label: string; amount: string }[] }) {
  const total = data.reduce((s, d) => s + Number(d.amount), 0);
  const [hover, setHover] = useState<number | null>(null);
  const bars = [
    ...data.map((d, i) => ({
      label: d.label,
      start: data.slice(0, i).reduce((s, x) => s + Number(x.amount), 0),
      value: Number(d.amount),
      total: false,
    })),
    { label: "Total", start: 0, value: total, total: true },
  ];
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return (
    <div>
      <ul className="grid gap-2.5" aria-hidden>
        {bars.map((b, i) => (
          <li
            key={b.label}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-sm"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className={b.total ? "font-medium text-fg" : "text-fg-2"}>{b.label}</span>
            <span className="relative h-5 rounded-sm bg-muted">
              <span
                className="absolute inset-y-0 rounded-[4px] transition-opacity"
                style={{
                  left: `${pct(b.start)}%`,
                  width: `max(${b.value > 0 ? "3px" : "0px"}, ${pct(b.value)}%)`,
                  background: b.total ? "var(--fg-2)" : "var(--primary)",
                  opacity: hover === null || hover === i ? 1 : 0.45,
                }}
              />
            </span>
            <span className={`tnum text-right ${b.total ? "font-semibold text-fg" : "text-fg"}`}>
              {formatINRCompact(b.value)}
            </span>
          </li>
        ))}
      </ul>
      <SrTable
        caption="Receivables by age since the invoice date"
        head={["Age", "Amount"]}
        rows={bars.map((b) => [b.label, rupees(b.value.toFixed(2))])}
      />
    </div>
  );
}

// ── stock aging heatmap ──────────────────────────────────────────────────────

/** Sequential, one hue: older stock is a deeper shade of the primary colour. */
const AGE_STEPS = [
  { upTo: 30, mix: 22, label: "≤ 30 d" },
  { upTo: 60, mix: 38, label: "31–60" },
  { upTo: 90, mix: 56, label: "61–90" },
  { upTo: 180, mix: 74, label: "91–180" },
  { upTo: Infinity, mix: 100, label: "> 180 d" },
];
const shade = (days: number) => AGE_STEPS.find((s) => days <= s.upTo)!;

export function StockHeatmap({
  data,
}: {
  data: { gsm: number; widthIn: string; metres: string; avgAgeDays: number }[];
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const gsms = [...new Set(data.map((d) => d.gsm))].sort((a, b) => a - b);
  const widths = [...new Set(data.map((d) => d.widthIn))].sort((a, b) => Number(a) - Number(b));
  const cell = new Map(data.map((d, i) => [`${d.gsm}|${d.widthIn}`, i]));
  const band = scaleBand({ domain: widths, range: [0, 1], padding: 0 });
  return (
    <div className="relative">
      <div aria-hidden className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="w-14 text-left text-[11px] font-medium text-fg-3">GSM</th>
              {widths.map((w) => (
                <th
                  key={w}
                  className="text-center text-[11px] font-medium text-fg-3"
                  style={{ width: `${band.bandwidth() * 100}%` }}
                >
                  {w}″
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gsms.map((g) => (
              <tr key={g}>
                <th className="text-left text-[11px] font-medium text-fg-3">{g}</th>
                {widths.map((w) => {
                  const i = cell.get(`${g}|${w}`);
                  const d = i === undefined ? null : data[i]!;
                  return (
                    <td key={w} className="h-7 p-0">
                      {d ? (
                        <div
                          className="h-7 rounded-[4px]"
                          style={{
                            background: `color-mix(in oklab, var(--primary) ${shade(d.avgAgeDays).mix}%, var(--surface))`,
                          }}
                          onMouseEnter={(e) => {
                            const box = e.currentTarget.getBoundingClientRect();
                            const parent = e.currentTarget
                              .closest(".relative")!
                              .getBoundingClientRect();
                            setHover({
                              i: i!,
                              x: box.left - parent.left + box.width / 2,
                              y: box.top - parent.top,
                            });
                          }}
                          onMouseLeave={() => setHover(null)}
                        />
                      ) : (
                        <div className="h-7 rounded-[4px] bg-muted/50" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-fg-2">
          <span>Average age</span>
          {AGE_STEPS.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                className="size-3 rounded-[3px]"
                style={{
                  background: `color-mix(in oklab, var(--primary) ${s.mix}%, var(--surface))`,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {hover ? (
        <Tip x={hover.x} y={hover.y}>
          <span className="font-medium text-fg">
            {data[hover.i]!.gsm} GSM · {data[hover.i]!.widthIn}″
          </span>{" "}
          <span className="text-fg-2">
            {Number(data[hover.i]!.metres).toLocaleString("en-IN")} m · {data[hover.i]!.avgAgeDays}{" "}
            days on average
          </span>
        </Tip>
      ) : null}
      <SrTable
        caption="Stock in hand by GSM and width, with its average age"
        head={["GSM × width", "Metres", "Average age (days)"]}
        rows={data.map((d) => [`${d.gsm} GSM × ${d.widthIn}″`, d.metres, String(d.avgAgeDays)])}
      />
    </div>
  );
}

// ── report series (periods or bands) ─────────────────────────────────────────

/** Vertical bars for a report's series: one hue, value on hover, numbers in a table too. */
export function SeriesBars({
  data,
  caption,
  money = true,
}: {
  data: { key: string; label: string; value: string }[];
  caption: string;
  money?: boolean;
}) {
  const fmt = (v: number) => (money ? formatINRCompact(v) : `${v.toLocaleString("en-IN")} m`);
  return (
    <div className="relative">
      <div className="h-44" aria-hidden>
        <ParentSize>
          {({ width, height }) => <Bars data={data} width={width} height={height} fmt={fmt} />}
        </ParentSize>
      </div>
      <SrTable
        caption={caption}
        head={["Period", "Value"]}
        rows={data.map((d) => [d.label, fmt(Number(d.value))])}
      />
    </div>
  );
}

function Bars({
  data,
  width,
  height,
  fmt,
}: {
  data: { key: string; label: string; value: string }[];
  width: number;
  height: number;
  fmt: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (width < 10 || !data.length) return null;
  const m = { top: 8, right: 8, bottom: 22, left: 72 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const values = data.map((d) => Number(d.value));
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  // Bars stay slim (≤ 40 px) however few periods there are.
  const span = Math.min(w, data.length * 64);
  const x = scaleBand({
    domain: data.map((d) => d.key),
    range: [(w - span) / 2, (w + span) / 2],
    padding: 0.35,
  });
  const y = scaleLinear({ domain: [lo, hi], range: [h, 0], nice: true });
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(w / 70))));
  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height}>
        <Group left={m.left} top={m.top}>
          {y.ticks(3).map((t) => (
            <g key={t}>
              <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--border)" />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[11px]">
                {fmt(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const v = values[i]!;
            const top = y(Math.max(0, v));
            const bh = Math.max(1, Math.abs(y(v) - y(0)));
            return (
              <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect
                  x={x(d.key)! - 2}
                  y={0}
                  width={x.bandwidth() + 4}
                  height={h}
                  fill="transparent"
                />
                <Bar
                  x={x(d.key)}
                  y={top}
                  width={x.bandwidth()}
                  height={bh}
                  rx={Math.min(4, x.bandwidth() / 2)}
                  fill={v < 0 ? "var(--danger)" : "var(--primary)"}
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
                {i % every === 0 ? (
                  <text
                    x={x(d.key)! + x.bandwidth() / 2}
                    y={h + 16}
                    textAnchor="middle"
                    className="fill-fg-3 text-[11px]"
                  >
                    {d.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </Group>
      </svg>
      {hover !== null ? (
        <Tip
          x={m.left + x(data[hover]!.key)! + x.bandwidth() / 2}
          y={m.top + y(Math.max(0, values[hover]!))}
        >
          <span className="text-fg-2">{data[hover]!.label}</span>{" "}
          <span className="font-medium text-fg">{fmt(values[hover]!)}</span>
        </Tip>
      ) : null}
    </div>
  );
}
