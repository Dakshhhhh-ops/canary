// The claim documents, in plain English, built only from: the case file, the caller's own answers,
// and the blockchain lookup. No other facts. tests/hotline.claims.test.ts runs the fact guard on every one.
// Everything the person says is written in the first person; everything Canary adds is labelled.

import type { DocKind } from "../hotline/agent";
import { documentedBy, ref, type HotlineCase } from "../hotline/caseFacts";
import { formatAmount } from "../hotline/parse";
import type { PromoterPost } from "../types";
import { postsCited } from "./evidence";
import { longDate, monthYear, tokenAmount, usdCents, usdWhole, utcTime } from "./format";
import { euAuthority, law, type LawRef } from "./law";
import type { ClaimDoc, ClaimInput } from "./types";

const PLATFORM: Record<string, string> = { instagram: "Instagram", x: "X (Twitter)", telegram: "Telegram", youtube: "YouTube", tiktok: "TikTok", other: "other channel" };
const listing = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const rule = "-".repeat(64);

type Ctx = { input: ClaimInput; k: HotlineCase; isCase: boolean; fingerprint: string; verifyUrl: string };

function header(title: string, where: { label: string; url: string } | null, c: Ctx, extra: string[] = []): string {
  return [
    title.toUpperCase(),
    rule,
    ...(where ? [`Where to file: ${where.label}`, where.url] : []),
    `Drafted with Canary on ${longDate(c.input.generatedAt)}. This is a draft for you to check, correct and send yourself.`,
    "Canary is an information tool, not a law firm. Nothing here is legal advice.",
    ...extra,
    rule,
    "",
  ].join("\n");
}

// ---------- shared pieces ----------

function whenPhrase(c: Ctx): string | null {
  const w = c.input.facts.when;
  if (!w) return null;
  if (w.date && /from the blockchain/.test(w.text)) return `first on ${longDate(w.date)}`;
  if (w.month && !w.date) return `in ${monthYear(w.month)}`;
  return w.text ? `"${w.text}" (my words)` : null;
}

function coinName(c: Ctx) {
  return c.isCase ? `${c.k.token.name} (${c.k.token.symbol})` : (c.input.facts.coin?.text ?? "a crypto token");
}

/** The victim's statement, first person, only from their answers and the blockchain. */
function statement(c: Ctx): string {
  const f = c.input.facts;
  const p: string[] = [];
  const when = whenPhrase(c);
  p.push(`I bought ${coinName(c)}${when ? (/^(in|first) /.test(when) ? ` ${when}` : `, ${when}`) : ""}.`);
  if (f.promoters?.matched.length) p.push(`I bought it after seeing promotions by ${listing(f.promoters.matched)}.`);
  if (f.promoters?.text && !f.promoters.matched.length) p.push(`What made me buy it, in my words: "${f.promoters.text}".`);
  const r = f.purchases;
  if (r && r.purchases.length) {
    p.push(
      `The Ethereum blockchain shows ${r.purchases.length} purchase${r.purchases.length === 1 ? "" : "s"} of ${c.k.token.symbol} by my wallet ${r.address}${
        r.totals.boughtUsd != null ? `, about ${usdWhole(r.totals.boughtUsd)} in total at each day's closing price` : ""
      }. They are listed below with their transaction IDs.`,
    );
    if (r.sales.length === 0) p.push("I never sold any of these tokens back to that trading pool.");
  } else if (f.wallet?.address) p.push(`I bought from my wallet ${f.wallet.address}.`);
  if (f.wallet?.exchange) p.push(`I bought through ${f.wallet.exchange}. My account history there shows the purchase.`);
  if (f.amount) p.push(f.amount.value != null ? `I lost about ${formatAmount(f.amount)} (my estimate).` : `About the money I lost, in my words: "${f.amount.text}".`);
  if (f.recoveryScam) p.push("Afterwards, someone offered to get my money back for a fee. I am reporting that as well.");
  return p.join(" ");
}

function purchaseList(c: Ctx): string {
  const r = c.input.facts.purchases;
  if (!r || !r.purchases.length) return "";
  const lines = r.purchases.map((x, i) => {
    const groups = new Map<string, { n: number; b: (typeof x.postsBefore)[number] }>();
    for (const b of x.postsBefore) {
      const key = `${b.promoter}|${b.postedAt}`;
      groups.set(key, { n: (groups.get(key)?.n ?? 0) + 1, b });
    }
    const posts = [...groups.values()].map(
      ({ n, b }) => `${b.promoter}${n > 1 ? `, ${n} posts` : ""} (${longDate(b.postedAt)}${b.daysBefore === 0 ? ", same day" : `, ${b.daysBefore} day${b.daysBefore === 1 ? "" : "s"} before`})`,
    );
    return [
      `${i + 1}. ${longDate(x.at)} at ${utcTime(x.at)}: ${tokenAmount(x.amount)} ${c.k.token.symbol}${x.usdEstimate != null ? `, about ${usdCents(x.usdEstimate)} at that day's closing price` : ""}`,
      `   Transaction: ${x.txHash}`,
      `   ${x.txUrl}`,
      ...(posts.length ? [`   Promoter posts dated within the 3 days before: ${posts.join("; ")}`] : []),
      ...(c.k.classAction ? [`   Inside the class action's purchase dates: ${x.inClassPeriod ? "yes" : "no"}`] : []),
    ].join("\n");
  });
  const sales = r.sales.map((s) => `- Sold ${longDate(s.at)} at ${utcTime(s.at)}: ${tokenAmount(s.amount)} ${c.k.token.symbol}. Transaction: ${s.txUrl}`);
  return [
    `My wallet: ${r.address}`,
    r.addressUrl,
    "",
    ...lines,
    ...(sales.length ? ["", "Sales back to the pool:", ...sales] : []),
    "",
    `How this was found: ${r.method}`,
    ...r.notes.map((n) => `- ${n}`),
  ].join("\n");
}

