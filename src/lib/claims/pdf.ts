// The claim pack as one PDF, written by hand: PDF 1.4, the three standard fonts every reader has
// (Helvetica, Helvetica-Bold, Courier, WinAnsi encoding), text wrapped by the fonts' own character widths.
// No dependency, no network, no clock: the same pack gives the same bytes, so the PDF has a stable SHA-256 too.
// Browser-safe; the claim page builds it on the person's own device.
//
// Layout: cover (case, claimant summary without name or email, date, evidence fingerprint, on-chain anchor),
// then each drafted document on its own pages, then the evidence table and the list of sources.
// Every page has the footer "Draft prepared with Canary — not legal advice", its page number and the fingerprint.

import { REFERENCES } from "../hotline/caseFacts";
import { longDate, tokenAmount, usdCents, utcTime } from "./format";
import { LAW } from "./law";
import type { ClaimPack } from "./types";

export type PdfInput = {
  pack: ClaimPack;
  /** the drafts as the person edited them, by document kind (falls back to the generated text) */
  texts?: Partial<Record<string, string>>;
  /** the on-chain anchor of the evidence fingerprint, if there is one */
  anchor?: { txHash?: string; explorerUrl: string; network?: string } | null;
  /** site origin for the /verify link */
  origin?: string;
};

export type PdfResult = { bytes: Uint8Array; pages: number };

// ---------------- page geometry (A4, points) ----------------

const W = 595;
const H = 842;
const LEFT = 56;
const RIGHT = W - 56;
const TOP = H - 60;
const BOTTOM = 78; // the footer lives below this
const WIDTH = RIGHT - LEFT;

type Font = "F1" | "F2" | "F3"; // Helvetica, Helvetica-Bold, Courier
type RGB = [number, number, number];
const INK: RGB = [0.11, 0.11, 0.12];
const GREY: RGB = [0.42, 0.42, 0.45];
const CANARY: RGB = [1, 0.85, 0.24];
const PAPER2: RGB = [0.95, 0.95, 0.93];

// ---------------- text: WinAnsi bytes and widths ----------------

/** Unicode -> WinAnsi (cp1252) code points; anything else becomes a close ASCII stand-in or "?". */
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const STAND_IN: Record<string, string> = {
  "≈": "~", "→": "->", "←": "<-", "↗": "", "−": "-", "‐": "-", "‑": "-", "≥": ">=", "≤": "<=", "✓": "v", "✗": "x", "₹": "Rs ",
  "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "\u2009": " ", "\u202f": " ", "\u200b": "", "\t": "    ",
};

export function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (CP1252[cp]) out.push(CP1252[cp]);
    else if (ch in STAND_IN) for (const c of STAND_IN[ch]) out.push(c.charCodeAt(0));
    else if (cp >= 0xfe00 && cp <= 0xfe0f) continue; // variation selectors
    else if (cp > 0xffff || (cp >= 0x2600 && cp <= 0x27bf)) continue; // emoji: dropped
    else if (cp < 0x20) continue;
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const b = base.codePointAt(0) ?? 0;
      out.push(base.length === 1 && b >= 0x20 && b <= 0x7e ? b : 0x3f);
    }
  }
  return out;
}

// Adobe font metrics (1/1000 em) for codes 32..126.
// prettier-ignore
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const HIGH: Record<number, number> = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0xa0: 278, 0xa3: 556, 0xa7: 556, 0xa9: 737, 0xb0: 400, 0xb7: 278 };

function charWidth(code: number, font: Font): number {
  if (font === "F3") return 600;
  if (code >= 32 && code <= 126) return (font === "F2" ? HELV_B : HELV)[code - 32];
  return HIGH[code] ?? 556; // accented letters are close to 556
}

export function textWidth(s: string, font: Font, size: number): number {
  let w = 0;
  for (const c of winAnsi(s)) w += charWidth(c, font);
  return (w * size) / 1000;
}

/** A PDF literal string: printable ASCII as is, everything else as octal escapes, so the file stays 7-bit. */
function pdfString(s: string): string {
  let out = "(";
  for (const b of winAnsi(s)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) out += "\\" + b.toString(8).padStart(3, "0");
    else out += String.fromCharCode(b);
  }
  return out + ")";
}

