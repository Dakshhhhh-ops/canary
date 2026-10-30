// Doki's hotline conversation: a deterministic state machine that a voice or text UI drives.
// It works with no LLM at all. Every answer is read by the rules in ./parse; an optional LLM can only
// *suggest* structured fields (see ./extract), and those are checked against the case file before use.
//
// Pure and browser-safe: the call screen runs it locally, so a caller's name and email never leave the device.

import { paidPost, documentedBy, inClassPeriod, promoters as casePromoters, type HotlineCase } from "./caseFacts";
import {
  detectRecoveryScam,
  detectSecret,
  formatAmount,
  isCorrection,
  isDontKnow,
  isLegalAdviceQ,
  isRepeat,
  isSkip,
  isStartOver,
  isWhoAreYou,
  isWhy,
  mentionsExchange,
  mentionsWalletApp,
  norm,
  parseAmount,
  parseCoin,
  parseEmail,
  parseExchange,
  parseName,
  parsePlace,
  parsePromoters,
  parseWhen,
  yesNo,
  EMAX_RE,
  type Amount,
  type Place,
  type When,
} from "./parse";
import { checkAddress, findAddress, humanTokens, type NoWalletRecord, type PurchaseReport } from "./purchases";

export type DokiMood = "idle" | "wave" | "talk" | "think" | "alarm" | "happy" | "point";

export type StepId =
  | "coin"
  | "promoter"
  | "when"
  | "wallet"
  | "exchange"
  | "checking"
  | "amount"
  | "location"
  | "state"
  | "name"
  | "email"
  | "summary"
  | "fix"
  | "consent"
  | "done";

export type DocKind = "sec" | "ftc" | "state" | "uk" | "india" | "generic" | "classAction" | "evidence";

export type Facts = {
  coin?: { text: string; isCase: boolean };
  promoters?: { text: string; matched: string[] };
  when?: When;
  wallet?: { address?: string; exchange?: string; none?: boolean; text?: string };
  purchases?: PurchaseReport;
  noWallet?: NoWalletRecord;
  purchaseCheck?: "pending" | "done" | "failed";
  amount?: Amount;
  place?: Place;
  name?: string;
  email?: string;
  recoveryScam?: boolean;
};

export type HotlineState = {
  v: 1;
  caseSlug: string;
  step: StepId;
  facts: Facts;
  skipped: StepId[];
  consentQueue: DocKind[];
  consents: Partial<Record<DocKind, boolean>>;
  returnTo?: StepId;
  misses: number;
  lastSay: string[];
  secretsBlocked: number;
};

export type Reply = {
  say: string[]; // short sentences, spoken one by one
  mood: DokiMood;
  suggestions: string[];
  step: StepId;
  progress: number; // index into PROGRESS
  inputHint?: "address" | "email" | "name" | "text";
  action?: { type: "check-wallet"; address: string } | { type: "make-claim" };
  /** the caller's last message held a secret: the UI must not show or keep it */
  redactUser?: boolean;
  alert?: "secret" | "recovery";
  /** no rule understood the answer (the UI may ask the optional LLM extractor, then call respond again) */
  unclear?: boolean;
};

export type Turn = { state: HotlineState; reply: Reply };

export const PROGRESS: { label: string; steps: StepId[] }[] = [
  { label: "What happened", steps: ["coin", "promoter", "when"] },
  { label: "Your purchase", steps: ["wallet", "exchange", "checking"] },
  { label: "Amount & where", steps: ["amount", "location", "state", "name", "email"] },
  { label: "Check & agree", steps: ["summary", "fix", "consent"] },
  { label: "Claim pack", steps: ["done"] },
];
export const progressOf = (step: StepId) => Math.max(0, PROGRESS.findIndex((p) => p.steps.includes(step)));

/** Fields an optional extractor may hand in (already validated by ./extract). */
export type Extracted = Partial<{ coin: string; promoters: string[]; when: When; amount: Amount; place: Place }>;

// ---------- words ----------

const RECOVERY_WARNING = [
  "Wait, one important thing.",
  "People who promise to get crypto back for a fee are almost always scammers too.",
  "Real regulators never charge you. Please don't pay them, and don't share anything with them.",
];