function postLine(p: PromoterPost, insider = false): string {
  const who = `${p.promoter}${p.handle ? ` (${p.handle})` : ""}`;
  const when = p.datePrecision === "month" ? monthYear(p.postedAt) : longDate(p.postedAt);
  const paid = p.paid ? ` Payment documented: ${usdWhole(p.paid.amountUsd)}, by ${p.paid.by}.` : "";
  const disclosed = insider
    ? p.affiliation
      ? ` Who: ${p.affiliation}.`
      : ""
    : p.disclosedPayment === false
      ? " Did not disclose the payment (per the source)."
      : p.disclosedPayment === null
        ? " Whether payment was disclosed is not documented."
        : "";
  return [
    `- ${when}, ${who} on ${PLATFORM[p.platform] ?? p.platform}. Recorded in: ${documentedBy(p)}.`,
    ...(p.text ? [`  Text: "${p.text}"`] : []),
    `  ${(paid + disclosed).trim()}`.trimEnd(),
    ...p.sources.map((s) => `  Source: ${s.label}. ${s.url}`),
  ]
    .filter((l) => l.trim())
    .join("\n");
}

function postsSection(c: Ctx): string {
  const posts = postsCited(c.input);
  return posts.length ? posts.map((p) => postLine(p, insider(c))).join("\n") : "";
}

function evidenceSection(c: Ctx): string {
  const f = c.input.facts;
  return [
    `- Evidence file: canary-evidence-${c.input.id}.json (attached or available on request).`,
    `  Its SHA-256 fingerprint is ${c.fingerprint}. Anyone can recompute it at ${c.verifyUrl}; if one character of the file changes, the fingerprint changes.`,
    ...(f.purchases?.purchases.length ? ["- The transaction links above open the public Ethereum record on etherscan.io."] : []),
    ...(f.wallet?.exchange ? [`- My account statement from ${f.wallet.exchange}.`] : []),
    "- Screenshots of the promotions I saw, if I still have them.",
  ].join("\n");
}

function aboutYou(c: Ctx): string {
  const f = c.input.facts;
  return [
    `Name: ${f.name ?? "[your name]"}`,
    `Email: ${f.email ?? "[your email]"}`,
    `Where I live: ${f.place ? [f.place.stateName, f.place.ukNation, f.place.countryName].filter(Boolean).join(", ") : "[your state or country]"}`,
    "Phone and address: [add them in the form if you want the regulator to contact you]",
  ].join("\n");
}

const secLegal = (c: Ctx) => c.k.legal.filter((l) => l.kind === "sec" && !/not EMAX/i.test(l.title));

/**
 * A case where the SEC sued the coin's own officers for fraud and market manipulation (Saitama), not promoters
 * paid without disclosure (EMAX). Its documents cite the statutes of the SEC's own complaint, never §17(b).
 */
const insider = (c: Ctx) => c.isCase && c.k.theory === "insider-fraud";

/** The people behind the documented posts (for Saitama: the officers the SEC sued, and their official account). */
const postAuthors = (c: Ctx) => [...new Set(c.k.posts.map((p) => p.promoter))];

