// The slice of a verified case file that the hotline and the claim documents may use.
// Browser-safe (no Node imports): the server page loads the case and hands this to the call screen.
//
// Every fact here comes from data/cases/<slug>.json. The few facts that the case file states only in prose
// (class period, certified states) are typed in below with the source they come from, and
// tests/hotline.facts.test.ts checks that the case file still says the same thing.

import type { CaseFile, LegalAction, PromoterPost, Source } from "../types";

export type Reference = { id: string; label: string; url: string };

export type HotlineCase = {
  slug: string;
  /**
   * What the SEC says went wrong, which decides the law the documents cite.
   * paid-promotion: promoters were paid and didn't disclose it (Securities Act §17(b)), as in EMAX.
   * insider-fraud: the coin's own officers manipulated its market and misled buyers, as in Saitama
   * (the case file's dataNotes: "§17(b)'s duty to disclose a promoter's payment is not the theory here").
   * Missing on claims saved before it existed: read as paid-promotion.
   */
  theory?: "paid-promotion" | "insider-fraud";
  token: CaseFile["token"];
  oneLiner: string;
  window: CaseFile["window"];
  posts: PromoterPost[];
  legal: LegalAction[];
  /** daily closing price in USD, from the pool's own reserves */
  prices: { t: string; priceUsd: number | null }[];
  /** First and last day the case file has prices for (purchases outside this have no USD estimate). */
  priceRange: { from: string; to: string };
  /** Block the main pool was created in (nothing to find before it). */
  pairCreatedBlock: number;
  classAction: {
    name: string;
    formerName: string;
    court: string;
    docket: string;
    judge: string;
    /** Purchase dates in the class definition, as the court's Dec 6, 2022 order states them. */
    classPeriod: { from: string; to: string };
    certifiedStates: string[]; // USPS codes
    status: string;
    statusDate: string;
    sources: Source[];
  } | null;
  demoWallet: { address: string; note: string } | null;
  references: Reference[]; // statutes and filing sites the documents may cite
  dataNotes: string[];
};

/** Filing sites and statutes, with the official URL. Nothing here is case-specific. */
export const REFERENCES: Reference[] = [
  { id: "sec-tcr", label: "SEC Tips, Complaints and Referrals (TCR) portal", url: "https://www.sec.gov/tcr" },
  { id: "ftc", label: "FTC ReportFraud", url: "https://reportfraud.ftc.gov" },
  { id: "nasaa", label: "NASAA: Contact your state or provincial securities regulator", url: "https://www.nasaa.org/contact-your-regulator/" },
  // the FCA moved this page from /report-scam-us; Report Fraud replaced Action Fraud on 2025-12-04 (src/lib/claims/law.ts)
  { id: "fca", label: "Financial Conduct Authority: Report a scam", url: "https://www.fca.org.uk/consumers/report-scam" },
  { id: "report-fraud", label: "Report Fraud (UK national fraud reporting service, formerly Action Fraud)", url: "https://www.reportfraud.police.uk" },
  { id: "india-cyber", label: "National Cyber Crime Reporting Portal (India)", url: "https://cybercrime.gov.in" },
  { id: "india-1930", label: "India's national cyber fraud helpline: call 1930", url: "https://cybercrime.gov.in" },
  { id: "police-scotland", label: "Police Scotland (non-emergency): call 101", url: "https://www.scotland.police.uk" },
  { id: "17b", label: "Securities Act of 1933, Section 17(b), 15 U.S.C. § 77q(b)", url: "https://www.law.cornell.edu/uscode/text/15/77q" },
  { id: "pacer", label: "PACER (US federal court records)", url: "https://pacer.uscourts.gov" },
];

export const ref = (id: string) => REFERENCES.find((r) => r.id === id)!;

// The EMAX case: facts stated in the case file's prose, typed in once here.
const EMAX_CLASS = {
  name: "In re EthereumMax Investor Litigation",
  formerName: "Huegerich v. Gentile et al.",
  court: "US District Court for the Central District of California",
  docket: "2:22-cv-00163",
  judge: "Michael W. Fitzgerald",
  // dataNotes: "the end of the class period (purchases from May 14 to June 27, 2021) in the class-action complaint",
  // sources.md: "The class period is May 14 – June 27, 2021" (Dec 6, 2022 order).
  classPeriod: { from: "2021-05-14", to: "2021-06-27" },
  // legal "class-action-certified-2025": "classes of investors ... in California, Florida, New York and New Jersey ... refused a nationwide class"
  certifiedStates: ["CA", "FL", "NY", "NJ"],
};

