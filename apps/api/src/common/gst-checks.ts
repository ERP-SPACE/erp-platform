import { GST_STATES, validateGstin } from "@erp/domain";
import { validationError } from "./errors.js";

/**
 * Validates a party's GST state, GSTIN and PAN together and returns the PAN to store
 * (derived from GSTIN characters 3–12 when not given). Throws 400 with field issues.
 */
export function checkGstDetails(input: {
  stateCode: string;
  gstin?: string | null;
  pan?: string | null;
}): { pan: string | null } {
  const issues: { path: string; message: string }[] = [];
  if (!(input.stateCode in GST_STATES)) {
    issues.push({ path: "stateCode", message: "Unknown GST state code" });
  }
  if (input.gstin) {
    const check = validateGstin(input.gstin);
    if (!check.valid) issues.push({ path: "gstin", message: check.error! });
    else {
      if (check.stateCode !== input.stateCode) {
        issues.push({
          path: "stateCode",
          message: `GSTIN belongs to state ${check.stateCode} (${GST_STATES[check.stateCode!] ?? "unknown"})`,
        });
      }
      if (input.pan && check.pan !== input.pan) {
        issues.push({ path: "pan", message: "PAN does not match characters 3–12 of the GSTIN" });
      }
    }
  }
  if (issues.length) throw validationError("The GST details don't match.", issues);
  return { pan: input.pan ?? (input.gstin ? input.gstin.slice(2, 12) : null) };
}