/** Section 2 and 3 of the SEC tip for an insider case: who, and the law the SEC's own complaint relies on. */
function insiderSubjects(c: Ctx): string[] {
  const named = c.input.facts.promoters?.matched ?? [];
  const people = named.length ? named : postAuthors(c);
  return [
    ...people.map((name) => {
      const post = c.k.posts.find((p) => p.promoter === name);
      const handle = c.k.posts.find((p) => p.promoter === name && p.handle)?.handle;
      return `- ${name}${handle ? ` (${handle})` : ""}${post?.affiliation ? `: ${post.affiliation}` : ""}. The SEC's complaint quotes their posts; these are allegations, not findings.`;
    }),
    ...secLegal(c).map((l) => `- Already before the court: ${l.title}, ${longDate(l.date)}.`),
  ];
}

function insiderLaw(c: Ctx): string[] {
  return [
    ...secLegal(c)
      .filter((l) => l.statute)
      .map((l) => `The SEC's complaint in ${l.title.split(" (")[0]} relies on: ${l.statute}.`),
    "The SEC has already sued the people running this token (allegations, not findings):",
    ...secLegal(c).map((l) => `- ${l.title}, ${longDate(l.date)}. ${l.summary} ${l.outcome ?? ""} ${l.sources.map((s) => s.url).join(" ")}`),
    "I am sending this as an investor who bought while, according to the SEC, this token's market was being manipulated, in case it helps that case or any continuing investigation.",
  ];
}

// ---------- the documents ----------

function secTip(c: Ctx): ClaimDoc {
  const f = c.input.facts;
  const named = f.promoters?.matched ?? [];
  const tcr = ref("sec-tcr");
  const s17 = ref("17b");
  const subjects: string[] = [];
  if (insider(c)) subjects.push(...insiderSubjects(c));
  else if (c.isCase) {
    const promoters = named.length ? named : [...new Set(c.k.posts.filter((p) => documentedBy(p) === "SEC order").map((p) => p.promoter))];
    for (const name of promoters) {
      const paid = c.k.posts.find((p) => p.promoter === name && p.paid);
      const order = secLegal(c).find((l) => l.summary.includes(name.split(" ").pop()!));
      const handle = c.k.posts.find((p) => p.promoter === name && p.handle)?.handle;
      subjects.push(
        `- ${name}${handle ? ` (${handle})` : ""}: ${
          order ? `${order.title}, ${longDate(order.date)}. ${order.summary}` : paid?.paid ? `paid ${usdWhole(paid.paid.amountUsd)} by ${paid.paid.by}.` : "named in the class-action complaint. These are allegations; I am not aware of an SEC finding about this person and EMAX."
        }`,
      );
    }
    const payers = c.k.posts.filter((p) => p.paid).map((p) => `"${p.paid!.by.split(", in ")[0]}" (for ${p.promoter})`);
    subjects.push(`- ${c.k.token.name}, the issuer of the ${c.k.token.symbol} token. The SEC's findings say the promoters were paid by: ${payers.join("; ")}.`);
  } else {
    subjects.push(`- ${f.promoters?.text ? `The people or accounts who promoted it, in my words: "${f.promoters.text}"` : "[who promoted the coin: names, accounts, websites]"}`);
    subjects.push(`- The issuer or sellers of ${coinName(c)}: [names, websites, contract address if known]`);
  }

  const otherAgencies = c.input.consents.filter((d) => d !== "sec").map((d) => AGENCY[d]).filter((x): x is string => Boolean(x));

  const body = [
    header("Tip for the US Securities and Exchange Commission (SEC)", { label: tcr.label, url: tcr.url }, c, [
      "The SEC's online form asks for these things in its own order. Copy each part into the matching box.",
    ]),
    "1. ABOUT YOU",
    aboutYou(c),
    "",
    "2. WHO THIS TIP IS ABOUT",
    ...subjects,
    "",
    "3. YOUR COMPLAINT",
    insider(c)
      ? "Type: market manipulation and false or misleading statements by the people running a crypto asset, and my losses after buying it."
      : `Type: a crypto asset promoted for pay without disclosing the payment ("touting"), and my losses after buying it.`,
    c.isCase
      ? `Security: ${c.k.token.name} (${c.k.token.symbol}), Ethereum token contract ${c.k.token.address}${c.k.token.pair ? `, traded on the ${c.k.token.pairDex ?? ""} pool ${c.k.token.pair}` : ""}.`
      : `Security: ${coinName(c)}. [Add the token's contract address or website if you know it.]`,
    `When: ${whenPhrase(c) ?? "[when you bought]"}`,
    "",
    "The law I believe applies (for context; I am not a lawyer):",
    ...(insider(c) ? insiderLaw(c) : [`${s17.label} makes it unlawful to promote a security in exchange for payment without fully disclosing that payment and its amount. ${s17.url}`]),
    ...(c.isCase && !insider(c)
      ? [
          "The SEC has already applied it to this token's promoters:",
          ...secLegal(c).map((l) => `- ${l.title}, ${longDate(l.date)}. ${l.outcome ?? ""} Law: ${l.statute ?? "n/a"}. ${l.sources.map((s) => s.url).join(" ")}`),
          "I am sending this as an investor who bought during that promotion, in case it helps any continuing investigation.",
        ]
      : []),
    "",
    "4. WHAT HAPPENED (in my words)",
    statement(c),
    "",
    ...(c.input.facts.purchases?.purchases.length ? ["5. MY PURCHASES, FROM THE ETHEREUM BLOCKCHAIN", purchaseList(c), ""] : []),
    ...(c.isCase && postsCited(c.input).length ? ["6. THE PROMOTIONS I AM REFERRING TO", postsSection(c), ""] : []),
    "7. SUPPORTING DOCUMENTS",
    evidenceSection(c),
    "",
    "8. OTHER AGENCIES",
    otherAgencies.length ? `I am also reporting this to: ${listing(otherAgencies)}.` : "I have not reported this to another agency yet.",
    "",
    "I declare that the information in this tip is true and correct to the best of my knowledge.",
  ].join("\n");
  return {
    kind: "sec",
    title: "Tip for the SEC",
    short: insider(c) ? "The US securities regulator. Market manipulation and securities fraud are its area." : "The US securities regulator. Paid promotion without disclosure is its area.",
    destination: { label: "Open the SEC tip form", url: tcr.url },
    body,
    filename: `canary-sec-tip-${c.input.id}.txt`,
  };
}