const SECRET_STOP: Record<string, string[]> = {
  "seed-phrase": [
    "Stop there, please. Those words are the keys to your wallet.",
    "I didn't save them, and I've removed them from this screen.",
    "Never share them with anyone, including me. If you've ever typed them into a website or sent them to someone, move what's left to a new wallet.",
  ],
  "private-key": [
    "Stop there, please. That looks like a private key, the master password to a wallet.",
    "I didn't save it, and I've removed it from this screen.",
    "Never share it with anyone. I only ever need your public address, the one that starts with 0x and is 42 characters long.",
  ],
  password: [
    "Please don't tell me passwords or codes.",
    "I didn't save it, and I've removed it from this screen.",
    "Nobody honest needs them to help you, and I never will.",
  ],
  offer: [
    "No need, and please don't.",
    "I'll never ask for your secret words, private keys, passwords or codes. Anyone who does is trying to rob you.",
  ],
};

const WHY: Partial<Record<StepId, string>> = {
  coin: "Knowing the coin tells me whether Canary already has a verified case file on it.",
  promoter: "Regulators want to know who pushed you to buy. Paid promotion that isn't disclosed is illegal.",
  when: "Dates matter: they show whether you bought right after a promoter's post, and whether you're inside a lawsuit's class period.",
  wallet: "Your public address lets me read your purchases straight from the blockchain. It's public anyway, and it can't be used to take anything.",
  exchange: "The exchange keeps the record of your purchase, so it's where your proof is.",
  amount: "Regulators and lawyers will ask how much you lost. Your own estimate is fine.",
  location: "Where you live decides which regulator handles your complaint, and whether a class action covers you.",
  state: "Each US state has its own securities regulator, and the class action only covers some states.",
  name: "Your name goes only on your own documents. It stays on this device.",
  email: "Your email goes only on your own documents, so the regulator can reply. It stays on this device.",
  summary: "I want to be sure your documents say exactly what happened.",
  consent: "Nothing is sent without your OK. I only draft documents; you review and file them yourself.",
};

const EXAMPLES: Partial<Record<StepId, string>> = {
  coin: "Just the coin's name is fine, like EthereumMax.",
  promoter: "For example, a celebrity's post, a YouTube video, a friend, or a group chat.",
  when: "A month and year is enough, like June 2021.",
  amount: "A rough number is fine, like about 500 dollars.",
  location: "Your state or your country, like New York, or the UK.",
  state: "Just the state's name, like Texas.",
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const longDate = (iso: string) =>
  new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthName = (ym: string) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function docLabel(kind: DocKind, f: Facts): string {
  switch (kind) {
    case "sec":
      return "a tip for the SEC, the US securities regulator";
    case "ftc":
      return "a fraud report for the FTC, the US consumer protection agency";
    case "state":
      return `a note for ${f.place?.stateName ? f.place.stateName + "'s" : "your state's"} securities regulator`;
    case "uk":
      return "reports for the FCA and Action Fraud";
    case "india":
      return "a complaint for India's national cybercrime portal";
    case "generic":
      return "a general complaint you can give to your police or financial regulator";
    case "classAction":
      return "a note about the class action";
    case "evidence":
      return "your evidence file";
  }
}

/** Which complaints apply, from where the caller lives and whether Canary has the case. */
export function complaintsFor(f: Facts): DocKind[] {
  const out: DocKind[] = [];
  const country = f.place?.country;
  if (f.coin?.isCase || country === "US") out.push("sec");
  if (country === "US") out.push("ftc", "state");
  if (country === "UK") out.push("uk");
  if (country === "IN") out.push("india");
  if (!country || country === "other") out.push("generic");
  return out;
}

// ---------- state helpers ----------

const ORDER: StepId[] = ["coin", "promoter", "when", "wallet", "amount", "location", "name", "email", "summary", "consent", "done"];

function fresh(k: HotlineCase): HotlineState {
  return { v: 1, caseSlug: k.slug, step: "coin", facts: {}, skipped: [], consentQueue: [], consents: {}, misses: 0, lastSay: [], secretsBlocked: 0 };
}

const clone = (s: HotlineState): HotlineState => JSON.parse(JSON.stringify(s));

function nextAfter(s: HotlineState, step: StepId): StepId {
  if (s.returnTo) {
    const r = s.returnTo;
    s.returnTo = undefined;
    return r;
  }
  const base: StepId = step === "exchange" || step === "checking" ? "wallet" : step === "state" ? "location" : step === "fix" ? "summary" : step;
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(base) + 1)];
}

type Ask = { say: string[]; mood: DokiMood; suggestions: string[]; inputHint?: Reply["inputHint"]; action?: Reply["action"] };

