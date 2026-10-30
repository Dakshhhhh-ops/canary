// The only formatters the claim documents use. The fact guard applies the same ones to every
// number and date in the inputs, so anything a document prints can be traced back to an input.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2021-06-02" or "2021-06-02T17:26:42Z" -> "June 2, 2021" */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** "2021-06" -> "June 2021" */
export function monthYear(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ym;
}

/** "2021-06-02T17:26:42Z" -> "17:26 UTC" */
export const utcTime = (iso: string) => (/T(\d{2}:\d{2})/.exec(iso)?.[1] ?? "") + " UTC";

/** $848.35 */
export const usdCents = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** $2,921 */
export const usdWhole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** "1924122545.506946367218507928" -> "1,924,122,545.51" (the exact figure stays in the evidence file) */
export function tokenAmount(s: string): string {
  const [w, f = ""] = s.split(".");
  const whole = BigInt(w).toLocaleString("en-US");
  const frac = f.slice(0, 2).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export { MONTHS };