const AGENCY: Partial<Record<DocKind, string>> = {
  sec: "the SEC",
  ftc: "the Federal Trade Commission",
  state: "my state securities regulator",
  uk: "the FCA and Report Fraud",
  eu: "my national financial regulator",
  india: "India's National Cyber Crime Reporting Portal",
  generic: "my local police",
};

function ftcReport(c: Ctx): ClaimDoc {
  const f = c.input.facts;
  const ftc = ref("ftc");
  const how = f.wallet?.address ? `Cryptocurrency, from my own wallet ${f.wallet.address}` : f.wallet?.exchange ? `Cryptocurrency, bought through ${f.wallet.exchange}` : "Cryptocurrency [say how you paid]";
  const body = [
    header("Fraud report for the Federal Trade Commission (FTC)", { label: ftc.label, url: ftc.url }, c, [
      "The FTC's site asks short questions first, then gives you a box for the details. Use the lines below.",
    ]),
    "WHAT HAPPENED (short)",
    `I lost money after buying ${coinName(c)}, a crypto token${f.promoters?.matched.length ? ` that ${listing(f.promoters.matched)} promoted on social media` : " that I saw promoted"}.${
      insider(c)
        ? " The SEC later sued the people running this token for manipulating its market and misleading buyers; those are allegations, not findings."
        : c.isCase
          ? " The SEC later found that promoters of this token were paid and did not properly disclose it."
          : ""
    }`,
    "",
    "HOW I PAID",
    how,
    "",
    "HOW MUCH I LOST",
    f.amount ? (f.amount.value != null ? `About ${formatAmount(f.amount)} (my estimate)` : `"${f.amount.text}" (my words)`) : "[amount]",
    "",
    "WHEN",
    whenPhrase(c) ?? "[date]",
    "",
    "WHO WAS INVOLVED",
    ...(f.promoters?.matched.length
      ? f.promoters.matched.map((n) => {
          const p = c.k.posts.find((x) => x.promoter === n && x.handle);
          return `- ${n}${p ? `, ${p.handle} on ${PLATFORM[p.platform]}` : ""}`;
        })
      : [`- ${f.promoters?.text ? `"${f.promoters.text}" (my words)` : "[names, accounts, websites]"}`]),
    ...(insider(c) ? [`- The people running ${c.k.token.name}, whom the SEC has sued: ${listing(postAuthors(c).filter((n) => !/\(/.test(n)))}`] : c.isCase ? [`- ${c.k.token.name}, the token's issuer`] : []),
    "",
    ...(f.recoveryScam ? ["CONTACT AFTERWARDS", "Someone offered to recover my money for a fee. [Add who, when, and how they contacted you.]", ""] : []),
    "DETAILS (paste into the description box)",
    statement(c),
    ...(f.purchases?.purchases.length ? ["", "My purchases on the blockchain:", ...f.purchases.purchases.map((x) => `- ${longDate(x.at)}: ${x.txUrl}`)] : []),
    "",
    `Evidence file fingerprint (SHA-256): ${c.fingerprint}`,
  ].join("\n");
  return { kind: "ftc", title: "Report for the FTC", short: "The US consumer protection agency. It collects fraud reports for law enforcement.", destination: { label: "Open ReportFraud.ftc.gov", url: ftc.url }, body, filename: `canary-ftc-report-${c.input.id}.txt` };
}

