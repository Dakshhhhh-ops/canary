// What a post's own words show, for the anti-touting question (Securities Act §17(b)): does it say it
// was paid, does it name the payer and the amount, does it read like a push to buy, which coins and
// contracts does it name. Plain text rules, published here, so anyone can see why a post was flagged.
// Nothing here can tell who really paid whom: "no disclosure found" is never "proof of payment".
import type { PostSignals } from "./types";

// payment disclosure words; a "not"/"no"/"non" right before cancels them ("not sponsored")
const DISCLOSURE: [string, RegExp][] = [
  ["#ad", /#ad\b/gi],
  ["#ads", /#ads\b/gi],
  ["#advertisement", /#advertisement\b/gi],
  ["#sponsored", /#sponsored\b/gi],
  ["#paid", /#paid\w*/gi],
  ["#partner", /#(?:paid)?partner(?:ship)?\b/gi],
  ["sponsored", /\bsponsored\b/gi],
  ["paid promotion", /\bpaid\s+(?:promotion|promo|partnership|post|ad|advertisement|placement|feature)\b/gi],
  ["advertisement", /\badvertisement\b/gi],
  ["this is an ad", /\b(?:this|post)\s+is\s+an?\s+(?:ad|advert)\b/gi],
  ["promoted post", /\bpromoted\s+(?:post|content|message)\b/gi],
  ["in partnership with", /\bin\s+(?:paid\s+)?partnership\s+with\b/gi],
  ["partnered", /\bpartnered\s+(?:post|content|with)\b/gi],
  ["I was paid", /\bi\s+(?:was|am|got|have\s+been|'?ve\s+been|'?m\s+being)\s+(?:paid|compensated)\b/gi],
  ["compensated", /\bcompensated\b/gi],
];
const NEGATION = /\b(?:not|no|non|never|isn'?t|wasn'?t|un)[\s-]*$/i;

// promotion-style phrases: the vocabulary of a "call"
const SHILL: [string, RegExp][] = [
  ["Nx", /\b\d{2,5}\s?x\b/gi], // 10x, 100x, 1000x
  ["to the moon", /\bto\s+the\s+moon\b/gi],
  ["moon", /\bmoon(?:ing|shot|shots)?\b/gi],
  ["🚀", /🚀/gu],
  ["gem", /\bgems?\b/gi],
  ["ape in", /\bap(?:e|ing)\s+(?:in|now)\b|\baping\b/gi],
  ["buy now", /\bbuy\s+(?:now|it\s+now|before|this\s+dip|the\s+dip)\b/gi],
  ["don't miss", /\bdon'?t\s+(?:miss|fade|sleep\s+on)\b/gi],
  ["last chance", /\blast\s+chance\b/gi],
  ["next big", /\bnext\s+(?:\d+x|big\s+thing|pepe|doge|shib|bitcoin|solana)\b/gi],
  ["presale", /\bpre-?sale\b/gi],
  ["launch", /\b(?:stealth|fair)\s?-?launch\b/gi],
  ["pump", /\bpump(?:ing|s)?\b(?!\.fun)/gi],
  ["send it", /\bsend(?:ing)?\s+it\b/gi],
  ["LFG", /\blfg\b/gi],
  ["load up", /\bload(?:ing)?\s+(?:up|your\s+bags)\b/gi],
  ["guaranteed", /\bguarantee[ds]?\b/gi],
  ["millionaire", /\bmillionaires?\b/gi],
  ["parabolic", /\bparabolic\b|\bexplod(?:e|es|ing)\b/gi],
  ["under the radar", /\bunder\s+the\s+radar\b/gi],
  ["entry / target", /\bentry\s*(?:zone|price)?\s*[:@]|\btargets?\s*[:@]|\bTP\s?\d\b/gi],
];

// keywords matched in either case by hand: an /i flag would also make \p{Lu} match lower-case letters
// "paid by X", "sponsored by X", "I was paid $5,000 by X to post"
const PAYER = /\b(?:[Pp]aid|[Ss]ponsored|[Cc]ompensated|[Bb]rought\s+to\s+you|PAID|SPONSORED)\b[^.\n]{0,40}?\s(?:[Bb]y|BY)\s+(@?[\p{L}\p{N}_-]+(?:\s+[\p{Lu}][\p{L}\p{N}_-]*){0,3})/u;
const AMOUNT = /\b(?:paid|compensat\w*|received|fee\s+of|for\s+a\s+fee)\b[^.\n]{0,40}?((?:\$|usd\s?)\s?\d[\d,.]*\s?[kKmM]?\b|\b\d[\d,.]*\s?[kKmM]?\s?(?:usd[ct]?|dollars|eth|sol|bnb|tokens?)\b)/i;

const EVM = /\b0x[a-fA-F0-9]{40}\b/g;
const B58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

const uniq = <T>(xs: T[]) => [...new Set(xs)];

function matches(text: string, list: [string, RegExp][], negatable = false): string[] {
  const out: string[] = [];
  for (const [label, re] of list) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (negatable && NEGATION.test(text.slice(Math.max(0, (m.index ?? 0) - 12), m.index))) continue;
      out.push(label === "Nx" ? m[0].replace(/\s/g, "").toLowerCase() : label);
      break;
    }
  }
  return uniq(out);
}

/** Contract addresses in a text: EVM 0x… and Solana base58 (32–44 characters, mixed case and digits). */
export function contractsIn(text: string): PostSignals["contracts"] {
  const evm = [...text.matchAll(EVM)].map((m) => ({ chain: "evm" as const, address: m[0].toLowerCase() }));
  const sol = [...text.replace(EVM, " ").matchAll(B58)]
    .map((m) => m[0])
    .filter((s) => /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s))
    .map((address) => ({ chain: "solana" as const, address }));
  const seen = new Set<string>();
  return [...evm, ...sol].filter((c) => !seen.has(c.address) && seen.add(c.address));
}

/** Read a post's text for disclosure, shill language, tickers and contracts. */
export function readSignals(text: string, forwardedFrom: string | null = null): PostSignals {
  const t = text ?? "";
  const terms = matches(t, DISCLOSURE, true);
  const said = terms.length > 0;
  const payer = said ? (t.match(PAYER)?.[1]?.trim() ?? null) : null;
  const amount = said ? (t.match(AMOUNT)?.[1]?.trim() ?? null) : null;
  const shill = matches(t, SHILL);
  return {
    disclosure: { said, terms, payer, amount, complete: said && Boolean(payer) && Boolean(amount) },
    shill,
    promotional: shill.length > 0 || said,
    cashtags: uniq([...t.matchAll(/(?<![\p{L}\p{N}])\$([A-Za-z][A-Za-z0-9]{1,11})\b/gu)].map((m) => m[1].toUpperCase())),
    hashtags: uniq([...t.matchAll(/(?<![\p{L}\p{N}&])#([\p{L}][\p{L}\p{N}_]{1,40})/gu)].map((m) => m[1].toUpperCase())),
    contracts: contractsIn(t),
    forwardedFrom,
  };
}

/**
 * Which of the run's coins a post is about: $PEPE or #PEPE (any case), or the ticker in capitals as a
 * word of its own ("PEPE/USDT", but not "Pepe the frog" and not "PEPENODE"). Tickers shorter than three
 * letters only count as $ or # tags.
 */
export function symbolsIn(text: string, symbols: string[]): string[] {
  const t = text ?? "";
  return symbols.filter((s) => {
    const esc = s.replace(/[^A-Za-z0-9]/g, "");
    if (!esc) return false;
    if (new RegExp(`(?<![\\p{L}\\p{N}])[$#]${esc}(?![\\p{L}\\p{N}])`, "iu").test(t)) return true;
    return esc.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}])${esc.toUpperCase()}(?![\\p{L}\\p{N}])`, "u").test(t);
  });
}

/** One plain-words line about a post's disclosure, for the notebook and the page. */
export function disclosureText(s: PostSignals): string {
  if (!s.disclosure.said) return "No payment disclosure in the post";
  const what = `Says it is paid (${s.disclosure.terms.join(", ")})`;
  if (s.disclosure.complete) return `${what}, names the payer (${s.disclosure.payer}) and the amount (${s.disclosure.amount})`;
  const missing = [!s.disclosure.payer && "who paid", !s.disclosure.amount && "how much"].filter(Boolean).join(" or ");
  return `${what}, but not ${missing}`;
}
