// The real cases Canary replays, with the few lines of page copy that differ between them.
// Pure data (no server-only import), so tests and client components can read it too.
// The facts themselves live in data/cases/<slug>.json; nothing here is a fact about the case
// that the case file doesn't already state.

export type CaseMeta = {
  slug: string;
  name: string; // "EthereumMax (EMAX)"
  year: string;
  /** The legal theory in a few plain words. */
  theory: string;
  /** One sentence for the cases list. */
  blurb: string;
  /** Subtitle under "Wallets that bought" on the case page. */
  buyersLabel: string;
  /** Doki's line over the "What happened next" section. */
  legalLine: string;
  /** Doki's line over the "Bought it?" box. */
  victimLine: string;
  /** Command that rebuilds the case file. */
  rebuild: string;
  /** Whether Doki's hotline (/call) walks buyers of this case through filing. Otherwise the page points to the SEC tip portal. */
  hotline: boolean;
};

export const CASE_INDEX: CaseMeta[] = [
  {
    slug: "emax",
    name: "EthereumMax (EMAX)",
    year: "2021",
    theory: "Paid celebrity promotion without proper disclosure (Securities Act §17(b), anti-touting)",
    blurb: "Kim Kardashian and Paul Pierce were paid to post about EMAX without properly saying so. The SEC settled with both; an investor class action continues.",
    buyersLabel: "in the 72 hours after the token burn Kardashian's post announced",
    legalLine: "And this is what happened in the real world afterwards: two SEC settlements and an investor class action.",
    victimLine: "If you bought EMAX back then, talk to me. I can find your purchase and help you file.",
    rebuild: "npx tsx scripts/build-emax.mts",
    hotline: true,
  },
  {
    slug: "saitama",
    name: "Saitama Inu (SAITAMA)",
    year: "2021",
    theory: "Insiders hyping their own coin while selling it: market manipulation and fraud (Exchange Act §§9(a)(2), 10(b); Securities Act §17(a))",
    blurb: "The coin's own officers staged buying, paid for fake volume and said they were holding while they sold, per the SEC. Different promoters, different law, same agents.",
    buyersLabel: "during the SaitaMask launch countdown (Nov 8–13, 2021), while the SEC says the insiders were selling",
    legalLine: "And this is what happened afterwards: an SEC fraud and manipulation lawsuit, and a criminal case in Boston that is still going.",
    victimLine: "If you bought SAITAMA back then, talk to me. I can find your purchase and help you file.",
    rebuild: "npx tsx scripts/build-case.mts saitama",
    hotline: true,
  },
];

export const CASE_SLUGS = CASE_INDEX.map((c) => c.slug);

export const caseMeta = (slug: string): CaseMeta | null => CASE_INDEX.find((c) => c.slug === slug) ?? null;