function stateNote(c: Ctx): ClaimDoc {
  const f = c.input.facts;
  const nasaa = ref("nasaa");
  const state = f.place?.stateName ?? "[your state]";
  const body = [
    header(`Complaint for the ${state} securities regulator`, { label: nasaa.label, url: nasaa.url }, c, [
      `Each US state has its own securities regulator. NASAA's directory links to ${f.place?.stateName ? f.place.stateName + "'s" : "your state's"} office and its complaint form.`,
      "Your state attorney general's consumer protection office also takes complaints; you can send them the same text.",
    ]),
    `To: the securities regulator of ${state}`,
    `From: ${f.name ?? "[your name]"}${f.email ? `, ${f.email}` : ""}`,
    "",
    "What happened",
    statement(c),
    "",
    ...(f.purchases?.purchases.length ? ["My purchases on the Ethereum blockchain", purchaseList(c), ""] : []),
    ...(c.isCase
      ? [
          "Regulatory background",
          ...secLegal(c).map((l) => `- ${l.title}, ${longDate(l.date)}. ${l.summary} ${l.sources[0]?.url ?? ""}`),
          ...(c.k.classAction ? [`- A private class action is pending: ${c.k.classAction.name}, ${c.k.classAction.court}, No. ${c.k.classAction.docket}.`] : []),
          "",
        ]
      : []),
    "Evidence",
    evidenceSection(c),
  ].join("\n");
  return { kind: "state", title: `Note for your state regulator${f.place?.stateName ? ` (${f.place.stateName})` : ""}`, short: "Your state's securities office. Find it through NASAA's directory.", destination: { label: "Find your regulator (NASAA)", url: nasaa.url }, body, filename: `canary-state-regulator-${c.input.id}.txt` };
}

// ---------- outside the US: every provision, date and link below comes from ./law.ts ----------

const RULES_HEADING = "THE RULES I BELIEVE APPLY (for context; I am not a lawyer, and whether they cover these promotions is for the authority to decide)";

/** One cited provision: its citation, what it says, and the official source. */
function lawItem(l: LawRef, when?: string): string {
  return [`- ${l.cite}${when ? ` (${when})` : ""}.`, `  ${l.says}`, ...l.sources.map((s) => `  Source: ${s.label}. ${s.url}`)].join("\n");
}

/** Did the caller buy before a given day? true / false, or null when we can't tell. */
function boughtBefore(c: Ctx, iso: string): boolean | null {
  const f = c.input.facts;
  const day = f.purchases?.purchases[0]?.date ?? f.when?.date;
  if (day) return day < iso;
  if (f.when?.month) return f.when.month < iso.slice(0, 7) ? true : f.when.month > iso.slice(0, 7) ? false : null;
  return null;
}

const usBackground = (c: Ctx) =>
  c.isCase
    ? [
        insider(c)
          ? "Background: in the US, the SEC has sued the people who ran this token for fraud and market manipulation (allegations, not findings):"
          : "Background: in the US, the SEC fined promoters of this token for not disclosing they were paid:",
        ...secLegal(c).map((l) => `- ${l.title}, ${longDate(l.date)}. ${l.sources[0]?.url ?? ""}`),
        "",
      ]
    : [];

const squeeze = (lines: string[]) => lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

