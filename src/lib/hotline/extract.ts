// Optional: let an LLM pull structured fields out of a free-text answer the rules couldn't read.
// The model only proposes; every field is checked against the caller's own words and the case file
// before the conversation engine sees it. With no LLM (or no credit), this simply returns nothing.

import { z } from "zod";
import type { Extracted, StepId } from "./agent";
import { promoters, type HotlineCase } from "./caseFacts";
import { parsePlace, US_STATES, type Place } from "./parse";

export const ExtractSchema = z.object({
  coin: z.string().max(60).nullable(),
  promoters: z.array(z.string().max(60)).max(5),
  month: z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/).nullable(),
  day: z.number().int().min(1).max(31).nullable(),
  amountValue: z.number().positive().nullable(),
  currency: z.enum(["USD", "GBP", "EUR", "INR", "CAD", "AUD", "ETH"]).nullable(),
  country: z.string().max(60).nullable(),
  usStateCode: z.string().length(2).nullable(),
});
export type RawExtract = z.infer<typeof ExtractSchema>;

/** Steps whose answers may be sent to the extractor. Name and email never are. */
export const EXTRACTABLE: StepId[] = ["coin", "promoter", "when", "amount", "location", "state"];

const appears = (needle: string, hay: string) => needle.trim().length > 1 && hay.toLowerCase().includes(needle.trim().toLowerCase());

/** Keep only what the caller actually said and what the case file knows. */
export function guardExtract(raw: RawExtract | null, text: string, k: HotlineCase): Extracted {
  if (!raw) return {};
  const out: Extracted = {};
  if (raw.coin && appears(raw.coin, text)) out.coin = raw.coin;
  const known = promoters(k);
  const ps = raw.promoters.filter((p) => known.includes(p) && p.split(/\s+/).some((w) => w.length > 2 && appears(w.replace(/\.$/, ""), text)));
  if (ps.length) out.promoters = ps;
  if (raw.month) {
    const [y, m] = raw.month.split("-");
    const monthName = new Date(`${raw.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    // the month must be in the words (by name, first 3 letters, or number) — the year may be implied by the case
    if (appears(monthName.slice(0, 3), text) || new RegExp(`\\b0?${Number(m)}\\b`).test(text)) {
      out.when = { text, month: raw.month, ...(raw.day && new RegExp(`\\b${raw.day}`).test(text) ? { date: `${y}-${m}-${String(raw.day).padStart(2, "0")}` } : {}) };
    }
  }
  if (raw.amountValue) {
    const digits = String(Math.round(raw.amountValue));
    const plain = text.replace(/[,\s]/g, "");
    if (plain.includes(digits) || plain.includes(digits.replace(/000$/, "k")) || /\b(thousand|hundred|grand|million)\b/i.test(text))
      out.amount = { text, value: raw.amountValue, currency: raw.currency ?? undefined };
  }
  const st = raw.usStateCode ? US_STATES.find((s) => s[0] === raw.usStateCode!.toUpperCase()) : null;
  if (st && (appears(st[1], text) || new RegExp(`\\b${st[0]}\\b`).test(text))) {
    out.place = { text, country: "US", countryName: "United States", state: st[0], stateName: st[1] };
  } else if (raw.country && appears(raw.country, text)) {
    out.place = parsePlace(raw.country) ?? ({ text, country: "other", countryName: raw.country } satisfies Place);
  }
  return out;
}

export const EXTRACT_SYSTEM = (k: HotlineCase) =>
  [
    "You read one answer from a person reporting a crypto scam and return only fields they actually stated.",
    "Never guess. If a field is not in their words, return null (or an empty list).",
    `Known promoters (use these exact spellings, only if the person names them): ${promoters(k).join("; ")}.`,
    "month is YYYY-MM. If they give a month without a year and the coin is EthereumMax/EMAX, use 2021; otherwise null.",
    "usStateCode is the two-letter USPS code only if they name a US state or a city in it.",
  ].join("\n");