function ask(s: HotlineState, k: HotlineCase): Ask {
  const f = s.facts;
  switch (s.step) {
    case "coin":
      return { say: ["Which coin did you buy?"], mood: "talk", suggestions: ["EthereumMax (EMAX)", "A different coin", "I don't remember"] };
    case "promoter": {
      const names = f.coin?.isCase ? casePromoters(k) : [];
      return {
        say: ["Who or what made you want to buy it?"],
        mood: "talk",
        suggestions: [...names.map((n) => `${n}'s posts`), "A friend or a group chat", "I don't remember"],
      };
    }
    case "when":
      return {
        say: ["When did you buy it? A month is enough."],
        mood: "talk",
        suggestions: f.coin?.isCase ? ["Late May 2021", "Early June 2021", "Mid June 2021", "I don't remember"] : ["Last month", "Earlier this year", "I don't remember"],
      };
    case "wallet":
      return {
        say: [
          "Do you have the wallet address you bought with? It starts with 0x.",
          "Paste it in the box. I only need the public address, never your secret words.",
        ],
        mood: "point",
        suggestions: ["I bought on an exchange", "I don't know my address"],
        inputHint: "address",
      };
    case "exchange":
      return { say: ["Which exchange or app did you use?"], mood: "talk", suggestions: ["Coinbase", "Binance", "Robinhood", "Crypto.com", "I don't remember"] };
    case "checking":
      return { say: ["I'm still checking the blockchain. One moment."], mood: "think", suggestions: [] };
    case "amount": {
      const est = f.purchases?.totals.boughtUsd;
      return {
        say: ["How much money did you lose, in your own words?"],
        mood: "talk",
        suggestions: [...(est ? [`About ${usd(est)}`] : []), "About $500", "About $5,000", "I'm not sure"],
      };
    }
    case "location":
      return {
        say: ["Where do you live? Your state or country tells me which regulator to write to."],
        mood: "talk",
        suggestions: ["New York", "California", "Texas", "United Kingdom", "India", "Somewhere else"],
      };
    case "state":
      return { say: ["Which state?"], mood: "talk", suggestions: ["New York", "California", "Florida", "New Jersey", "Texas"] };
    case "name":
      return {
        say: ["Two optional questions, just for your documents. They stay on this device.", "What name should go on them? Or say skip."],
        mood: "talk",
        suggestions: ["Skip"],
        inputHint: "name",
      };
    case "email":
      return { say: ["And an email address for the documents? Also optional."], mood: "talk", suggestions: ["Skip"], inputHint: "email" };
    case "summary":
      return { say: [...summaryLines(s, k), "Is that right?"], mood: "point", suggestions: ["Yes, that's right", "Change something"] };
    case "fix":
      return {
        say: ["What should I change? The coin, the person, the date, the wallet, the amount, or where you live?"],
        mood: "talk",
        suggestions: ["The date", "The amount", "Where I live", "The person", "The wallet"],
      };
    case "consent": {
      const kind = s.consentQueue[0];
      return {
        say: [`Shall I draft ${docLabel(kind, f)}? You'll read it before anything is sent.`],
        mood: "talk",
        suggestions: ["Yes", "No"],
      };
    }
    case "done":
      return {
        say: ["Your claim pack is ready. Tap the button to open it."],
        mood: "happy",
        suggestions: [],
        action: { type: "make-claim" },
      };
  }
}

/** The read-back, in short spoken sentences. Only what the caller said and what the blockchain showed. */
export function summaryLines(s: HotlineState, k: HotlineCase): string[] {
  const f = s.facts;
  const out: string[] = ["Here's what I have."];
  out.push(f.coin ? `You bought ${f.coin.isCase ? k.token.name : f.coin.text}.` : "We don't know the coin's name yet.");
  if (f.promoters?.matched.length) out.push(`You bought after seeing ${list(f.promoters.matched)}.`);
  else if (f.promoters?.text) out.push(`What made you buy, in your words: "${f.promoters.text}".`);
  if (f.when) out.push(`You bought ${f.when.month && !f.when.date ? "in " + monthName(f.when.month) : `around ${f.when.date ? longDate(f.when.date) : f.when.text}`}.`);
  if (f.purchases && f.purchases.purchases.length)
    out.push(`The blockchain shows ${f.purchases.purchases.length} purchase${f.purchases.purchases.length === 1 ? "" : "s"} from wallet ${shortAddr(f.purchases.address)}.`);
  else if (f.wallet?.address) out.push(`Your wallet is ${shortAddr(f.wallet.address)}.`);
  else if (f.wallet?.exchange) out.push(`You bought on ${f.wallet.exchange}.`);
  if (f.amount) out.push(f.amount.value != null ? `You lost about ${formatAmount(f.amount)}.` : `About the money: "${f.amount.text}".`);
  if (f.place) out.push(`You live in ${f.place.stateName ?? f.place.ukNation ?? f.place.countryName}.`);
  if (f.name) out.push(`Name on the documents: ${f.name}.`);
  return out;
}

