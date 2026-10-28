const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole number in Indian words: 1,23,45,678 → "One Crore Twenty Three Lakh …". */
export function indianWords(n: bigint): string {
  if (n === 0n) return "Zero";
  const parts: string[] = [];
  const crore = n / 10_000_000n;
  let rest = Number(n % 10_000_000n);
  if (crore > 0n) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** "₹ 32,261.50" → "Rupees Thirty Two Thousand Two Hundred Sixty One and Fifty Paise Only". */
export function rupeesInWords(amount: string): string {
  const [whole = "0", frac = ""] = amount.replace(/^-/, "").split(".");
  const paise = Number((frac + "00").slice(0, 2));
  const words = `Rupees ${indianWords(BigInt(whole))}`;
  return `${words}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}

/** Indian digit grouping with 2 decimals: "482300" → "4,82,300.00"; negatives in parentheses. */
export function inr(amount: string): string {
  const neg = amount.startsWith("-");
  const [whole = "0", frac = ""] = amount.replace(/^-/, "").split(".");
  const last3 = whole.slice(-3);
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = head ? `${head},${last3}` : last3;
  const out = `${grouped}.${(frac + "00").slice(0, 2)}`;
  return neg ? `(${out})` : out;
}
