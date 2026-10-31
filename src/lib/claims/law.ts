// Law and reporting routes outside the US, each with the official source it was checked against (October 2026).
// The claim documents may cite only what is in this table: the fact guard (./guard) treats every article,
// section, instrument number, date, phone number and link in a document as unverified unless it appears here
// or in the case file. Where a source was not certain, the entry says less.
//
// Pure data, browser-safe. Not legal advice: these are pointers for a person drafting their own report.

import { EU_STATES, euPlace, type Place } from "../hotline/parse";

export type Jurisdiction = "US" | "UK" | "EU" | "IN" | "other";

export type LawSource = { label: string; url: string };

export type LawRef = {
  id: string;
  jurisdiction: Exclude<Jurisdiction, "US" | "other">;
  kind: "law" | "guidance" | "route";
  /** the citation exactly as the documents print it */
  cite: string;
  /** what it says, kept close to the source's own words */
  says: string;
  /** a date the documents may print (ISO), e.g. when a regime started to apply */
  date?: string;
  /** a second date (ISO), e.g. "applies to ads from" */
  from?: string;
  sources: LawSource[];
};

export const LAW: LawRef[] = [
  // ---------------- United Kingdom ----------------
  {
    id: "uk-fsma-21",
    jurisdiction: "UK",
    kind: "law",
    cite: "Financial Services and Markets Act 2000, section 21 (restrictions on financial promotion)",
    says: "A person must not, in the course of business, communicate an invitation or inducement to engage in investment activity, unless they are an authorised person or the content of the communication is approved by an authorised person.",
    sources: [{ label: "legislation.gov.uk, FSMA 2000 s.21", url: "https://www.legislation.gov.uk/ukpga/2000/8/section/21" }],
  },
  {
    id: "uk-fsma-25",
    jurisdiction: "UK",
    kind: "law",
    cite: "Financial Services and Markets Act 2000, section 25 (contravention of section 21)",
    says: "Breaking the section 21 restriction is a criminal offence.",
    sources: [{ label: "legislation.gov.uk, FSMA 2000 s.25", url: "https://www.legislation.gov.uk/ukpga/2000/8/section/25" }],
  },
  {
    id: "uk-crypto-promotions",
    jurisdiction: "UK",
    kind: "law",
    cite: "The Financial Services and Markets Act 2000 (Financial Promotion) (Amendment) Order 2023, SI 2023/612",
    says: "Brought qualifying cryptoassets within the section 21 restriction. Since the regime began, cryptoasset promotions to people in the UK must be made or approved by an FCA-authorised firm, or made by a cryptoasset business registered with the FCA.",
    date: "2023-10-08",
    sources: [
      { label: "legislation.gov.uk, SI 2023/612", url: "https://www.legislation.gov.uk/uksi/2023/612/contents/made" },
      { label: "FCA press release: tough new rules for marketing cryptoassets", url: "https://www.fca.org.uk/news/press-releases/fca-introduces-tough-new-rules-marketing-cryptoassets" },
    ],
  },
  {
    id: "uk-cobs-risk-warning",
    jurisdiction: "UK",
    kind: "law",
    cite: "FCA Handbook, COBS 4.12A.11R (cryptoasset risk warning), made by FCA policy statement PS23/6",
    says: "A cryptoasset promotion must carry this risk warning: \"Don't invest unless you're prepared to lose all the money you invest. This is a high-risk investment and you should not expect to be protected if something goes wrong.\"",
    sources: [
      { label: "FCA PS23/6: Financial promotion rules for cryptoassets", url: "https://www.fca.org.uk/publication/policy/ps23-6.pdf" },
      { label: "FCA Handbook, COBS 4.12A", url: "https://handbook.fca.org.uk/handbook/COBS/4/12A.html" },
    ],
  },
  {
    id: "uk-fg24-1",
    jurisdiction: "UK",
    kind: "guidance",
    cite: "FCA FG24/1: Finalised guidance on financial promotions on social media",
    says: "The FCA's guidance on promotions on social media, including by influencers (\"finfluencers\"). It warns that influencers who are not authorised and who promote financial products without approval may be committing a criminal offence.",
    date: "2024-03-26",
    sources: [{ label: "FCA FG24/1", url: "https://www.fca.org.uk/publications/finalised-guidance/fg24-1-finalised-guidance-financial-promotions-social-media" }],
  },
  {
    id: "uk-fca-report",
    jurisdiction: "UK",
    kind: "route",
    cite: "Financial Conduct Authority: Report a scam",
    says: "The FCA uses reports to look into firms and to protect others. It cannot get your money back. If you can't find a firm on the FCA Firm Checker, call the FCA on 0800 111 6768.",
    sources: [{ label: "FCA: Report a scam", url: "https://www.fca.org.uk/consumers/report-scam" }],
  },
  {
    id: "uk-fca-warning-list",
    jurisdiction: "UK",
    kind: "route",
    cite: "FCA Warning List of unauthorised firms",
    says: "Check whether the promoter or the platform appears on it.",
    sources: [{ label: "FCA Warning List", url: "https://www.fca.org.uk/consumers/warning-list-unauthorised-firms" }],
  },
  {
    id: "uk-report-fraud",
    jurisdiction: "UK",
    kind: "route",
    cite: "Report Fraud (the national fraud reporting service that replaced Action Fraud), for England, Wales and Northern Ireland",
    says: "Report online, or call 0300 123 2040. You get a crime reference number.",
    date: "2025-12-04",
    sources: [
      { label: "Report Fraud", url: "https://www.reportfraud.police.uk" },
      { label: "GOV.UK: Report Fraud, new service from City of London Police", url: "https://www.gov.uk/government/news/report-fraud-new-service-from-city-of-london-police" },
    ],
  },

  // ---------------- European Union ----------------
  {
    id: "eu-mica",
    jurisdiction: "EU",
    kind: "law",
    cite: "Regulation (EU) 2023/1114 on markets in crypto-assets (MiCA)",
    says: "The EU's rulebook for crypto-assets. Its stablecoin rules (Titles III and IV) applied first; the rest, including the market abuse rules in Title VI, applies from the date given here.",
    date: "2024-12-30",
    sources: [
      { label: "EUR-Lex, Regulation (EU) 2023/1114", url: "https://eur-lex.europa.eu/eli/reg/2023/1114/oj" },
      { label: "ESMA interactive single rulebook: MiCA", url: "https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica" },
    ],
  },
  {
    id: "eu-mica-86",
    jurisdiction: "EU",
    kind: "law",
    cite: "MiCA, Article 86(1) (scope of the market abuse rules)",
    says: "\"This Title shall apply to acts carried out by any person concerning crypto-assets that are admitted to trading or in respect of which a request for admission to trading has been made.\"",
    sources: [{ label: "ESMA single rulebook, MiCA Article 86", url: "https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-86-scope-rules-market-abuse" }],
  },
  {
    id: "eu-mica-91-2c",
    jurisdiction: "EU",
    kind: "law",
    cite: "MiCA, Article 91(2)(c) (market manipulation: spreading misleading information)",
    says: "Market manipulation includes disseminating information through the media, including the internet, which gives, or is likely to give, false or misleading signals as to the supply of, demand for, or price of a crypto-asset, where the person knew, or ought to have known, that the information was false or misleading.",
    sources: [{ label: "ESMA single rulebook, MiCA Article 91", url: "https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-91-prohibition-market-manipulation" }],
  },
  {
    id: "eu-mica-91-3c",
    jurisdiction: "EU",
    kind: "law",
    cite: "MiCA, Article 91(3)(c) (market manipulation: undisclosed conflict of interest)",
    says: "\"taking advantage of occasional or regular access to the traditional or electronic media by voicing an opinion about a crypto-asset, while having previously taken positions on that crypto-asset, and profiting subsequently from the impact of the opinions voiced on the price of that crypto-asset, without having simultaneously disclosed that conflict of interest to the public in a proper and effective way.\"",
    sources: [{ label: "ESMA single rulebook, MiCA Article 91", url: "https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-91-prohibition-market-manipulation" }],
  },
  {
    id: "eu-mica-88-89",
    jurisdiction: "EU",
    kind: "law",
    cite: "MiCA, Article 88 (public disclosure of inside information) and Article 89 (prohibition of insider dealing)",
    says: "The other market abuse rules in Title VI, relevant if insiders traded or held back information.",
    sources: [{ label: "ESMA interactive single rulebook: MiCA", url: "https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica" }],
  },
  {
    id: "eu-mica-7",
    jurisdiction: "EU",
    kind: "law",
    cite: "MiCA, Article 7(1) (marketing communications for crypto-assets other than asset-referenced tokens and e-money tokens)",
    says: "Marketing communications must be clearly identifiable as such, and their information must be fair, clear and not misleading and consistent with the crypto-asset white paper where one is required.",
    sources: [{ label: "ESMA single rulebook, MiCA Article 7", url: "https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-7-marketing-communications" }],
  },
  {
    id: "eu-ucpd",
    jurisdiction: "EU",
    kind: "law",
    cite: "Unfair Commercial Practices Directive 2005/29/EC, Annex I, point 11",
    says: "Always unfair: \"Using editorial content in the media to promote a product where a trader has paid for the promotion without making that clear in the content or by images or sounds clearly identifiable by the consumer (advertorial).\"",
    sources: [{ label: "EUR-Lex, Directive 2005/29/EC", url: "https://eur-lex.europa.eu/eli/dir/2005/29/oj" }],
  },
  {
    id: "eu-esma-ncas",
    jurisdiction: "EU",
    kind: "route",
    cite: "ESMA: list of national competent authorities under MiCA",
    says: "Each EU country names the authority that supervises crypto-assets and market abuse there.",
    sources: [{ label: "ESMA: competent authorities under MiCA", url: "https://www.esma.europa.eu/sites/default/files/2024-12/List_of_Competent_Authorities_notified_to_ESMA_under_MiCA.pdf" }],
  },

  // ---------------- India ----------------
  {
    id: "in-asci-vda",
    jurisdiction: "IN",
    kind: "guidance",
    cite: "ASCI Guidelines for Advertising of Virtual Digital Assets and Linked Services",
    says: "Ads for crypto products must carry, prominently: \"Crypto products and NFTs are unregulated and can be highly risky. There may be no regulatory recourse for any loss from such transactions.\" Celebrities and prominent personalities who appear in them must do their due diligence about the claims made.",
    date: "2022-02-23",
    from: "2022-04-01",
    sources: [
      { label: "ASCI press release on the VDA guidelines", url: "https://www.ascionline.in/wp-content/uploads/2022/09/vda-guidelines-press-release-feb-23.pdf" },
      { label: "The ASCI Code and guidelines", url: "https://www.ascionline.in/the-asci-code-guidelines/" },
    ],
  },
  {
    id: "in-asci-influencer",
    jurisdiction: "IN",
    kind: "guidance",
    cite: "ASCI Guidelines for Influencer Advertising in Digital Media",
    says: "Influencers must disclose any material connection with the advertiser, upfront, with a label such as Advertisement, Ad, Sponsored, Collaboration, Partnership, Employee, Free gift or Affiliate.",
    date: "2021-05-27",
    from: "2021-06-14",
    sources: [{ label: "ASCI Influencer Guidelines (PDF)", url: "https://www.ascionline.in/social/wp-content/uploads/2025/04/ASCI-Influencer-Guidelines.pdf" }],
  },
  {
    id: "in-asci-complaint",
    jurisdiction: "IN",
    kind: "route",
    cite: "Advertising Standards Council of India (ASCI): make a complaint",
    says: "Complain about a misleading or undisclosed ad, online through ASCI's complaint system. It is free; anonymous complaints are not taken.",
    sources: [
      { label: "ASCI complaint FAQ", url: "https://www.ascionline.in/complaint-faq/" },
      { label: "ASCI TARA complaint system", url: "https://tara.ascionline.in/auth/login" },
    ],
  },
  {
    id: "in-ncrp",
    jurisdiction: "IN",
    kind: "route",
    cite: "National Cyber Crime Reporting Portal, with the national helpline 1930",
    says: "For financial fraud, call 1930 as soon as you can, then file on the portal.",
    sources: [
      { label: "National Cyber Crime Reporting Portal", url: "https://cybercrime.gov.in" },
      { label: "PIB (Ministry of Home Affairs) on the 1930 helpline", url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=1814120" },
    ],
  },
  {
    id: "in-pmla-vda",
    jurisdiction: "IN",
    kind: "law",
    cite: "Ministry of Finance notification S.O. 1072(E) under the Prevention of Money-laundering Act, 2002",
    says: "Brings businesses that exchange, transfer, or keep virtual digital assets for other people within the PMLA as reporting entities. FIU-IND's guidelines of March 10, 2023 require them to register with FIU-IND.",
    date: "2023-03-07",
    sources: [
      { label: "Gazette of India, S.O. 1072(E)", url: "https://egazette.gov.in/WriteReadData/2023/244184.pdf" },
      { label: "FIU-IND AML & CFT guidelines for VDA service providers", url: "https://fiuindia.gov.in/pdfs/AML_legislation/AMLCFTguidelines10032023.pdf" },
    ],
  },
];

export const law = (id: string) => {
  const l = LAW.find((x) => x.id === id);
  if (!l) throw new Error(`unknown law ref ${id}`);
  return l;
};

/** The authority that handles market abuse in crypto-assets (MiCA Title VI) in six member states, per ESMA's list. */
export const EU_NCA: Record<string, { name: string; short: string; url: string }> = {
  DE: { name: "Federal Financial Supervisory Authority (BaFin)", short: "BaFin", url: "https://www.bafin.de/EN/verbraucherinnen-verbraucher/hilfe-kontakt/beschwerden-streitschlichtung/bei-bafin-beschweren/bei-bafin-beschweren_en.html" },
  FR: { name: "Autorité des marchés financiers (AMF)", short: "the AMF", url: "https://www.amf-france.org/en/report-scam-or-market-anomaly" },
  IE: { name: "Central Bank of Ireland", short: "the Central Bank of Ireland", url: "https://www.centralbank.ie/consumer-hub" },
  NL: { name: "Dutch Authority for the Financial Markets (AFM)", short: "the AFM", url: "https://www.afm.nl/en/contact" },
  ES: { name: "Comisión Nacional del Mercado de Valores (CNMV)", short: "the CNMV", url: "https://www.cnmv.es/portal/inversor/reclamaciones?lang=en" },
  IT: { name: "Commissione Nazionale per le Società e la Borsa (CONSOB)", short: "CONSOB", url: "https://www.consob.it/web/consob-and-its-activities/micar-investors-complaints" },
};

/** Where to send an EU report: the national authority if Canary has it, else ESMA's list of all of them. */
export function euAuthority(place?: Place): { name: string; short: string; url: string; known: boolean } {
  const n = place?.euState ? EU_NCA[place.euState] : undefined;
  if (n) return { ...n, known: true };
  const esma = law("eu-esma-ncas").sources[0];
  return { name: `the national competent authority${place?.countryName && place.euState ? ` of ${place.countryName}` : ""}`, short: "your national regulator", url: esma.url, known: false };
}

/** Which set of rules a place falls under (null: the caller didn't say; the documents then stay general). */
export function jurisdictionOf(place?: Place | null): Jurisdiction | null {
  return place ? place.country : null;
}

export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  US: "United States",
  UK: "United Kingdom",
  EU: "European Union",
  IN: "India",
  other: "Somewhere else",
};

/** A place for a jurisdiction picked by hand in the claim pack (keeps the caller's own place when it already matches). */
export function placeFor(j: Jurisdiction, current?: Place | null, euState?: string): Place | undefined {
  if (current && jurisdictionOf(current) === j && (j !== "EU" || !euState || current.euState === euState)) return current;
  switch (j) {
    case "US":
      return { text: "United States (chosen in the claim pack)", country: "US", countryName: "United States" };
    case "UK":
      return { text: "United Kingdom (chosen in the claim pack)", country: "UK", countryName: "United Kingdom" };
    case "EU":
      return euPlace(euState ?? "", "European Union (chosen in the claim pack)");
    case "IN":
      return { text: "India (chosen in the claim pack)", country: "IN", countryName: "India" };
    case "other":
      return { text: "elsewhere (chosen in the claim pack)", country: "other", countryName: "outside the US, UK, EU and India" };
  }
}

export const EU_CHOICES = EU_STATES.map((s) => ({ code: s.code, name: s.name }));