function reply(s: HotlineState, k: HotlineCase, pre: string[] = [], extra: Partial<Reply> = {}): Turn {
  const a = ask(s, k);
  const say = [...pre, ...a.say];
  s.lastSay = say;
  return {
    state: s,
    reply: {
      say,
      mood: extra.mood ?? a.mood,
      suggestions: a.suggestions,
      step: s.step,
      progress: progressOf(s.step),
      inputHint: a.inputHint,
      action: a.action,
      ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "mood")),
    },
  };
}

function go(s: HotlineState, k: HotlineCase, step: StepId, pre: string[] = [], extra: Partial<Reply> = {}): Turn {
  s.step = step;
  s.misses = 0;
  if (step === "consent" && !s.consentQueue.length) s.consentQueue = complaintsFor(s.facts).filter((d) => s.consents[d] === undefined);
  if (step === "consent" && !s.consentQueue.length) s.step = "done";
  return reply(s, k, pre, extra);
}

const advance = (s: HotlineState, k: HotlineCase, from: StepId, pre: string[] = [], extra: Partial<Reply> = {}) => go(s, k, nextAfter(s, from), pre, extra);

function skip(s: HotlineState, k: HotlineCase, from: StepId, pre: string[] = []): Turn {
  if (!s.skipped.includes(from)) s.skipped.push(from);
  return advance(s, k, from, pre.length ? pre : ["That's okay."]);
}

function miss(s: HotlineState, k: HotlineCase, pre: string[] = []): Turn {
  s.misses += 1;
  const ex = EXAMPLES[s.step];
  return reply(s, k, [...pre, "Sorry, I didn't quite get that.", ...(ex ? [ex] : [])], { unclear: true });
}

// ---------- public API ----------

export function startCall(k: HotlineCase): Turn {
  const s = fresh(k);
  return reply(
    s,
    k,
    [
      "Hi, I'm Doki, Canary's hotline helper.",
      "I'm sorry you lost money. Let's work through it together.",
      "I'll ask short questions, one at a time. Talk or type, and say skip whenever you like.",
      "I'm not a lawyer, and this isn't legal advice. And I'll never ask for passwords or secret words.",
    ],
    { mood: "wave" },
  );
}