const EMAX_PAIR_CREATED_BLOCK = 12503000; // dataNotes: "pair ... was created at 10:39 UTC that day (block 12503000)"

// Saitama: the SEC sued the coin's own officers for fraud and market manipulation (legal "sec-saitama-2024");
// every post's disclosedPayment is null and the dataNotes say §17(b) is not the theory.
const THEORY: Record<string, HotlineCase["theory"]> = { emax: "paid-promotion", saitama: "insider-fraud" };

// The demo wallet of each case: a real buyer from the case file's buyersInWindow sample.
// EMAX: bought several times and never sold. Saitama: bought twice during the SaitaMask countdown (Nov 11 and 13, 2021), never sold.
const DEMO_WALLET: Record<string, string> = { emax: "0xac85724be118b69a9aee3b03bd2af2ac0071f26a", saitama: "0x3dad8f9341255ceb7e129512ae790d90cec55105" };

/** Builds the hotline's view of a case. Pure: same case file in, same object out. */
export function toHotlineCase(c: CaseFile): HotlineCase {
  const priced = c.prices.filter((p) => p.priceUsd != null);
  const isEmax = c.slug === "emax";
  const certified = c.legal.find((l) => l.id === "class-action-certified-2025");
  const filed = c.legal.find((l) => l.id === "class-action-filed");
  const dismissed = c.legal.find((l) => l.id === "class-action-dismissed-2022");
  const sample = c.buyersInWindow?.sample ?? [];
  const demo = sample.find((s) => s.address.toLowerCase() === DEMO_WALLET[c.slug]) ?? sample[0];
  return {
    slug: c.slug,
    theory: THEORY[c.slug] ?? "paid-promotion",
    token: c.token,
    oneLiner: c.oneLiner,
    window: c.window,
    posts: c.posts,
    legal: c.legal,
    prices: c.prices.map((p) => ({ t: p.t, priceUsd: p.priceUsd })),
    priceRange: { from: priced[0]?.t ?? "", to: priced[priced.length - 1]?.t ?? "" },
    pairCreatedBlock: c.token.pairCreatedBlock ?? (isEmax ? EMAX_PAIR_CREATED_BLOCK : 0),
    classAction:
      isEmax && certified
        ? {
            ...EMAX_CLASS,
            status: certified.outcome ?? certified.summary,
            statusDate: certified.date,
            sources: [...(filed?.sources.filter((s) => /courtlistener/.test(s.url)) ?? []), ...(dismissed?.sources ?? []), ...certified.sources],
          }
        : null,
    demoWallet: demo
      ? {
          address: demo.address,
          note: isEmax
            ? `A real EMAX buyer taken from the case file's sample of ${c.buyersInWindow?.count.toLocaleString("en-US")} addresses that bought from the pool in the 72 hours after the Kardashian post. It is used only to demonstrate the hotline; it is not a real caller.`
            : `A real ${c.token.symbol} buyer taken from the case file's sample of ${c.buyersInWindow?.count.toLocaleString("en-US")} addresses that bought from the pool in the case's buyer window. It is used only to demonstrate the hotline; it is not a real caller.`,
        }
      : null,
    references: REFERENCES,
    dataNotes: c.dataNotes,
  };
}

// ---------- helpers shared by the engine and the documents ----------

export type Documented = "SEC order" | "SEC complaint (an allegation)" | "court summary of the class-action complaint (an allegation)" | "press report";

/** How strong the record of a post is, from its sources. */
export function documentedBy(p: PromoterPost): Documented {
  if (p.sources.some((s) => /sec\.gov\/litigation\/admin/.test(s.url))) return "SEC order";
  if (p.sources.some((s) => /sec\.gov\/files\/litigation\/complaints/.test(s.url))) return "SEC complaint (an allegation)";
  if (p.sources.some((s) => /C\.D\. Cal\./.test(s.label))) return "court summary of the class-action complaint (an allegation)";
  return "press report";
}

export const promoters = (k: HotlineCase) => [...new Set(k.posts.map((p) => p.promoter))];

/** The post of a promoter that carries the documented payment, if any. */
export const paidPost = (k: HotlineCase, promoter: string) => k.posts.find((p) => p.promoter === promoter && p.paid);

export function priceOn(k: HotlineCase, day: string): number | null {
  return k.prices.find((p) => p.t === day)?.priceUsd ?? null;
}

export const inClassPeriod = (k: HotlineCase, day: string) =>
  Boolean(k.classAction && day >= k.classAction.classPeriod.from && day <= k.classAction.classPeriod.to);