function ukReports(c: Ctx): ClaimDoc {
  const f = c.input.facts;
  const fca = law("uk-fca-report");
  const fcaUrl = fca.sources[0].url;
  const warn = law("uk-fca-warning-list");
  const rf = law("uk-report-fraud");
  const ps = ref("police-scotland");
  const regime = law("uk-crypto-promotions");
  const fg = law("uk-fg24-1");
  const scotland = f.place?.ukNation === "Scotland";
  const early = boughtBefore(c, regime.date!);
  const body = squeeze([
    header("Reports for the United Kingdom", { label: fca.cite, url: fcaUrl }, c, ["Two reports: one to the financial regulator, one to the police. You can use the same text for both."]),
    "1. FINANCIAL CONDUCT AUTHORITY (FCA)",
    `${fca.cite}: ${fcaUrl}`,
    fca.says,
    `${warn.cite}: ${warn.sources[0].url}. ${warn.says}`,
    "",
    "2. FRAUD REPORT TO THE POLICE",
    scotland ? `You live in Scotland: report fraud to Police Scotland by calling 101. ${ps.url}` : `${rf.cite}: ${rf.sources[0].url}`,
    scotland ? "Report Fraud covers England, Wales and Northern Ireland; in Scotland, fraud goes to Police Scotland." : rf.says,
    "",
    "WHAT TO WRITE (both reports)",
    statement(c),
    "",
    ...(f.purchases?.purchases.length ? ["My purchases on the Ethereum blockchain", purchaseList(c), ""] : []),
    RULES_HEADING,
    lawItem(law("uk-fsma-21")),
    lawItem(law("uk-fsma-25")),
    lawItem(regime, `the cryptoasset promotion rules, in force from ${longDate(regime.date!)}`),
    lawItem(law("uk-cobs-risk-warning")),
    lawItem(fg, `published ${longDate(fg.date!)}`),
    ...(early === true ? [`Note: I bought before ${longDate(regime.date!)}. The cryptoasset promotion rules did not yet apply to promotions made before that day.`] : []),
    ...(f.promoters?.matched.length || f.promoters?.text
      ? [`If the promotion I saw carried no risk warning${insider(c) ? "" : " and did not say it was paid for"}, I ask the FCA to look at whether it was an unapproved financial promotion.`]
      : []),
    "",
    ...usBackground(c),
    "Evidence",
    evidenceSection(c),
  ]);
  return {
    kind: "uk",
    title: "Reports for the FCA and Report Fraud",
    short: "The UK financial regulator (crypto promotions are its area) and the police's national fraud reporting service.",
    destination: { label: "Open the FCA's scam report", url: fcaUrl },
    body,
    filename: `canary-uk-reports-${c.input.id}.txt`,
  };
}

function euReport(c: Ctx): ClaimDoc {
  const f = c.input.facts;
  const nca = euAuthority(f.place);
  const country = f.place?.euState ? f.place.countryName : null;
  const mica = law("eu-mica");
  const esma = law("eu-esma-ncas");
  const early = boughtBefore(c, mica.date!);
  const title = `Complaint for ${nca.known ? nca.short : "your national financial regulator"}${country ? ` (${country})` : " (European Union)"}`;
  const body = squeeze([
    header(title, { label: nca.known ? nca.name : esma.cite, url: nca.url }, c, [
      nca.known
        ? `${/^the /i.test(nca.name) ? nca.name : `The ${nca.name}`} is the authority named in ESMA's list for crypto-asset market abuse in ${country}. Use its complaint or reporting page.`
        : `Each EU country names its own authority for crypto-assets. ${esma.cite}: ${esma.sources[0].url}`,
      "Report the fraud to your national police as well, and ask for a reference number.",
    ]),
    `To: ${nca.name}`,
    `From: ${f.name ?? "[your name]"}${f.email ? `, ${f.email}` : ""}`,
    "",
    "What happened",
    statement(c),
    "",
    ...(f.purchases?.purchases.length ? ["My purchases on the Ethereum blockchain", purchaseList(c), ""] : []),
    RULES_HEADING,
    lawItem(mica, `applies from ${longDate(mica.date!)}`),
    lawItem(law("eu-mica-86")),
    lawItem(law("eu-mica-91-2c")),
    lawItem(law("eu-mica-91-3c")),
    lawItem(law("eu-mica-88-89")),
    lawItem(law("eu-mica-7")),
    lawItem(law("eu-ucpd")),
    ...(early === true
      ? [`Note: I bought before ${longDate(mica.date!)}, when these MiCA rules began to apply, so they may not cover my purchase. The rule on paid promotion in the Unfair Commercial Practices Directive is older.`]
      : []),
    "",
    ...usBackground(c),
    "Evidence",
    evidenceSection(c),
  ]);
  return {
    kind: "eu",
    title: `Complaint for ${nca.known ? nca.short : "your national regulator"}${country ? ` (${country})` : ""}`,
    short: nca.known ? `${nca.name}: the authority for crypto-asset market abuse in ${country}.` : "Your country's financial regulator, found through ESMA's list.",
    destination: { label: nca.known ? `Open ${nca.short}'s page` : "Find your regulator (ESMA list)", url: nca.url },
    body,
    filename: `canary-eu-complaint-${c.input.id}.txt`,
  };
}

