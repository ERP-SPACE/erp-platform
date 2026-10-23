/**
 * GSTIN validation and GST state codes (PRD §8.6). A GSTIN is
 * 2-digit state code + 10-char PAN + entity number + 'Z' + check character.
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const GST_STATES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export function gstinCheckChar(first14: string): string {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]!);
    const product = value * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (total % 36)) % 36]!;
}

export interface GstinCheck {
  valid: boolean;
  error?: string;
  stateCode?: string;
  pan?: string;
}

export function validateGstin(input: string): GstinCheck {
  const gstin = input.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, error: "GSTIN format is invalid" };
  const stateCode = gstin.slice(0, 2);
  if (!(stateCode in GST_STATES)) return { valid: false, error: `Unknown state code ${stateCode}` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return {
      valid: false,
      error: "GSTIN check character does not match — please re-check the number",
    };
  }
  return { valid: true, stateCode, pan: gstin.slice(2, 12) };
}

/** Intra-state supply → CGST + SGST; inter-state → IGST (PRD §8.6). */
export function gstRegime(
  companyStateCode: string,
  placeOfSupplyStateCode: string,
): "CGST_SGST" | "IGST" {
  return companyStateCode === placeOfSupplyStateCode ? "CGST_SGST" : "IGST";
}
