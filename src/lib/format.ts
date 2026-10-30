export function fmtUsd(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(digits)}K`;
  if (a >= 1) return `$${n.toFixed(digits)}`;
  // tiny token prices: plain decimals with two significant digits, e.g. $0.00000055
  const decimals = Math.min(14, -Math.floor(Math.log10(a)) + 1);
  return `$${n.toFixed(decimals)}`;
}

export const fmtDate = (s: string) =>
  new Date(s.length <= 10 ? s + "T00:00:00Z" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A chart window around a case: a few days before the pump to a few weeks after the collapse. */
export function caseRange(w: { pumpStart: string; collapse: string }) {
  const d = (s: string, days: number) => new Date(Date.parse(s.slice(0, 10) + "T00:00:00Z") + days * 864e5).toISOString().slice(0, 10);
  return { from: d(w.pumpStart, -3), to: d(w.collapse, 14) };
}