function indiaReport(c: Ctx): ClaimDoc {
  const f = c.input.facts;
  const portal = ref("india-cyber");
  const asci = law("in-asci-complaint");
  const vda = law("in-asci-vda");
  const infl = law("in-asci-influencer");
  const pmla = law("in-pmla-vda");
  const early = boughtBefore(c, vda.from!);
  const body = squeeze([
    header("Complaint for India's National Cyber Crime Reporting Portal", { label: portal.label, url: portal.url }, c, ["For financial fraud you can also call the national helpline 1930. Call as soon as you can."]),
    "Category: online financial fraud (cryptocurrency).",
    "",
    "What happened",
    statement(c),
    "",
    ...(f.purchases?.purchases.length ? ["My purchases on the Ethereum blockchain", purchaseList(c), ""] : []),
    "ALSO: A COMPLAINT ABOUT THE ADVERTISING",
    `${asci.cite}: ${asci.sources.map((s) => s.url).join(" ")}`,
    asci.says,
    "Use the \"What happened\" text above, and attach screenshots of the promotion you saw.",
    "",
    RULES_HEADING,
    lawItem(vda, `issued ${longDate(vda.date!)}; for ads released from ${longDate(vda.from!)}`),
    lawItem(infl, `issued ${longDate(infl.date!)}; in effect from ${longDate(infl.from!)}`),
    lawItem(pmla, `dated ${longDate(pmla.date!)}`),
    ...(f.wallet?.exchange ? [`I bought through ${f.wallet.exchange}. [If it served you in India, you can ask whether it is registered with FIU-IND.]`] : []),
    ...(early === true ? [`Note: I bought before ${longDate(vda.from!)}, so the crypto advertising guidelines may not cover the ads I saw.`] : []),
    "",
    ...usBackground(c),
    "Evidence",
    evidenceSection(c),
  ]);
  return { kind: "india", title: "Complaint for cybercrime.gov.in (and ASCI)", short: "India's national portal for cyber fraud, with the 1930 helpline; plus ASCI for the advertising.", destination: { label: "Open cybercrime.gov.in", url: portal.url }, body, filename: `canary-india-cybercrime-${c.input.id}.txt` };
}

function genericReport(c: Ctx): ClaimDoc {
  const f = c.input.facts;
  const body = [
    header("Complaint for your police or financial regulator", null, c, [
      `Take this to your local police and to the authority that regulates investments where you live${f.place?.countryName ? ` (${f.place.countryName})` : ""}. Ask for a reference number.`,
    ]),
    `From: ${f.name ?? "[your name]"}${f.email ? `, ${f.email}` : ""}`,
    "",
    "What happened",
    statement(c),
    "",
    ...(f.purchases?.purchases.length ? ["My purchases on the Ethereum blockchain", purchaseList(c), ""] : []),
    ...usBackground(c),
    "Evidence",
    evidenceSection(c),
  ].join("\n");
  return { kind: "generic", title: "Complaint for your police or regulator", short: "A general statement you can hand to any authority.", destination: null, body, filename: `canary-complaint-${c.input.id}.txt` };
}

/** Is this person possibly in a certified class? Only facts; the court's definition decides. */
export function classAssessment(c: Pick<Ctx, "input" | "k">): { inPeriod: boolean | null; certifiedState: boolean | null; verdict: "maybe-member" | "not-certified-state" | "outside-period" | "unknown" } {
  const ca = c.k.classAction;
  const f = c.input.facts;
  if (!ca) return { inPeriod: null, certifiedState: null, verdict: "unknown" };
  const chain = f.purchases?.purchases;
  const inPeriod = chain?.length
    ? chain.some((p) => p.inClassPeriod)
    : f.when?.date
      ? f.when.date >= ca.classPeriod.from && f.when.date <= ca.classPeriod.to
      : f.when?.month
        ? f.when.month >= ca.classPeriod.from.slice(0, 7) && f.when.month <= ca.classPeriod.to.slice(0, 7)
        : null;
  const certifiedState = f.place?.country === "US" && f.place.state ? ca.certifiedStates.includes(f.place.state) : f.place ? false : null;
  const verdict = inPeriod === false ? "outside-period" : certifiedState === false ? "not-certified-state" : inPeriod && certifiedState ? "maybe-member" : "unknown";
  return { inPeriod, certifiedState, verdict };
}

const STATE_NAMES: Record<string, string> = { CA: "California", FL: "Florida", NY: "New York", NJ: "New Jersey" };

