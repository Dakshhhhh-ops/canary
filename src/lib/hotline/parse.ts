// Deterministic readers for what a caller says. No LLM needed: every answer the hotline understands is
// understood here, by rules a person can read. Browser-safe.

import { english as BIP39 } from "viem/accounts";

export const norm = (t: string) =>
  String(t ?? "")
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// ---------- small intents ----------

const DONT_KNOW = /\b(i )?(don'?t|do not|dont) (know|remember|recall|have (it|one|that))\b|\bnot sure\b|\bno idea\b|\bunsure\b|\bcan'?t remember\b|\bforgot\b|\bi forget\b/i;
const SKIP = /^(skip|pass|next|skip (it|that|this)|rather not( say)?|i'?d rather not( say)?|prefer not( to say)?|no thanks|none)\b/i;
export const isDontKnow = (t: string) => DONT_KNOW.test(t);
export const isSkip = (t: string) => SKIP.test(norm(t)) || /\b(skip (it|that|this)|rather not say|prefer not to say)\b/i.test(t);

const YES = /^(yes|yeah|yep|yup|ya|sure|ok|okay|alright|please|please do|do it|go ahead|go for it|correct|right|that'?s right|that'?s correct|absolutely|definitely|of course|y|sounds good|perfect|all good|looks good)\b/i;
const NO = /^(no|nope|nah|not now|not really|don'?t|do not|n|negative|wrong|that'?s wrong|not right|incorrect|change)\b/i;
export function yesNo(t: string): "yes" | "no" | null {
  const s = norm(t).replace(/^(um+|uh+|well|hmm+|so)[, ]+/i, "");
  if (YES.test(s)) return "yes";
  if (NO.test(s)) return "no";
  return null;
}

export const isRepeat = (t: string) => /^(what\??|sorry\??|pardon( me)?\??|huh\??|come again\??)$|\b(repeat( that)?|say (that|it) again|didn'?t (hear|catch)|one more time)\b/i.test(norm(t));
export const isWhy = (t: string) => /\b(why (do|would) you (need|want|ask)|what('?s| is) (that|this) for|why does (that|it) matter|why are you asking)\b/i.test(t);
export const isLegalAdviceQ = (t: string) => /\b(legal advice|are you a lawyer|is this a lawyer|should i (sue|get a lawyer)|can i sue|will i get (my )?money back|do i get (my )?money back)\b/i.test(t);
export const isStartOver = (t: string) => /\b(start (over|again)|restart|from the (start|beginning)|reset)\b/i.test(t);
export const isWhoAreYou = (t: string) => /\b(who are you|are you (a )?(real|human|person|robot|bot|ai)|what are you)\b/i.test(t);

// ---------- safety ----------

const BIP39_SET = new Set(BIP39);

export type SecretKind = "seed-phrase" | "private-key" | "password" | "offer";

/** Spots a secret (or an offer to share one) so the hotline can stop the caller before it is stored anywhere. */
export function detectSecret(text: string): SecretKind | null {
  const t = norm(text);
  const words = t.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length >= 12) {
    let run = 0;
    let best = 0;
    for (const w of words) {
      run = BIP39_SET.has(w) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    // 12+ wordlist words in a row is a recovery phrase, not a sentence
    if (best >= 12) return "seed-phrase";
  }
  if (/(^|[^0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(t)) return "private-key";
  if (/\b(seed|recovery|secret|backup|mnemonic)[ -]?(phrase|words?|key)\b[^.?!]{0,12}\b(is|are|:)\s*\S+/i.test(t)) return "seed-phrase";
  if (/\bprivate key\b[^.?!]{0,12}\b(is|:)\s*\S+/i.test(t)) return "private-key";
  if (/\b(password|passcode|pass code|pin|2fa code|verification code|one[- ]time code)\b[^.?!]{0,12}\b(is|:)\s*\S+/i.test(t)) return "password";
  if (/\b(do you|should i|shall i|want me to|can i|i can|i could|let me|i'?ll|i will|need)\b[^.?!]{0,30}\b(give|send|share|tell|read|type|paste)\b[^.?!]{0,25}\b(seed|recovery phrase|secret (phrase|words)|12 words|24 words|private key|password|passcode|pin)\b/i.test(t))
    return "offer";
  if (/\b(do|would|will) you (need|want)\b[^.?!]{0,20}\b(seed|recovery phrase|secret (phrase|words)|12 words|24 words|private key|password|passcode|pin)\b/i.test(t)) return "offer";
  return null;
}

/** Someone offering to "recover" lost crypto, usually for a fee: the classic follow-up scam. */
export function detectRecoveryScam(text: string): boolean {
  const t = norm(text);
  return (
    /\b(recovery|recover) (service|company|expert|agent|specialist|firm|team|hacker|lawyer)s?\b/i.test(t) ||
    /\basset recovery\b|\bfunds? recovery\b|\bcrypto recovery\b|\brecovery scam\b/i.test(t) ||
    /\b(get|got|bring|getting|recover|recovering|retrieve)\b[^.?!]{0,30}\b(money|funds|crypto|coins|it)\b[^.?!]{0,10}\bback\b[^.?!]{0,40}\b(fee|pay|paid|payment|charge|tax|deposit|upfront|advance)\b/i.test(t) ||
    /\b(fee|pay|paid|payment|charge|tax|deposit|upfront)\b[^.?!]{0,40}\b(recover|get (it|my money|my funds|my crypto) back|unlock|release)\b/i.test(t) ||
    /\b(withdrawal|unlock|release|gas|clearance) fee\b/i.test(t) ||
    /\bhacker\b[^.?!]{0,40}\b(recover|get .{0,15}back)\b/i.test(t)
  );
}

/** "No, it was June", "actually ...", "I meant ...": the caller is fixing something already said. */
export const isCorrection = (t: string) => /^(no+[,.!]?\s+(?!idea\b|clue\b|thanks?\b|problem\b|need\b)|nope[,.!]?\s+|actually\b|sorry,?\s+(i meant|it was|it'?s)|wait\b|correction\b|i meant\b|i mean\b|oops\b|make that\b|not\s+\w+[,]?\s+(it was|it'?s)\b)/i.test(norm(t));

// ---------- coin ----------

export const EMAX_RE = /\b(e[- ]?max|ethereum[ -]?max|eth[ -]?max|ethereummax|ethereum maximum)\b/i;
export const SAITAMA_RE = /\b(saitama(?:[ -]?inu)?|saitamainu)\b/i;

/** The coins Canary has a case file on: how a caller may name them, and how the documents name them. */
export const CASE_COINS: { slug: string; label: string; re: RegExp }[] = [
  { slug: "emax", label: "EthereumMax (EMAX)", re: EMAX_RE },
  { slug: "saitama", label: "Saitama Inu (SAITAMA)", re: SAITAMA_RE },
];
export const caseCoin = (t: string) => CASE_COINS.find((c) => c.re.test(t)) ?? null;

/** isCase: Canary has a case file on the coin; slug says which one. */
export type Coin = { text: string; isCase: boolean; slug?: string };

export function parseCoin(text: string): Coin | null {
  const t = norm(text);
  if (!t) return null;
  const known = caseCoin(t);
  if (known) return { text: known.label, isCase: true, slug: known.slug };
  const called = /\b(?:called|named|coin|token|bought|buying|into)\s+\$?([A-Z][\w.-]{1,24}|[a-z][\w.-]{2,24})/i.exec(t);
  const ticker = /\$([A-Za-z]{2,10})\b/.exec(t);
  const caps = /\b([A-Z]{3,8})\b/.exec(t);
  const stop = /^(a|an|the|some|this|that|it|crypto|coin|token|money|in|on|into|my|i|from|with|because|after)$/i;
  for (const m of [ticker, called, caps]) {
    const name = m?.[1];
    if (name && !stop.test(name)) return { text: name.replace(/[.,!?]+$/, ""), isCase: false };
  }
  // a short answer is probably just the name
  if (t.split(" ").length <= 4 && !/\b(lost|money|scam|help|hi|hello|hey)\b/i.test(t)) return { text: t.replace(/[.,!?]+$/, ""), isCase: false };
  return null;
}

// ---------- promoter ----------

/** Matches documented promoters by surname or first name ("Kim", "Kardashian", "Pierce", "Floyd"). */
export function parsePromoters(text: string, known: string[]): string[] {
  const t = norm(text);
  const out: string[] = [];
  for (const name of known) {
    const parts = name.replace(/\b(jr|sr|iii|ii)\.?$/i, "").trim().split(/\s+/);
    const first = parts[0];
    const last = parts[parts.length - 1];
    const re = new RegExp(`\\b(${escapeRe(last)}|${escapeRe(first)})\\b`, "i");
    if (re.test(t)) out.push(name);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- when ----------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

export type When = { text: string; month?: string; date?: string };

/** "mid June 2021" -> month 2021-06, approximate day 15. A year is assumed only when the caller gives one or the case fixes it. */
export function parseWhen(text: string, defaultYear?: number): When | null {
  const t = norm(text);
  const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(t);
  if (iso) return { text: t, month: `${iso[1]}-${iso[2]}`, date: iso[0] };
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(20\d\d|\d\d)\b/.exec(t); // US style m/d/y
  if (slash) {
    const y = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { text: t, month: `${y}-${pad2(m)}`, date: `${y}-${pad2(m)}-${pad2(d)}` };
  }
  const mm = MONTH_RE.exec(t);
  const yearM = /\b(20\d\d)\b/.exec(t);
  if (!mm && !yearM) return null;
  const year = yearM ? Number(yearM[1]) : defaultYear;
  if (!mm) return { text: t };
  const mIdx = MONTHS.findIndex((m) => m.startsWith(mm[1].toLowerCase().slice(0, 3)));
  if (!year) return { text: t };
  const month = `${year}-${pad2(mIdx + 1)}`;
  // a day number next to the month: "June 14", "14th of June", "the 14th"
  const after = new RegExp(`${mm[0]}\\s+(\\d{1,2})(st|nd|rd|th)?\\b`, "i").exec(t);
  const before = new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?\\s+(of\\s+)?${mm[0]}`, "i").exec(t);
  const day = Number(after?.[1] ?? before?.[1] ?? NaN);
  if (day >= 1 && day <= 31) return { text: t, month, date: `${month}-${pad2(day)}` };
  if (/\b(early|beginning|start)\b/i.test(t)) return { text: t, month, date: `${month}-05` };
  if (/\b(mid|middle)\b/i.test(t)) return { text: t, month, date: `${month}-15` };
  if (/\b(late|end)\b/i.test(t)) return { text: t, month, date: `${month}-25` };
  return { text: t, month };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// ---------- amount ----------

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, half: 0.5,
};

function wordsToNumber(s: string): number | null {
  const words = s.toLowerCase().replace(/-/g, " ").split(/\s+/).filter((w) => w && w !== "and");
  let total = 0;
  let cur = 0;
  let seen = false;
  for (const w of words) {
    if (w in NUM_WORDS) {
      cur += NUM_WORDS[w];
      seen = true;
    } else if (w === "hundred") cur = (cur || 1) * 100;
    else if (w === "thousand" || w === "grand") {
      total += (cur || 1) * 1000;
      cur = 0;
      seen = true;
    } else if (w === "million") {
      total += (cur || 1) * 1e6;
      cur = 0;
      seen = true;
    } else if (seen) break;
  }
  return seen ? total + cur : null;
}

export type Amount = { text: string; value?: number; currency?: string };

const CURRENCIES: [RegExp, string][] = [
  [/\$|\busd\b|\bdollars?\b|\bbucks\b/i, "USD"],
  [/£|\bgbp\b|\bpounds?\b|\bquid\b/i, "GBP"],
  [/€|\beur\b|\beuros?\b/i, "EUR"],
  [/₹|\binr\b|\brupees?\b|\brs\.?\b/i, "INR"],
  [/\bcad\b|\bcanadian dollars?\b/i, "CAD"],
  [/\baud\b|\baustralian dollars?\b/i, "AUD"],
  [/\beth\b|\bether\b/i, "ETH"],
];

export function parseAmount(text: string): Amount | null {
  const t = norm(text);
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|grand|m|million|mil|lakh|lakhs|crore)?\b/i.exec(t.replace(/(\d),(\d{3})/g, "$1$2"));
  let value: number | null = null;
  if (m) {
    value = Number(m[1].replace(/,/g, ""));
    const mult = (m[2] ?? "").toLowerCase();
    if (mult === "k" || mult === "thousand" || mult === "grand") value *= 1000;
    else if (mult === "m" || mult === "million" || mult === "mil") value *= 1e6;
    else if (mult.startsWith("lakh")) value *= 1e5;
    else if (mult === "crore") value *= 1e7;
  } else value = wordsToNumber(t);
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  let currency = CURRENCIES.find(([re]) => re.test(t))?.[1];
  // "US dollars" vs "canadian dollars" handled by order; plain "dollars" = USD
  if (/\bcanadian\b/i.test(t)) currency = "CAD";
  if (/\baustralian\b/i.test(t)) currency = "AUD";
  return { text: t, value: Math.round(value * 100) / 100, currency };
}

export function formatAmount(a: Amount): string {
  if (a.value == null) return a.text;
  const sym: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", INR: "₹" };
  const n = a.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a.currency && sym[a.currency]) return `${sym[a.currency]}${n}`;
  if (a.currency) return `${n} ${a.currency}`;
  return n;
}

// ---------- where ----------

export const US_STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"], ["PR", "Puerto Rico"],
];

export type Country = "US" | "UK" | "EU" | "IN" | "other";
export type Place = {
  text: string;
  country: Country;
  countryName: string;
  state?: string;
  stateName?: string;
  ukNation?: "England" | "Scotland" | "Wales" | "Northern Ireland";
  /** ISO 3166 code of the EU member state (country === "EU") */
  euState?: string;
};

/**
 * EU member states, with a few big cities, so "Berlin" or "from Paris" routes to the right national regulator.
 * Checked after the UK, so "Northern Ireland" stays in the UK.
 */
export const EU_STATES: { code: string; name: string; re: RegExp }[] = [
  { code: "DE", name: "Germany", re: /\b(germany|deutschland|berlin|munich|m(?:u|ü)nchen|frankfurt|hamburg|cologne|k(?:o|ö)ln)\b/i },
  { code: "FR", name: "France", re: /\b(france|paris|lyon|marseille|toulouse)\b/i },
  { code: "IE", name: "Ireland", re: /\b((?:republic of )?ireland|dublin|cork|galway)\b/i },
  { code: "NL", name: "Netherlands", re: /\b(the netherlands|netherlands|holland|amsterdam|rotterdam|the hague|utrecht)\b/i },
  { code: "ES", name: "Spain", re: /\b(spain|españa|madrid|barcelona|valencia|seville)\b/i },
  { code: "IT", name: "Italy", re: /\b(italy|italia|rome|milan|naples|turin)\b/i },
  { code: "AT", name: "Austria", re: /\b(austria|vienna)\b/i },
  { code: "BE", name: "Belgium", re: /\b(belgium|brussels|antwerp)\b/i },
  { code: "BG", name: "Bulgaria", re: /\b(bulgaria|sofia)\b/i },
  { code: "HR", name: "Croatia", re: /\b(croatia|zagreb)\b/i },
  { code: "CY", name: "Cyprus", re: /\b(cyprus|nicosia|limassol)\b/i },
  { code: "CZ", name: "Czechia", re: /\b(czechia|czech republic|prague)\b/i },
  { code: "DK", name: "Denmark", re: /\b(denmark|copenhagen)\b/i },
  { code: "EE", name: "Estonia", re: /\b(estonia|tallinn)\b/i },
  { code: "FI", name: "Finland", re: /\b(finland|helsinki)\b/i },
  { code: "GR", name: "Greece", re: /\b(greece|athens)\b/i },
  { code: "HU", name: "Hungary", re: /\b(hungary|budapest)\b/i },
  { code: "LV", name: "Latvia", re: /\b(latvia|riga)\b/i },
  { code: "LT", name: "Lithuania", re: /\b(lithuania|vilnius)\b/i },
  { code: "LU", name: "Luxembourg", re: /\b(luxembourg)\b/i },
  { code: "MT", name: "Malta", re: /\b(malta|valletta)\b/i },
  { code: "PL", name: "Poland", re: /\b(poland|warsaw|krak(?:o|ó)w)\b/i },
  { code: "PT", name: "Portugal", re: /\b(portugal|lisbon|porto)\b/i },
  { code: "RO", name: "Romania", re: /\b(romania|bucharest)\b/i },
  { code: "SK", name: "Slovakia", re: /\b(slovakia|bratislava)\b/i },
  { code: "SI", name: "Slovenia", re: /\b(slovenia|ljubljana)\b/i },
  { code: "SE", name: "Sweden", re: /\b(sweden|stockholm)\b/i },
];

export const euPlace = (code: string, text = ""): Place => {
  const s = EU_STATES.find((x) => x.code === code);
  return s ? { text, country: "EU", countryName: s.name, euState: s.code } : { text, country: "EU", countryName: "the European Union" };
};

const CITY_STATE: [RegExp, string][] = [
  [/\b(nyc|new york city|brooklyn|manhattan|queens|the bronx)\b/i, "NY"],
  [/\b(los angeles|san francisco|san diego|\bla\b|bay area)\b/i, "CA"],
  [/\b(miami|orlando|tampa)\b/i, "FL"],
  [/\b(chicago)\b/i, "IL"],
  [/\b(houston|dallas|austin)\b/i, "TX"],
  [/\b(boston)\b/i, "MA"],
  [/\b(seattle)\b/i, "WA"],
  [/\b(newark|jersey city)\b/i, "NJ"],
];

export function parsePlace(text: string): Place | null {
  const t = norm(text);
  // longest names first, so "West Virginia" wins over "Virginia" and "New Mexico" over "Mexico"
  const byLength = [...US_STATES].sort((a, b) => b[1].length - a[1].length);
  for (const [code, name] of byLength) {
    if (code === "WA" && /\bwashington,? d\.?c\.?\b/i.test(t)) return { text: t, country: "US", countryName: "United States", state: "DC", stateName: "District of Columbia" };
    if (new RegExp(`\\b${name}\\b`, "i").test(t)) return { text: t, country: "US", countryName: "United States", state: code, stateName: name };
  }
  for (const [re, code] of CITY_STATE)
    if (re.test(t)) return { text: t, country: "US", countryName: "United States", state: code, stateName: US_STATES.find((s) => s[0] === code)![1] };
  // two-letter codes only when written in capitals ("NY", "in NJ") — "in", "me", "or" are ordinary words
  const code = /\b([A-Z]{2})\b/.exec(text);
  if (code && code[1] !== "UK" && code[1] !== "US") {
    const s = US_STATES.find((x) => x[0] === code[1]);
    if (s) return { text: t, country: "US", countryName: "United States", state: s[0], stateName: s[1] };
  }
  if (/\b(scotland|edinburgh|glasgow)\b/i.test(t)) return { text: t, country: "UK", countryName: "United Kingdom", ukNation: "Scotland" };
  if (/\b(wales|cardiff)\b/i.test(t)) return { text: t, country: "UK", countryName: "United Kingdom", ukNation: "Wales" };
  if (/\b(northern ireland|belfast)\b/i.test(t)) return { text: t, country: "UK", countryName: "United Kingdom", ukNation: "Northern Ireland" };
  if (/\b(england|london|manchester|birmingham|leeds|liverpool|bristol)\b/i.test(t)) return { text: t, country: "UK", countryName: "United Kingdom", ukNation: "England" };
  if (/\b(uk|u\.k\.|united kingdom|britain|great britain)\b/i.test(t)) return { text: t, country: "UK", countryName: "United Kingdom" };
  if (/\b(india|mumbai|delhi|bangalore|bengaluru|chennai|kolkata|hyderabad|pune)\b/i.test(t)) return { text: t, country: "IN", countryName: "India" };
  for (const eu of EU_STATES) if (eu.re.test(t)) return { text: t, country: "EU", countryName: eu.name, euState: eu.code };
  if (/\b(european union|the eu|eu)\b/i.test(t)) return { text: t, country: "EU", countryName: "the European Union" };
  if (/\b(us|u\.s\.|usa|u\.s\.a\.|united states|america|the states)\b/i.test(t)) return { text: t, country: "US", countryName: "United States" };
  const other = /\b(canada|australia|switzerland|norway|nigeria|kenya|south africa|singapore|philippines|mexico|brazil|japan|new zealand|uae|dubai|pakistan|bangladesh)\b/i.exec(t);
  if (other) return { text: t, country: "other", countryName: titleCase(other[1]) };
  return null;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUae\b/, "UAE");

/**
 * A place mentioned in passing ("I'm in London", "I live in Berlin", "from Mumbai"), at any point in the call.
 * Needs a clear "I live / I'm in / from" cue, so a promoter's name or a coin's name is never read as an address.
 */
export function mentionedPlace(text: string): Place | null {
  const t = norm(text);
  const cue = /\b(?:i'?m (?:in|from|based in|living in)|i am (?:in|from|based in|living in)|i live in|i'?m a resident of|i reside in|living in|based in|here in|calling from|writing from)\s+([^.?!;,]{2,40})/i.exec(t);
  const lead = /^(?:from|in)\s+([^.?!;]{2,40})$/i.exec(t);
  const where = cue?.[1] ?? lead?.[1];
  if (!where) return null;
  // only the words right after the cue: "I'm in London and I bought EMAX" -> "London"
  const p = parsePlace(where.split(/\b(?:and|but|where|when|because|so|after|i)\b/i)[0]);
  return p ? { ...p, text: t } : null;
}

// ---------- identity (stays in the browser) ----------

export const parseEmail = (t: string) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(t.replace(/\s+at\s+/i, "@").replace(/\s+dot\s+/gi, "."))?.[0] ?? null;

export function parseName(text: string): string | null {
  const t = norm(text)
    .replace(/^(my name is|my name's|i am|i'm|it's|it is|this is|call me|name:?)\s+/i, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (!t || t.length > 80 || /\d|@/.test(t)) return null;
  if (t.split(" ").length > 5) return null;
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- exchange ----------

const EXCHANGES = ["Coinbase", "Binance", "Kraken", "Robinhood", "Crypto.com", "Gemini", "KuCoin", "OKX", "Bybit", "Gate.io", "Bitstamp", "Bitfinex", "Huobi", "HTX", "eToro", "Revolut", "Cash App", "PayPal", "WazirX", "CoinDCX", "Uphold", "MEXC", "Bitget"];

export function parseExchange(text: string): string | null {
  const t = norm(text);
  for (const e of EXCHANGES) if (new RegExp(`\\b${escapeRe(e).replace("\\.", "\\.?\\s?")}\\b`, "i").test(t)) return e;
  return null;
}

export const mentionsExchange = (t: string) =>
  parseExchange(t) != null || /\b(exchange|an app|the app|trading app|brokerage|broker|account on|bought (it )?on)\b/i.test(t);

/** Self-custody wallets: if they name one, they *do* have an address. */
export const mentionsWalletApp = (t: string) => /\b(metamask|trust wallet|coinbase wallet|ledger|trezor|rainbow|phantom|exodus)\b/i.test(t);