const n2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2).replace(/\.?0+$/, "") || "0";
const rgb = (c: RGB, stroke = false) => `${c.map(n2).join(" ")} ${stroke ? "RG" : "rg"}`;

/** Split text into lines that fit `width`; words longer than a line (hashes, links) are broken by character. */
export function wrap(text: string, font: Font, size: number, width: number): string[] {
  const words = text.split(/ +/);
  const lines: string[] = [];
  let cur = "";
  const push = () => {
    lines.push(cur);
    cur = "";
  };
  for (let word of words) {
    const tryLine = cur ? `${cur} ${word}` : word;
    if (textWidth(tryLine, font, size) <= width) {
      cur = tryLine;
      continue;
    }
    if (cur) push();
    while (textWidth(word, font, size) > width) {
      let i = 1;
      while (i < word.length && textWidth(word.slice(0, i + 1), font, size) <= width) i++;
      lines.push(word.slice(0, i));
      word = word.slice(i);
    }
    cur = word;
  }
  if (cur || !lines.length) push();
  return lines;
}

// ---------------- layout ----------------

class Pages {
  pages: string[][] = [];
  y = TOP;
  private get ops() {
    return this.pages[this.pages.length - 1];
  }
  newPage() {
    this.pages.push([]);
    this.y = TOP;
  }
  ensure(h: number) {
    if (!this.pages.length || this.y - h < BOTTOM) this.newPage();
  }
  raw(op: string) {
    if (!this.pages.length) this.newPage();
    this.ops.push(op);
  }
  textAt(s: string, x: number, y: number, font: Font, size: number, color: RGB = INK) {
    this.raw(`BT ${rgb(color)} /${font} ${n2(size)} Tf ${n2(x)} ${n2(y)} Td ${pdfString(s)} Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, color: RGB) {
    this.raw(`${rgb(color)} ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, color: RGB = GREY, width = 0.5) {
    this.raw(`${rgb(color, true)} ${n2(width)} w ${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S`);
  }
  gap(h: number) {
    this.y -= h;
  }
  /** A wrapped paragraph; `indent` shifts every line, so indented lines in a draft stay indented. */
  para(s: string, o: { font?: Font; size?: number; lead?: number; indent?: number; color?: RGB; x?: number; width?: number } = {}) {
    const font = o.font ?? "F1";
    const size = o.size ?? 9.5;
    const lead = o.lead ?? size * 1.38;
    const x = (o.x ?? LEFT) + (o.indent ?? 0);
    const width = (o.width ?? WIDTH) - (o.indent ?? 0);
    for (const l of wrap(s, font, size, width)) {
      this.ensure(lead);
      this.y -= lead;
      this.textAt(l, x, this.y + lead * 0.25, font, size, o.color);
    }
  }
  rule(color: RGB = GREY) {
    this.ensure(10);
    this.y -= 6;
    this.line(LEFT, this.y, RIGHT, this.y, color, 0.6);
    this.y -= 6;
  }
}

/** A plain-text draft, line by line: rules become lines, CAPITAL headings become bold, indentation is kept. */
function draftText(p: Pages, text: string) {
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      p.gap(5);
      continue;
    }
    if (/^-{10,}$/.test(line.trim())) {
      p.rule([0.75, 0.75, 0.75]);
      continue;
    }
    const lead = line.length - line.trimStart().length;
    const body = line.trimStart();
    const heading = /^[0-9. ]*[A-Z][A-Z0-9 ,()'"’:;&/.-]{3,}$/.test(body) && !/[a-z]/.test(body);
    if (heading) p.gap(3);
    p.para(body, { font: heading ? "F2" : "F1", size: heading ? 9.5 : 9.2, indent: lead * 4 });
  }
}

function keyValue(p: Pages, key: string, value: string | string[]) {
  const kw = 150;
  const lines = (Array.isArray(value) ? value : [value]).flatMap((v) => wrap(v, "F1", 10, WIDTH - kw));
  p.ensure(14 * lines.length + 4);
  p.y -= 14;
  p.textAt(key, LEFT, p.y + 3, "F2", 9, GREY);
  lines.forEach((l, i) => {
    if (i) p.y -= 14;
    p.textAt(l, LEFT + kw, p.y + 3, "F1", 10);
  });
  p.y -= 4;
}

// ---------------- the evidence file, read back ----------------