function classActionNote(c: Ctx): ClaimDoc | null {
  const ca = c.k.classAction;
  if (!ca || !c.isCase) return null;
  const f = c.input.facts;
  const a = classAssessment(c);
  const history = c.k.legal.filter((l) => l.kind === "class-action").sort((x, y) => x.date.localeCompare(y.date));
  const states = ca.certifiedStates.map((s) => STATE_NAMES[s] ?? s);
  const courtListener = ca.sources.find((s) => /courtlistener/.test(s.url));
  const pacer = ref("pacer");
  const you: string[] = [];
  const chain = f.purchases?.purchases ?? [];
  if (chain.length) you.push(`- ${chain.filter((p) => p.inClassPeriod).length} of your ${chain.length} on-chain purchases fall between ${longDate(ca.classPeriod.from)} and ${longDate(ca.classPeriod.to)}.`);
  else if (f.when) you.push(`- You said you bought ${whenPhrase(c)}.`);
  if (f.place) you.push(`- You live in ${f.place.stateName ?? f.place.ukNation ?? f.place.countryName}.`);
  const verdict =
    a.verdict === "maybe-member"
      ? `You may be a member of one of the certified classes (${listing(states)} buyers). Only the court's exact class definition decides.`
      : a.verdict === "not-certified-state"
        ? `As of the latest report found, classes were certified only for buyers in ${listing(states)}, and a nationwide class was denied. So you do not appear to be in a certified class. A securities lawyer can tell you whether you have other options.`
        : a.verdict === "outside-period"
          ? "Your purchase dates appear to be outside the class period, so you may not be in the class. A securities lawyer can tell you whether you have other options."
          : `It isn't clear yet. Check your purchase dates against the class period, and whether you bought while living in ${listing(states)}.`;
  const body = [
    header("The EthereumMax class action: what it is, and whether it may cover you", null, c, ["Canary is not part of this lawsuit, does not represent anyone in it, and does not recommend lawyers."]),
    `Case: ${ca.name} (first filed as ${ca.formerName})`,
    `Court: ${ca.court}, No. ${ca.docket}. Judge: ${ca.judge}.`,
    `Class period: purchases from ${longDate(ca.classPeriod.from)} to ${longDate(ca.classPeriod.to)}, as the court's December 6, 2022 order describes it.`,
    `Latest status found: ${ca.status}`,
    "",
    "WHAT HAS HAPPENED SO FAR",
    ...history.map((l) => [`- ${l.date.length === 7 ? monthYear(l.date) : longDate(l.date)}: ${l.title}`, `  ${l.summary}${l.outcome ? ` ${l.outcome}` : ""}`, ...l.sources.map((s) => `  Source: ${s.label}. ${s.url}`)].join("\n")),
    "",
    "YOUR SITUATION",
    ...you,
    verdict,
    "News reports summarise the certified classes as buyers \"between May and June 2021\" in those states; the court's own order sets the exact definition.",
    "",
    "WHAT YOU CAN DO",
    `- Look the case up yourself: ${courtListener ? `CourtListener (free): ${courtListener.url}` : "CourtListener (free)"}, or ${pacer.label}: ${pacer.url}. The docket shows the case's latest filings.`,
    "- Or contact a securities lawyer of your choice and show them this note and your evidence file.",
    "- If someone contacts you about this case and asks you for money, check the court docket before you do anything.",
  ].join("\n");
  return { kind: "classAction", title: "Class action information", short: `${ca.name}: who it covers and how to look it up.`, destination: courtListener ? { label: "Open the docket on CourtListener", url: courtListener.url } : null, body, filename: `canary-class-action-${c.input.id}.txt` };
}

export function buildDocuments(input: ClaimInput, fingerprint: string): ClaimDoc[] {
  const c: Ctx = {
    input,
    k: input.kase,
    isCase: Boolean(input.facts.coin?.isCase),
    fingerprint,
    verifyUrl: `${(input.origin ?? "").replace(/\/$/, "")}/verify`,
  };
  const want = new Set(input.consents);
  const docs: ClaimDoc[] = [];
  if (want.has("sec")) docs.push(secTip(c));
  if (want.has("ftc")) docs.push(ftcReport(c));
  if (want.has("state")) docs.push(stateNote(c));
  if (want.has("uk")) docs.push(ukReports(c));
  if (want.has("eu")) docs.push(euReport(c));
  if (want.has("india")) docs.push(indiaReport(c));
  if (want.has("generic")) docs.push(genericReport(c));
  const ca = classActionNote(c);
  if (ca) docs.push(ca);
  return docs;
}
