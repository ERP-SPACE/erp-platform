import { parseRollBarcode } from "@erp/domain";
import { Button } from "@erp/ui";
import { ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { scanFeedback } from "../lib/floor.js";
import { CameraScanner } from "./camera-scanner.js";

/**
 * One big field for every scan. A USB/Bluetooth scanner types the barcode and presses Enter; the
 * camera reports the same way. The field keeps focus so the next scan just works.
 */
export function ScanInput({
  onScan,
  label = "Scan a roll label",
}: {
  onScan: (barcode: string) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const submit = useCallback(
    (raw: string) => {
      const parsed = parseRollBarcode(raw);
      if (!parsed.valid) {
        scanFeedback(false);
        setError(parsed.error);
        return;
      }
      scanFeedback(true);
      setError(undefined);
      setValue("");
      onScan(raw.trim().toUpperCase());
    },
    [onScan],
  );
  // Return focus to the field after dialogs and taps, so the scanner always has a target.
  useEffect(() => {
    const refocus = () => {
      if (document.activeElement === document.body) ref.current?.focus();
    };
    const id = window.setInterval(refocus, 800);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="grid gap-3">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
      >
        <label
          htmlFor="floor-scan"
          className="flex items-center gap-2 text-base font-semibold text-fg"
        >
          <ScanLine className="size-5 text-primary" aria-hidden /> {label}
        </label>
        <div className="flex gap-2">
          <input
            id="floor-scan"
            ref={ref}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "floor-scan-error" : undefined}
            placeholder="2610-SBC-0001-0001-K"
            className="h-14 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface px-4 font-mono text-lg uppercase text-fg placeholder:text-fg-3 focus-visible:border-primary aria-[invalid=true]:border-danger"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            className="h-14 px-5 text-base"
            disabled={!value.trim()}
          >
            Go
          </Button>
        </div>
        {error ? (
          <p id="floor-scan-error" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </form>
      <CameraScanner onScan={submit} />
    </div>
  );
}