type Ev = {
  case?: {
    token?: { name?: string; symbol?: string; address?: string };
    legal?: { title: string; date: string; sources: { label: string; url: string }[] }[];
    classAction?: { name: string; sources: { label: string; url: string }[] } | null;
  } | null;
  statement?: { country?: string | null; usState?: string | null };
  purchases?: {
    address: string;
    addressUrl: string;
    method?: string;
    purchases: { at: string; amount: string; usdEstimate: number | null; txHash: string; txUrl: string; blockNumber: number }[];
    sales: { at: string; amount: string; txHash: string; txUrl: string }[];
  } | null;
  postsCited?: { promoter: string; handle: string | null; platform: string; postedAt: string; datePrecision?: string; documentedBy: string; sources: { label: string; url: string }[] }[];
};

function readEvidence(pack: ClaimPack): Ev {
  try {
    return (JSON.parse(pack.evidence.json) as { evidence?: Ev }).evidence ?? {};
  } catch {
    return {};
  }
}

const PLATFORM: Record<string, string> = { instagram: "Instagram", x: "X (Twitter)", telegram: "Telegram", youtube: "YouTube", tiktok: "TikTok", other: "other channels" };

const URL_RE = /https?:\/\/[^\s"')<>]+[^\s"')<>.,;:]/g;

/** Every source the pack relies on: the case file's sources, the law table's, and any other link in the drafts. */
export function packSources(pack: ClaimPack, texts: string[], ev: Ev): { label: string; url: string }[] {
  const labels = new Map<string, string>();
  const add = (label: string, url: string) => {
    if (!labels.has(url)) labels.set(url, label);
  };
  for (const l of ev.case?.legal ?? []) for (const s of l.sources) add(`${l.title}: ${s.label}`, s.url);
  for (const s of ev.case?.classAction?.sources ?? []) add(s.label, s.url);
  for (const po of ev.postsCited ?? []) for (const s of po.sources) add(`${po.promoter}, ${longDate(po.postedAt)}: ${s.label}`, s.url);
  const known = new Map<string, string>();
  for (const l of LAW) for (const s of l.sources) known.set(s.url, `${l.cite}: ${s.label}`);
  for (const r of REFERENCES) known.set(r.url, r.label);
  const verify = /\/verify$/;
  for (const t of texts)
    for (const m of t.matchAll(URL_RE)) {
      const url = m[0];
      if (/etherscan\.io\/(tx|address)\//.test(url)) continue; // the transactions are in the evidence table
      add(known.get(url) ?? (verify.test(url) ? "Canary verifier: recompute the evidence fingerprint in a browser" : "Cited in the drafts"), url);
    }
  return [...labels].map(([url, label]) => ({ label, url }));
}

// ---------------- the document ----------------

const pdfDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(iso);
  return m ? `D:${m[1]}${m[2]}${m[3]}${m[4] ?? "00"}${m[5] ?? "00"}${m[6] ?? "00"}Z` : "D:19700101000000Z";
};

export const FOOTER = "Draft prepared with Canary — not legal advice";

export function buildClaimPdf(input: PdfInput): PdfResult {
  const { pack } = input;
  const ev = readEvidence(pack);
  const sha = pack.evidence.sha256;
  const textOf = (kind: string, body: string) => input.texts?.[kind] ?? body;
  const edited = pack.docs.some((d) => input.texts?.[d.kind] != null && input.texts[d.kind] !== d.body);
  const verifyUrl = input.origin ? `${input.origin.replace(/\/$/, "")}/verify` : null;
  const p = new Pages();

  // ---- cover ----
  p.newPage();
  p.rect(0, H - 150, W, 150, CANARY);
  p.textAt("CANARY  ·  CLAIM PACK", LEFT, H - 52, "F2", 9, INK);
  p.textAt("Claim pack", LEFT, H - 92, "F2", 28, INK);
  const sub = wrap(pack.headline.coin, "F1", 13, WIDTH);
  sub.slice(0, 2).forEach((l, i) => p.textAt(l, LEFT, H - 116 - i * 16, "F1", 13, INK));
  p.y = H - 180;
  keyValue(p, "Claim ID", pack.id);
  keyValue(p, "Prepared", `${longDate(pack.createdAt)}, ${utcTime(pack.createdAt)}`);
  keyValue(p, "Case", pack.isCase && ev.case?.token ? `${ev.case.token.name} (${ev.case.token.symbol}), Ethereum token ${ev.case.token.address}` : "No Canary case file for this coin: the drafts use the claimant's own words.");
  keyValue(p, "Claimant lives in", pack.headline.where ?? "not stated");
  if (pack.jurisdiction) keyValue(p, "Rules used", pack.jurisdiction);
  keyValue(p, "Loss (own estimate)", pack.headline.amount ?? "not stated");
  keyValue(p, "Purchases on-chain", String(pack.headline.purchases));
  keyValue(p, "Documents", pack.docs.map((d, i) => `${i + 1}. ${d.title}`));
  p.gap(14);

  // fingerprint box
  const boxTop = p.y;
  const anchorLines = input.anchor
    ? [`Anchored on ${input.anchor.network ?? "Sepolia"}${input.anchor.txHash ? `, transaction ${input.anchor.txHash}` : ""}:`, input.anchor.explorerUrl]
    : ["Not anchored on-chain yet. Anchoring records this fingerprint in Canary's registry contract on Sepolia, with a timestamp."];
  const boxLines = 3 + anchorLines.reduce((n, l) => n + wrap(l, "F1", 8.5, WIDTH - 24).length, 0) + (verifyUrl ? 1 : 0);
  const boxH = 18 + boxLines * 12.5;
  p.rect(LEFT, boxTop - boxH, WIDTH, boxH, PAPER2);
  p.y = boxTop - 6;
  p.para("EVIDENCE FILE FINGERPRINT (SHA-256)", { font: "F2", size: 8.5, x: LEFT + 12, width: WIDTH - 24, color: GREY });
  p.para(sha, { font: "F3", size: 9.6, x: LEFT + 12, width: WIDTH - 24 });
  p.para(`File: ${pack.evidence.filename}. Change one character of it and this fingerprint changes.`, { size: 8.5, x: LEFT + 12, width: WIDTH - 24 });
  if (verifyUrl) p.para(`Recompute it in any browser at ${verifyUrl}`, { size: 8.5, x: LEFT + 12, width: WIDTH - 24 });
  for (const l of anchorLines) p.para(l, { size: 8.5, x: LEFT + 12, width: WIDTH - 24 });
  p.y = boxTop - boxH - 16;

  for (const t of [
    "These are drafts for the claimant to check, correct and send. Canary is an information tool, not a law firm, and nothing in this pack is legal advice.",
    "The claimant's name and email appear only inside the drafts that need them, never on this cover or in the evidence file.",
    edited ? "The drafts are printed as the claimant edited them." : "The drafts are printed as Canary generated them.",
    "The fingerprint covers the evidence file, not this PDF.",
  ])
    p.para(t, { size: 9, color: GREY });

  // ---- the drafts ----
  pack.docs.forEach((d, i) => {
    p.newPage();
    p.para(`DOCUMENT ${i + 1} OF ${pack.docs.length}`, { font: "F2", size: 8, color: GREY });
    p.para(d.title, { font: "F2", size: 16, lead: 22 });
    if (d.destination) p.para(`${d.destination.label}: ${d.destination.url}`, { size: 8.5, color: GREY });
    p.rule();
    draftText(p, textOf(d.kind, d.body));
  });

  // ---- evidence ----
  p.newPage();
  p.para("EVIDENCE", { font: "F2", size: 8, color: GREY });
  p.para("Purchases on the blockchain", { font: "F2", size: 16, lead: 22 });
  const r = ev.purchases;
  const sym = ev.case?.token?.symbol ?? "tokens";
  if (!r || !r.purchases.length) {
    p.para("No purchases were read from the blockchain for this claim. The drafts rely on the claimant's own account and their exchange records.", { size: 9.5 });
  } else {
    p.para(`Wallet ${r.address}`, { font: "F3", size: 8.5 });
    p.para(r.addressUrl, { size: 8.5, color: GREY });
    p.gap(6);
    const cols = [LEFT, LEFT + 22, LEFT + 150, LEFT + 330];
    const head = ["#", "Date and time (UTC)", `Amount (${sym})`, "USD estimate"];
    p.ensure(20);
    p.y -= 14;
    head.forEach((h, i) => p.textAt(h, cols[i], p.y + 3, "F2", 8.5, GREY));
    p.line(LEFT, p.y, RIGHT, p.y);
    r.purchases.forEach((x, i) => {
      p.ensure(34);
      p.y -= 14;
      const cells = [String(i + 1), `${longDate(x.at)}, ${utcTime(x.at)}`, tokenAmount(x.amount), x.usdEstimate != null ? usdCents(x.usdEstimate) : "n/a"];
      cells.forEach((c, j) => p.textAt(c, cols[j], p.y + 3, "F1", 9));
      p.y -= 11;
      p.textAt(`tx ${x.txHash}  (block ${x.blockNumber})`, cols[1], p.y + 3, "F3", 7.2, GREY);
      p.y -= 4;
      p.line(LEFT, p.y, RIGHT, p.y, [0.85, 0.85, 0.85], 0.4);
    });
    if (r.sales.length) {
      p.gap(10);
      p.para("Sales back to the pool", { font: "F2", size: 10 });
      for (const s of r.sales) {
        p.para(`${longDate(s.at)}, ${utcTime(s.at)}: ${tokenAmount(s.amount)} ${sym}`, { size: 9 });
        p.para(`tx ${s.txHash}`, { font: "F3", size: 7.2, color: GREY, indent: 12 });
      }
    }
    p.gap(8);
    p.para("Each transaction can be opened at https://etherscan.io/tx/<transaction hash>. The USD estimate uses that day's closing price of the trading pool.", { size: 8.5, color: GREY });
    if (r.method) p.para(`How these were found: ${r.method}`, { size: 8.5, color: GREY });
  }
  if (ev.postsCited?.length) {
    p.gap(12);
    p.para("Promoter posts cited", { font: "F2", size: 12, lead: 18 });
    for (const po of ev.postsCited) p.para(`${po.datePrecision === "month" ? po.postedAt.slice(0, 7) : longDate(po.postedAt)}: ${po.promoter}${po.handle ? ` (${po.handle})` : ""} on ${PLATFORM[po.platform] ?? po.platform}. Recorded in: ${po.documentedBy}.`, { size: 9 });
  }

  // ---- sources ----
  const sources = packSources(pack, pack.docs.map((d) => textOf(d.kind, d.body)), ev);
  p.gap(16);
  p.ensure(60);
  p.para("Sources", { font: "F2", size: 16, lead: 22 });
  p.para("Every regulator order, court record, statute and filing page the drafts rely on, with its official address.", { size: 9, color: GREY });
  p.gap(4);
  sources.forEach((s, i) => {
    p.ensure(28);
    p.para(`${i + 1}. ${s.label}`, { size: 9 });
    p.para(s.url, { size: 8, color: GREY, indent: 14 });
  });

  // ---- footers, now that the page count is known ----
  const total = p.pages.length;
  p.pages.forEach((ops, i) => {
    ops.push(`${rgb([0.8, 0.8, 0.8], true)} 0.5 w ${LEFT} 56 m ${RIGHT} 56 l S`);
    ops.push(`BT ${rgb(GREY)} /F1 7.5 Tf ${LEFT} 44 Td ${pdfString(FOOTER)} Tj ET`);
    const num = `Page ${i + 1} of ${total}`;
    ops.push(`BT ${rgb(GREY)} /F1 7.5 Tf ${n2(RIGHT - textWidth(num, "F1", 7.5))} 44 Td ${pdfString(num)} Tj ET`);
    ops.push(`BT ${rgb(GREY)} /F3 6.6 Tf ${LEFT} 33 Td ${pdfString(`Evidence SHA-256 ${sha}`)} Tj ET`);
  });

  return { bytes: assemble(p.pages, { title: `Canary claim pack ${pack.id}`, created: pdfDate(pack.createdAt), id: sha.slice(0, 32) }), pages: total };
}

/** Objects, cross-reference table and trailer. Every byte is ASCII except the header's binary marker. */
function assemble(pages: string[][], meta: { title: string; created: string; id: string }): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${7 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (const base of ["Helvetica", "Helvetica-Bold", "Courier"]) objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
  objs.push(`<< /Title ${pdfString(meta.title)} /Producer (Canary) /Creator (Canary claim pack) /CreationDate (${meta.created}) /ModDate (${meta.created}) >>`);
  pages.forEach((ops, i) => {
    const stream = ops.join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${8 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R /ID [<${meta.id}> <${meta.id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** SHA-256 of the PDF bytes, hex: same pack in, same PDF out, same fingerprint. */
export async function pdfSha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
