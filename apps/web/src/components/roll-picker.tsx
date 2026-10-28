import type { RollInspector } from "@erp/contracts";
import { Badge, Button, Field, Mono, Select, useToast } from "@erp/ui";
import { X } from "lucide-react";
import { useState } from "react";
import { ApiError, api, call } from "../lib/api.js";
import { metres } from "../lib/sales.js";
import { ScanInput } from "./scan-input.js";

export interface PickLine {
  id: string;
  label: string;
  wantedM: number;
}
export interface PickedRoll {
  lineId: string;
  rollId: string;
  barcode: string;
  lengthM: number;
}

/**
 * Rolls for a direct or proforma sale (Q22): scan each roll; it is checked live (in stock,
 * Mapped) and assigned to the chosen line. The server holds them when the draft is created.
 */
export function RollPicker({
  lines,
  picked,
  onChange,
}: {
  lines: PickLine[];
  picked: PickedRoll[];
  onChange: (rolls: PickedRoll[]) => void;
}) {
  const toast = useToast();
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const scan = async (barcode: string) => {
    if (picked.some((p) => p.barcode === barcode)) {
      toast({ tone: "warning", title: `${barcode} is already on this invoice` });
      return;
    }
    try {
      const roll = await call<RollInspector>(() =>
        api.GET("/api/rolls/{idOrBarcode}", { params: { path: { idOrBarcode: barcode } } }),
      );
      if (roll.status !== "Mapped") {
        toast({
          tone: "danger",
          title: `${barcode} is ${roll.status}`,
          description: "Only rolls in stock can be sold.",
        });
        return;
      }
      onChange([
        ...picked,
        { lineId, rollId: roll.id, barcode: roll.barcode, lengthM: roll.currentLengthM },
      ]);
    } catch (e) {
      toast({
        tone: "danger",
        title: e instanceof ApiError ? e.problem.title : `Can't find ${barcode}`,
      });
    }
  };
  return (
    <div className="grid gap-4">
      {lines.length > 1 ? (
        <Field label="Scanning for">
          {(p) => (
            <Select
              {...p}
              value={lineId}
              onValueChange={setLineId}
              options={lines.map((l) => ({ value: l.id, label: l.label }))}
            />
          )}
        </Field>
      ) : null}
      <ScanInput label="Scan the rolls being sold" onScan={(b) => void scan(b)} />
      <ul className="grid gap-3">
        {lines.map((l) => {
          const mine = picked.filter((p) => p.lineId === l.id);
          const got = mine.reduce((s, p) => s + p.lengthM, 0);
          return (
            <li key={l.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{l.label}</span>
                <Badge tone={got >= l.wantedM ? "success" : got ? "warning" : "neutral"}>
                  {metres(got)} of {metres(l.wantedM)}
                </Badge>
              </div>
              {mine.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mine.map((p) => (
                    <span
                      key={p.rollId}
                      className="inline-flex items-center gap-1 rounded bg-muted py-0.5 pl-2 pr-0.5 text-xs"
                    >
                      <Mono>{p.barcode}</Mono> · {p.lengthM} m
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={X}
                        aria-label={`Remove ${p.barcode}`}
                        onClick={() => onChange(picked.filter((x) => x.rollId !== p.rollId))}
                      />
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
