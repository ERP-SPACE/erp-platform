import { Button } from "@erp/ui";
import { Camera, CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** The browser's built-in detector (Chrome on Android); not yet in the TS DOM types. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

export const cameraScanSupported = () =>
  typeof window !== "undefined" &&
  "BarcodeDetector" in window &&
  Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Camera scanning for roll labels (QR or Code 128). Uses the phone browser's own detector, so
 * there is nothing to download; where it isn't available, the USB scanner / typing still works.
 */
export function CameraScanner({ onScan }: { onScan: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string>();
  const last = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const detector = new window.BarcodeDetector!({ formats: ["qr_code", "code_128"] });
        const tick = async () => {
          if (cancelled) return;
          try {
            const [hit] = await detector.detect(video);
            const now = Date.now();
            // The same label stays in view for a while; report it once per 2 seconds.
            if (hit && !(last.current?.code === hit.rawValue && now - last.current.at < 2000)) {
              last.current = { code: hit.rawValue, at: now };
              onScan(hit.rawValue);
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 200);
        };
        void tick();
      } catch {
        setError("Camera unavailable — allow camera access, or use the scanner.");
        setActive(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onScan]);

  if (!cameraScanSupported()) return null;
  return (
    <div className="grid gap-2">
      {active ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
            aria-label="Camera view"
          />
          <div
            className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70"
            aria-hidden
          />
        </div>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        icon={active ? CameraOff : Camera}
        className="h-12 text-base"
        onClick={() => {
          setError(undefined);
          setActive((a) => !a);
        }}
      >
        {active ? "Stop camera" : "Scan with camera"}
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