const stripCorrection = (t: string) =>
  t.replace(/^(no+[,.!]?\s+|nope[,.!]?\s+|actually,?\s+|sorry,?\s+|wait,?\s+|correction:?\s+|i meant\s+|i mean\s+|oops,?\s+|make that\s+)/i, "").replace(/^(it was|it's|it is)\s+/i, "");

type Field = "coin" | "promoter" | "when" | "wallet" | "amount" | "place";
const STEP_FIELD: Partial<Record<StepId, Field>> = { coin: "coin", promoter: "promoter", when: "when", wallet: "wallet", exchange: "wallet", amount: "amount", location: "place", state: "place" };

/** Which earlier answer a correction is about, judged by what it contains. */
function correctionField(t: string, k: HotlineCase, s: HotlineState): Field | null {
  if (findAddress(t)) return "wallet";
  const w = parseWhen(t, s.facts.coin?.isCase ? 2021 : undefined);
  if (w?.month) return "when";
  if (parsePromoters(t, casePromoters(k)).length) return "promoter";
  if (parsePlace(t)) return "place";
  if (/[$£€₹]|\b(dollars?|pounds?|euros?|rupees?|lost|spent|paid)\b/i.test(t) && parseAmount(t)) return "amount";
  if (EMAX_RE.test(t)) return "coin";
  return null;
}

function applyField(s: HotlineState, k: HotlineCase, field: Field, t: string): string | null {
  const f = s.facts;
  switch (field) {
    case "when": {
      const w = parseWhen(t, f.coin?.isCase ? 2021 : undefined);
      if (!w) return null;
      f.when = w;
      return `the date to ${w.date ? longDate(w.date) : w.month ? monthName(w.month) : w.text}`;
    }
    case "promoter": {
      const m = parsePromoters(t, casePromoters(k));
      if (!m.length) return null;
      f.promoters = { text: t, matched: m };
      return `the person to ${list(m)}`;
    }
    case "place": {
      const p = parsePlace(t);
      if (!p) return null;
      f.place = p;
      s.consentQueue = [];
      return `where you live to ${p.stateName ?? p.ukNation ?? p.countryName}`;
    }
    case "amount": {
      const a = parseAmount(t);
      if (!a) return null;
      f.amount = a;
      return `the amount to ${formatAmount(a)}`;
    }
    case "coin": {
      const c = parseCoin(t);
      if (!c) return null;
      f.coin = c;
      return `the coin to ${c.text}`;
    }
    case "wallet":
      return null; // a new address needs a fresh blockchain check: handled by the wallet step
  }
}

/** Handle one thing the caller said (spoken or typed). */
export function respond(prev: HotlineState, raw: string, k: HotlineCase, opts: { extracted?: Extracted } = {}): Turn {
  const s = clone(prev);
  const text = norm(raw).slice(0, 2000);
  if (!text) return reply(s, k, ["I didn't hear anything."]);

  // 1. Safety first: a secret is never parsed, stored or echoed.
  const secret = detectSecret(text);
  if (secret) {
    s.secretsBlocked += 1;
    return reply(s, k, [...SECRET_STOP[secret], "Let's carry on."], { mood: "alarm", redactUser: secret !== "offer", alert: "secret" });
  }
  const pre: string[] = [];
  let alarm = false;
  if (detectRecoveryScam(text)) {
    s.facts.recoveryScam = true;
    pre.push(...RECOVERY_WARNING);
    alarm = true;
  }
  const extra: Partial<Reply> = alarm ? { mood: "alarm", alert: "recovery" } : {};

  // 2. Things you can say at any point.
  if (isStartOver(text)) {
    const t = startCall(k);
    t.reply.say = ["Okay, let's start again.", ...t.reply.say.slice(1)];
    return t;
  }
  if (isRepeat(text) && !alarm) return reply(s, k, []);
  if (isWhy(text)) return reply(s, k, [WHY[s.step] ?? "It helps me write your documents."]);
  if (isLegalAdviceQ(text))
    return reply(s, k, [
      "I can't give legal advice, and I can't promise you'll get money back.",
      "I can help you report what happened and keep your evidence. A securities lawyer can tell you about your own options.",
    ]);
  if (isWhoAreYou(text)) return reply(s, k, ["I'm Doki, a computer program that helps people report scams. I'm not a person, and I'm not a lawyer."]);

  // 3. Corrections to an earlier answer ("no, it was June").
  const current = STEP_FIELD[s.step];
  if (isCorrection(text) && s.step !== "summary" && s.step !== "consent") {
    const body = stripCorrection(text);
    const field = correctionField(body, k, s);
    if (field && field !== current && field !== "wallet") {
      const changed = applyField(s, k, field, body);
      if (changed) return reply(s, k, [...pre, `Got it, I've changed ${changed}.`], extra);
    }
    if (field === "wallet" && s.step !== "wallet") {
      s.returnTo = s.step === "checking" ? undefined : s.step;
      s.step = "wallet";
    }
  }
  const dkRaw = isDontKnow(text) || isSkip(text);
  const t = isCorrection(text) && !dkRaw ? stripCorrection(text) || text : text;
  const f = s.facts;
  const dk = dkRaw || isDontKnow(t) || isSkip(t);

  switch (s.step) {
    case "coin": {
      const c = dk ? null : parseCoin(t) ?? (opts.extracted?.coin ? { text: opts.extracted.coin, isCase: EMAX_RE.test(opts.extracted.coin) } : null);
      if (c) {
        f.coin = c;
        const known = c.isCase
          ? [`${k.token.name}. I know that one.`, "Canary has a full case file on it, built from the SEC's own orders and the blockchain."]
          : [`Okay, ${c.text}.`, "I don't have a case file on that coin, but I can still help you write a clear complaint."];
        return advance(s, k, "coin", [...pre, ...known], extra);
      }
      if (dk) {
        f.coin = { text: "unknown", isCase: false };
        return skip(s, k, "coin", [...pre, "That's okay. We'll describe it as best we can."]);
      }
      if (s.misses >= 1) {
        f.coin = { text: t.slice(0, 60), isCase: false };
        return advance(s, k, "coin", [...pre, "Okay, I'll write that down as you said it."], extra);
      }
      return miss(s, k, pre);
    }

    case "promoter": {
      let matched = parsePromoters(t, f.coin?.isCase ? casePromoters(k) : []);
      if (!matched.length && opts.extracted?.promoters) matched = opts.extracted.promoters.filter((n) => casePromoters(k).includes(n));
      if (matched.length) {
        f.promoters = { text: t, matched };
        const lines = f.coin?.isCase ? matched.slice(0, 2).map((n) => promoterFact(k, n)) : [];
        return advance(s, k, "promoter", [...pre, ...lines], extra);
      }
      if (dk) return skip(s, k, "promoter", pre);
      if (t.split(" ").length >= 2 || s.misses >= 1) {
        f.promoters = { text: t, matched: [] };
        const note = f.coin?.isCase ? ["Thanks. I'll put that in your own words."] : ["Thanks, that helps."];
        return advance(s, k, "promoter", [...pre, ...note], extra);
      }
      return miss(s, k, pre);
    }

    case "when": {
      const w = parseWhen(t, f.coin?.isCase ? 2021 : undefined) ?? opts.extracted?.when ?? null;
      if (w) {
        f.when = w;
        return advance(s, k, "when", [...pre, "Thank you."], extra);
      }
      if (dk) return skip(s, k, "when", [...pre, "That's okay. If you have a wallet, the blockchain will know."]);
      if (s.misses >= 1) {
        f.when = { text: t.slice(0, 80) };
        return advance(s, k, "when", [...pre, "Okay, I'll note it in your words."], extra);
      }
      return miss(s, k, pre);
    }

    case "wallet":
    case "checking": {
      const addr = findAddress(t);
      if (addr) {
        const c = checkAddress(addr);
        if (!c.ok) return reply(s, k, [...pre, c.reason, "Could you paste it again?"], { ...extra, inputHint: "address" });
        f.wallet = { address: c.address };
        f.purchases = undefined;
        if (f.coin?.isCase) {
          f.purchaseCheck = "pending";
          s.step = "checking";
          s.misses = 0;
          const say = [...pre, `Thanks. Let me check the blockchain for ${k.token.symbol} purchases from that address.`, "This takes a few seconds."];
          s.lastSay = say;
          return {
            state: s,
            reply: { say, mood: alarm ? "alarm" : "think", suggestions: [], step: "checking", progress: progressOf("checking"), action: { type: "check-wallet", address: c.address }, alert: extra.alert },
          };
        }
        return advance(s, k, "wallet", [...pre, "Thanks, I'll put that address in your documents.", "I can only read purchases automatically for coins Canary has a case file on."], extra);
      }
      if (s.step === "checking") return reply(s, k, pre, extra);
      if (/^0x/i.test(t)) {
        const c = checkAddress(t.split(" ")[0]);
        return reply(s, k, [...pre, c.ok ? "" : c.reason, "Could you paste it again?"].filter(Boolean), { ...extra, inputHint: "address" });
      }
      if (mentionsWalletApp(t) && !parseExchange(t)) {
        return reply(s, k, [...pre, "Great, then you have an address.", "In your wallet app, tap your account name to copy it, then paste it here."], { ...extra, inputHint: "address" });
      }
      if (mentionsExchange(t)) {
        const ex = parseExchange(t);
        f.wallet = { exchange: ex ?? undefined, text: t };
        if (ex) return advance(s, k, "wallet", [...pre, ...exchangeLines(ex)], extra);
        s.step = "exchange";
        s.misses = 0;
        return reply(s, k, pre, extra);
      }
      if (dk) {
        f.wallet = { none: true, text: t };
        return skip(s, k, "wallet", [...pre, "That's fine. We'll go on your own words."]);
      }
      return miss(s, k, [...pre]);
    }

    case "exchange": {
      const ex = parseExchange(t) ?? (dk ? null : t.length <= 40 ? t.replace(/[.!]+$/, "") : null);
      f.wallet = { ...(f.wallet ?? {}), exchange: ex ?? undefined };
      return advance(s, k, "exchange", [...pre, ...(ex ? exchangeLines(ex) : ["That's okay."])], extra);
    }

    case "amount": {
      const a = parseAmount(t) ?? opts.extracted?.amount ?? null;
      if (a) {
        f.amount = a;
        return advance(s, k, "amount", [...pre, "I'm sorry. That's a lot to lose."], extra);
      }
      if (dk) {
        const est = f.purchases?.totals.boughtUsd;
        return skip(s, k, "amount", [...pre, est ? `That's okay. Your documents will show the blockchain estimate of about ${usd(est)} you put in.` : "That's okay."]);
      }
      if (s.misses >= 1) {
        f.amount = { text: t.slice(0, 120) };
        return advance(s, k, "amount", [...pre, "Okay, I'll write it as you said it."], extra);
      }
      return miss(s, k, pre);
    }

    case "location":
    case "state": {
      const p = parsePlace(t) ?? opts.extracted?.place ?? null;
      if (p) {
        // "Which state?" -> "Texas": keep the country we already know
        f.place = p;
        s.consentQueue = [];
        if (p.country === "US" && !p.state) {
          s.step = "state";
          s.misses = 0;
          return reply(s, k, pre, extra);
        }
        return advance(s, k, s.step, [...pre, ...placeLines(p, s, k)], extra);
      }
      if (dk) return skip(s, k, s.step, pre);
      if (s.misses >= 1 && s.step === "location") {
        f.place = { text: t.slice(0, 60), country: "other", countryName: t.slice(0, 60) };
        s.consentQueue = [];
        return advance(s, k, "location", [...pre, "Okay."], extra);
      }
      if (s.misses >= 1) return skip(s, k, "state", pre);
      return miss(s, k, pre);
    }

    case "name": {
      if (dk || /^no\b/i.test(t)) return skip(s, k, "name", [...pre, "No problem."]);
      const n = parseName(t);
      if (n) {
        f.name = n;
        return advance(s, k, "name", [...pre, `Thanks, ${n.split(" ")[0]}.`], extra);
      }
      return s.misses >= 1 ? skip(s, k, "name", pre) : miss(s, k, pre);
    }

    case "email": {
      const e = parseEmail(t);
      if (e) {
        f.email = e;
        return advance(s, k, "email", [...pre, "Got it."], extra);
      }
      if (dk || /^no\b/i.test(t)) return skip(s, k, "email", [...pre, "No problem."]);
      return s.misses >= 1 ? skip(s, k, "email", pre) : reply(s, k, [...pre, "That doesn't look like an email address. You can type it, or say skip."], { ...extra, inputHint: "email" });
    }

    case "summary": {
      const yn = yesNo(t);
      if (yn === "yes") return go(s, k, "consent", [...pre, "Great."], extra);
      // "no, it was June" -> fix it straight away
      const field = correctionField(stripCorrection(t), k, s);
      if (field && field !== "wallet") {
        const changed = applyField(s, k, field, stripCorrection(t));
        if (changed) return reply(s, k, [...pre, `Got it, I've changed ${changed}.`], extra);
      }
      if (yn === "no" || /\bchange\b/i.test(t)) {
        s.step = "fix";
        return reply(s, k, pre, extra);
      }
      return reply(s, k, [...pre, "Is that right? Just say yes, or tell me what to change."], extra);
    }

    case "fix": {
      const field = correctionField(t, k, s);
      if (field && field !== "wallet") {
        const changed = applyField(s, k, field, t);
        if (changed) return go(s, k, "summary", [...pre, `Got it, I've changed ${changed}.`], extra);
      }
      const target: StepId | null = /\b(coin|token)\b/i.test(t)
        ? "coin"
        : /\b(person|who|promoter|celebrity|influencer|post)\b/i.test(t)
          ? "promoter"
          : /\b(date|when|time|month|day|year)\b/i.test(t)
            ? "when"
            : /\b(wallet|address|exchange)\b/i.test(t)
              ? "wallet"
              : /\b(amount|money|lost|how much|sum)\b/i.test(t)
                ? "amount"
                : /\b(state|country|live|where|location|place)\b/i.test(t)
                  ? "location"
                  : /\bemail\b/i.test(t)
                    ? "email"
                    : /\bname\b/i.test(t)
                      ? "name"
                      : null;
      if (target) {
        s.returnTo = "summary";
        return go(s, k, target, [...pre, "Okay."], extra);
      }
      if (yesNo(t) === "no" || /\bnothing\b/i.test(t)) return go(s, k, "consent", [...pre, "Okay, then it's all correct."], extra);
      return miss(s, k, pre);
    }

    case "consent": {
      const yn = yesNo(t);
      const kind = s.consentQueue[0];
      if (!yn || !kind) return reply(s, k, [...pre, "Just say yes or no."], extra);
      s.consents[kind] = yn === "yes";
      s.consentQueue.shift();
      if (s.consentQueue.length) return reply(s, k, [...pre, yn === "yes" ? "Okay." : "Okay, I'll leave that one out."], extra);
      return finish(s, k, pre, extra);
    }

    case "done":
      return reply(s, k, [...pre, ...(alarm ? [] : ["If you want to change anything, you can edit every document in your claim pack."])], extra);
  }
}

function finish(s: HotlineState, k: HotlineCase, pre: string[], extra: Partial<Reply>): Turn {
  s.step = "done";
  const yes = Object.entries(s.consents).filter(([, v]) => v).map(([kd]) => kd as DocKind);
  const also = [...(s.facts.coin?.isCase && k.classAction ? ["a note about the class action"] : []), "your evidence file with its fingerprint"];
  const say = [
    ...pre,
    yes.length ? `Done. I've drafted ${yes.length} document${yes.length === 1 ? "" : "s"}, plus ${list(also)}.` : `Done. I've prepared ${list(also)}.`,
    "Nothing has been sent. You read each one, change anything you like, and file it yourself.",
    "And remember: nobody honest will ever charge you to get your money back.",
  ];
  s.lastSay = say;
  return { state: s, reply: { say, mood: extra.mood ?? "happy", suggestions: [], step: "done", progress: progressOf("done"), action: { type: "make-claim" }, alert: extra.alert } };
}

function promoterFact(k: HotlineCase, name: string): string {
  const paid = paidPost(k, name);
  if (paid?.paid && documentedBy(paid) === "SEC order")
    return `The SEC found ${name} was paid ${usd(paid.paid.amountUsd)} to promote ${k.token.symbol} without properly disclosing it.`;
  return `${name}'s promotion is described in the class-action lawsuit. That's an allegation, not a ruling.`;
}

function exchangeLines(ex: string): string[] {
  return [`Okay, ${ex}.`, `Later, download your transaction history from ${ex}. It's your proof of purchase.`];
}

function placeLines(p: Place, s: HotlineState, k: HotlineCase): string[] {
  const where = p.stateName ?? p.ukNation ?? p.countryName;
  const lines = [`Thanks. ${where}.`];
  const ca = k.classAction;
  if (s.facts.coin?.isCase && ca && p.country === "US" && p.state && ca.certifiedStates.includes(p.state)) {
    const window = s.facts.purchases?.purchases.some((x) => x.inClassPeriod) || (s.facts.when?.date ? inClassPeriod(k, s.facts.when.date) : false);
    if (window) lines.push(`That matters: the court certified a class for ${p.stateName} buyers. I'll explain in your claim pack.`);
  }
  return lines;
}

/** Feed the result of the blockchain check back into the call. */
export function applyPurchaseResult(prev: HotlineState, result: { ok: true; report: PurchaseReport } | { ok: false; error: string }, k: HotlineCase): Turn {
  const s = clone(prev);
  const f = s.facts;
  if (!result.ok) {
    f.purchaseCheck = "failed";
    return advance(s, k, "checking", ["The blockchain service didn't answer just now.", "I've kept your address, so it goes into your documents, and you can check it again later."], { mood: "talk" });
  }
  const r = result.report;
  f.purchases = r;
  f.purchaseCheck = "done";
  const n = r.purchases.length;
  if (!n) {
    return advance(s, k, "checking", [
      `I couldn't find ${k.token.symbol} bought straight from the main trading pool at that address.`,
      "You may have bought through another app or exchange. That's okay; we'll use your own words.",
    ]);
  }
  const first = r.purchases[0].date;
  const last = r.purchases[n - 1].date;
  const lines = [
    n === 1 ? `Found it. One purchase of ${k.token.symbol}, on ${longDate(first)}.` : `Found it. ${n} purchases of ${k.token.symbol}, from ${longDate(first)} to ${longDate(last)}.`,
    `${humanTokens(r.totals.boughtTokens)} tokens in all.`,
  ];
  if (r.totals.boughtUsd) lines.push(`At each day's closing price, that's about ${usd(r.totals.boughtUsd)}.`);
  const after = r.purchases.filter((p) => p.postsBefore.length);
  if (after.length) {
    const who = [...new Set(after.flatMap((p) => p.postsBefore.map((x) => x.promoter)))];
    lines.push(`${after.length === n ? (n === 1 ? "It" : "All of them") : `${after.length} of them`} came within three days after a post by ${list(who)}.`);
  }
  if (k.classAction && r.totals.inClassPeriod) lines.push(`${r.totals.inClassPeriod === n ? (n === 1 ? "It's" : "All are") : `${r.totals.inClassPeriod} are`} inside the class action's purchase dates.`);
  lines.push(r.sales.length ? `You also sold ${r.sales.length === 1 ? "once" : r.sales.length + " times"} back to the pool.` : "And you never sold any back to the pool.");
  // no date from the caller: the blockchain's first purchase stands in (their own words, if any, are kept)
  if (!f.when) f.when = { date: first, month: first.slice(0, 7), text: `first purchase ${first} (from the blockchain)` };
  return advance(s, k, "checking", lines, { mood: "happy" });
}

/** Everything the claim generator needs from a finished call. */
export const consentedDocs = (s: HotlineState): DocKind[] => (Object.entries(s.consents) as [DocKind, boolean][]).filter(([, v]) => v).map(([kd]) => kd);
