// Live promoter posts from free sources: parsers on recorded replies, the §17(b) text signals, the
// collector's gap discipline (403 / 429 / timeout / bad body never throw, never invent a post), the
// Multi-KOL watcher fed with live posts inside runLive, and saved runs that re-verify every raw reply.
// Fixtures: tests/fixtures/social/manifest.json says what is recorded (real, trimmed) and what is a
// constructed scenario (made-up channels and coin, in the real markup).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonical, sha256Hex } from "../src/lib/canonical";
import { runLive } from "../src/lib/engine/pipeline";
import { RyoClient } from "../src/lib/engine/ryo";
import { stepClock } from "../src/lib/engine/trail";
import { verifySavedRun } from "../src/lib/radar/saved";
import { findSecrets, readRun, saveRun } from "../src/lib/radar/store";
import { DEFAULT_TELEGRAM_CHANNELS, SocialCollector, socialConfigFromEnv, USER_AGENT } from "../src/lib/social/collect";
import { ParseError, parseBluesky, parseCount, parseFarcaster, parseReddit, parseTelegram } from "../src/lib/social/parse";
import { contractsIn, disclosureText, readSignals, symbolsIn } from "../src/lib/social/signals";
import { analyzeA, client, deepA, server, withHolders } from "./fixtures/ryo/server";

const DIR = path.join(__dirname, "fixtures", "social");
const fx = (f: string) => readFileSync(path.join(DIR, f), "utf8");
const AT = "2026-10-30T04:00:00.000Z"; // the scenario's "now"

// ---------- parsers on recorded replies ----------

test("Telegram preview: posts, times, views, subscribers and the channel title are read from the real markup", () => {
  const page = parseTelegram(fx("recorded/telegram-gem_tools_calls.html"), "gem_tools_calls");
  assert.equal(page.title, "💎 GemTools 💎 Calls");
  assert.equal(page.subscribers, 14400);
  assert.equal(page.posts.length, 6);
  const last = page.posts.at(-1)!;
  assert.equal(last.id, "tg:gem_tools_calls/67345");
  assert.equal(last.url, "https://t.me/gem_tools_calls/67345");
  assert.equal(last.postedAt, "2026-10-30T03:22:35.000Z");
  assert.equal(typeof last.views, "number");
  assert.match(last.text, /94ygQzoJq1gLa88rzr3TCRN119s6C7YKV8u5hxcRpump/);
  assert.ok(page.posts.every((p) => !/<\/?[a-z][^>]*>|&#036;|&amp;/i.test(p.text)), "tags stripped, entities decoded");
  assert.ok(page.posts.some((p) => p.text.includes("$")), "&#036; became $");
  // the quoted reply inside a post is not mistaken for the post's own text
  // ("SI did 2x" replies to the original call; the call's "holders" line is the quote, not the post)
  const replies = page.posts.filter((p) => / did \dx/.test(p.text));
  assert.equal(replies.length, 5);
  assert.ok(replies.every((p) => !/holders/.test(p.text)));
});

test("Telegram preview: cashtags and EVM contracts in an on-chain tracker's posts", () => {
  const { posts } = parseTelegram(fx("recorded/telegram-lookonchainchannel.html"), "lookonchainchannel");
  const s = posts.map((p) => readSignals(p.text));
  assert.ok(s.some((x) => x.cashtags.includes("ETH")));
  assert.ok(s.some((x) => x.contracts.some((c) => c.chain === "evm")));
  assert.deepEqual(symbolsIn(posts.find((p) => p.id.endsWith("/10839"))!.text, ["ETH", "BTC"]), ["ETH"]);
});

test("a name with no public preview is a ParseError (the collector turns it into a gap)", () => {
  assert.throws(() => parseTelegram(fx("recorded/telegram-no-preview.html"), "CryptoGems"), (e: unknown) => e instanceof ParseError && /no public web preview/.test(e.message));
  assert.throws(() => parseTelegram("<html>captcha</html>", "x"), ParseError);
});

test("Bluesky search reply: links, authors and Bluesky's own timestamps", () => {
  const posts = parseBluesky(fx("recorded/bluesky-PEPE.json"));
  assert.equal(posts.length, 10);
  assert.match(posts[0].url, /^https:\/\/bsky\.app\/profile\/account-1\.bsky\.social\/post\/[a-z0-9]+$/);
  assert.equal(posts[0].postedAt, "2026-10-30T03:30:27.875Z");
  assert.throws(() => parseBluesky("<html>403 Forbidden</html>"), ParseError);
  assert.throws(() => parseBluesky('{"error":"InvalidRequest"}'), ParseError);
});

test("Reddit and Farcaster (Neynar) reply shapes", () => {
  const r = parseReddit(JSON.stringify({ kind: "Listing", data: { children: [{ kind: "t3", data: { id: "abc", author: "someone", title: "$MOONX 100x", selftext: "", created_utc: 1793332800, permalink: "/r/CryptoMoonShots/comments/abc/x/" } }, { kind: "t3", data: { id: "d", author: "[deleted]", created_utc: 1, permalink: "/x" } }] } }));
  assert.deepEqual(r.map((p) => [p.id, p.url, p.postedAt]), [["reddit:abc", "https://www.reddit.com/r/CryptoMoonShots/comments/abc/x/", "2026-10-30T04:00:00.000Z"]]);
  const f = parseFarcaster(JSON.stringify({ result: { casts: [{ hash: "0xabcdef1234567890", text: "$MOONX", timestamp: "2026-10-29T10:00:00.000Z", author: { username: "dwr", display_name: "D", follower_count: 5 } }] } }));
  assert.equal(f[0].url, "https://farcaster.xyz/dwr/0xabcdef12");
  assert.equal(f[0].followers, 5);
  assert.throws(() => parseReddit("{}"), ParseError);
});

test("counts: 1.2K, 3.4M, 987", () => {
  assert.deepEqual(["1.2K", "3.4M", "987", "12,345", "x"].map(parseCount), [1200, 3400000, 987, 12345, null]);
});

// ---------- signals ----------

test("disclosure: '#ad' says paid but not who or how much; a full disclosure names both; 'not sponsored' is not one", () => {
  const ad = readSignals("#ad Loving $MOONX");
  assert.equal(ad.disclosure.said, true);
  assert.equal(ad.disclosure.complete, false);
  assert.match(disclosureText(ad), /not who paid or how much/);
  const full = readSignals("Paid promotion: I was paid $5,000 by Moonx Labs to post about $MOONX.");
  assert.equal(full.disclosure.said, true);
  assert.equal(full.disclosure.payer, "Moonx Labs");
  assert.equal(full.disclosure.amount, "$5,000");
  assert.equal(full.disclosure.complete, true);
  assert.equal(readSignals("This is not sponsored, just my view on $ETH").disclosure.said, false);
  assert.equal(readSignals("Sponsored by Moonx Labs.").disclosure.payer, "Moonx Labs");
});

test("shill words, tickers and contracts", () => {
  const s = readSignals("$MOONX is the next 100x gem 🚀 buy now! CA: 94ygQzoJq1gLa88rzr3TCRN119s6C7YKV8u5hxcRpump and 0x1111111111111111111111111111111111111111");
  assert.ok(s.promotional);
  for (const w of ["100x", "gem", "🚀", "buy now", "next big"]) assert.ok(s.shill.includes(w), w);
  assert.deepEqual(s.contracts.map((c) => c.chain).sort(), ["evm", "solana"]);
  assert.equal(readSignals("Bitcoin dips below $80,000 as tech jitters").promotional, false);
  assert.deepEqual(contractsIn("https://example.com/AbCdEfGh"), []);
  // which coin: $/# in any case, the ticker in capitals as its own word; never a plain word or a longer ticker
  assert.deepEqual(symbolsIn("Pepe the frog. PEPENODE presale.", ["PEPE"]), []);
  assert.deepEqual(symbolsIn("$pepe and #WIF; BTC/USDT", ["PEPE", "WIF", "BTC"]), ["PEPE", "WIF", "BTC"]);
  assert.deepEqual(symbolsIn("OP is up", ["OP"]), [], "two-letter tickers need $ or #");
  assert.deepEqual(symbolsIn("$OP is up", ["OP"]), ["OP"]);
});

// ---------- config ----------

test("config from the environment: all optional, sensible defaults", () => {
  const d = socialConfigFromEnv(() => undefined);
  assert.deepEqual(d.sources, ["telegram", "bluesky", "reddit", "farcaster"]);
  assert.deepEqual(d.telegramChannels, DEFAULT_TELEGRAM_CHANNELS);
  assert.equal(d.reddit, null);
  assert.equal(d.neynarKey, null);
  const e: Record<string, string> = { SOCIAL_SOURCES: "Telegram, bluesky, nope", TELEGRAM_CHANNELS: "@a_chan, b_chan", SUBREDDITS: "r/One,Two", REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "s" };
  const c = socialConfigFromEnv((k) => e[k]);
  assert.deepEqual(c.sources, ["telegram", "bluesky"]);
  assert.deepEqual(c.telegramChannels, ["a_chan", "b_chan"]);
  assert.deepEqual(c.subreddits, ["One", "Two"]);
  assert.deepEqual(c.reddit, { clientId: "id", clientSecret: "s" });
  assert.deepEqual(socialConfigFromEnv((k) => (k === "SOCIAL_SOURCES" ? "off" : undefined)).sources, []);
});

// ---------- collector ----------

type Route = { status?: number; body?: string; headers?: Record<string, string>; hang?: boolean; throws?: string };

/** A fetch that answers from fixtures by URL, and remembers what it was asked (method, URL, headers). */
function fakeFetch(routes: (url: string) => Route | undefined) {
  const asked: { url: string; method: string; headers: Record<string, string> }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> });
    const r = routes(url) ?? { status: 404, body: "not found" };
    if (r.throws) throw new TypeError(r.throws);
    if (r.hang) return new Promise<Response>(() => {});
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": url.includes("t.me") ? "text/html; charset=utf-8" : "application/json", ...r.headers } });
  }) as typeof fetch;
  return Object.assign(f, { asked });
}

const scenarioFetch = () =>
  fakeFetch((url) => {
    const tg = url.match(/^https:\/\/t\.me\/s\/(\w+)$/);
    if (tg) return ["alpha_calls", "beta_gems", "gamma_signals"].includes(tg[1]) ? { body: fx(`scenario/telegram-${tg[1]}.html`) } : { body: fx("recorded/telegram-no-preview.html") };
    if (url.startsWith("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%23MOONX")) return { body: fx("scenario/bluesky-MOONX.json") };
    if (url.startsWith("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts")) return { body: '{"posts":[],"hitsTotal":0}' };
    return undefined;
  });

const collector = (f: typeof fetch, extra: Partial<ConstructorParameters<typeof SocialCollector>[0]> = {}) =>
  new SocialCollector({ sources: ["telegram", "bluesky", "reddit", "farcaster"], telegramChannels: ["alpha_calls", "beta_gems", "gamma_signals", "CryptoGems"], reddit: null, neynarKey: null, fetch: f, clock: stepClock(AT, 0), sleep: async () => {}, spacingMs: 0, ...extra });

test("collector: answered sources give posts, keyless-blocked sources are explained gaps, nothing throws", async () => {
  const f = scenarioFetch();
  const c = collector(f);
  const col = await c.collect(["MOONX", "ETH"]);
  const by = Object.fromEntries(col.sources.map((s) => [s.id, s]));
  assert.equal(by.telegram.state, "partial", "3 of 4 channels have a preview");
  assert.equal(by.telegram.answered, 3);
  assert.equal(by.bluesky.state, "answered");
  assert.equal(by.reddit.state, "gap");
  assert.equal(by.farcaster.state, "gap");
  assert.match(col.gaps.find((g) => g.source === "social:reddit")!.reason, /robots\.txt disallows automated access.*REDDIT_CLIENT_ID/);
  assert.match(col.gaps.find((g) => g.source === "social:farcaster")!.reason, /NEYNAR_API_KEY/);
  assert.match(col.gaps.find((g) => g.what === "Telegram @CryptoGems")!.reason, /no public web preview/);
  // no request was made to Reddit or Farcaster without credentials, and every request was a GET with an honest agent
  assert.ok(f.asked.every((a) => !/reddit|neynar|farcaster/.test(a.url)));
  assert.ok(f.asked.every((a) => a.method === "GET" && a.headers["user-agent"] === USER_AGENT));
  assert.match(USER_AGENT, /^Canary\/1\.0 \(\+https:\/\/github\.com\/Dakshhhhh-ops\/canary; hackathon research\)$/);

  const ids = col.posts.map((p) => p.id);
  assert.ok(ids.includes("tg:alpha_calls/101") && ids.includes("tg:beta_gems/7") && ids.includes("tg:gamma_signals/55") && ids.includes("tg:gamma_signals/56"));
  assert.ok(!ids.includes("tg:alpha_calls/102"), "about BTC, not one of the run's coins");
  const gamma = col.posts.find((p) => p.id === "tg:gamma_signals/55")!;
  assert.equal(gamma.promoter, "@gamma_signals (Telegram)");
  assert.equal(gamma.disclosedPayment, true);
  assert.equal(gamma.signals.disclosure.payer, "Moonx Labs");
  assert.equal(gamma.paid, undefined, "a live post never claims a documented payment");
  assert.equal(gamma.followers, 105000);
  // every post points at the raw reply it was read from
  for (const p of col.posts) assert.ok(c.log[col.logFrom + p.rawIndex].body!.includes(p.id.startsWith("tg:") ? `data-post="${p.id.slice(3).split("/")[0]}` : p.id.split("/").pop()!));
});

test("collector: 403, 429, a network error, a timeout and an oversized reply are each a gap, never a crash", async () => {
  const f = fakeFetch((url) => {
    if (url.endsWith("/s/blocked")) return { status: 403, body: "Forbidden" };
    if (url.endsWith("/s/busy")) return { status: 429, body: "", headers: { "retry-after": "30" } };
    if (url.endsWith("/s/down")) return { throws: "fetch failed" };
    if (url.endsWith("/s/slow")) return { hang: true };
    if (url.endsWith("/s/huge")) return { body: "x".repeat(5000) };
    if (url.includes("bsky")) return { status: 403, body: "<html>403 Forbidden</html>" };
    return undefined;
  });
  const c = collector(f, { telegramChannels: ["blocked", "busy", "down", "slow", "huge", "bad name!"], timeoutMs: 30, maxBodyBytes: 1000, sources: ["telegram", "bluesky"] });
  const col = await c.collect(["PEPE"]);
  assert.equal(col.posts.length, 0);
  const reasons = col.gaps.map((g) => `${g.what}: ${g.reason}`);
  for (const re of [/@blocked: refused \(http 403\)/, /@busy: rate limited \(429\), retry after 30 s/, /@down: fetch failed/, /@slow: timed out after 30 ms/, /@huge: reply too large/, /bad name!: not a valid public channel name/, /Bluesky #PEPE: refused \(http 403\)/])
    assert.ok(reasons.some((r) => re.test(r)), `${re} in ${reasons.join(" | ")}`);
  assert.deepEqual(col.sources.map((s) => s.state), ["gap", "gap", "off", "off"]);
  assert.ok(c.log.every((l) => !l.ok && l.body === null), "nothing kept from a failed request");
});

test("collector: with Reddit credentials the token reply is never kept and the key never reaches the log", async () => {
  const f = fakeFetch((url) => {
    if (url === "https://www.reddit.com/api/v1/access_token") return { body: '{"access_token":"tok-SECRET-123","token_type":"bearer"}' };
    if (url.startsWith("https://oauth.reddit.com/r/CryptoMoonShots/new")) return { body: JSON.stringify({ data: { children: [{ data: { id: "z1", author: "u1", title: "$MOONX to the moon 🚀", created_utc: Date.parse("2026-10-30T01:00:00Z") / 1000, permalink: "/r/CryptoMoonShots/comments/z1/" } }] } }) };
    return undefined;
  });
  const c = collector(f, { sources: ["reddit"], reddit: { clientId: "cid", clientSecret: "csecret" }, subreddits: ["CryptoMoonShots"] });
  const col = await c.collect(["MOONX"]);
  assert.equal(col.posts[0].promoter, "u/u1 (Reddit)");
  assert.equal(col.sources[2].state, "answered");
  const text = JSON.stringify(c.log);
  assert.ok(!text.includes("tok-SECRET-123") && !text.includes("csecret"));
  assert.equal(f.asked[1].headers.authorization, "Bearer tok-SECRET-123", "the token only travels in a header");
});

// ---------- the Multi-KOL watcher on live posts, inside a radar run ----------

async function scenarioRun(ryo?: RyoClient) {
  const clock = stepClock(AT);
  const social = collector(scenarioFetch());
  const run = await runLive(["MOONX", "ETH"], { ryo: ryo ?? new RyoClient({ apiKey: null, clock }), llm: null, clock, social });
  return { run, social };
}

test("radar run: promoters converging on MOONX, the copy-paste echo, and the one post that said it was an ad", async () => {
  const { run } = await scenarioRun();
  const v = run.social!.perSymbol.find((p) => p.symbol === "MOONX")!;
  assert.equal(v.h72.accounts, 5);
  assert.equal(v.h72.promotionalAccounts, 4, "the skeptic's question is not a push to buy");
  assert.equal(v.h72.disclosed, 1);
  assert.equal(v.h72.disclosedComplete, 0);
  assert.equal(v.h24.accounts, 4, "alpha_calls posted more than 24 hours before the run");
  assert.deepEqual(v.h72.contracts, ["0x1111111111111111111111111111111111111111"]);
  assert.ok(v.convergence?.detected);
  assert.equal(v.convergence!.promoters, 4);
  assert.equal(v.convergence!.independentVoices, 3, "alpha_calls and beta_gems posted the same words");
  assert.deepEqual(v.convergence!.echoGroups, [["@alpha_calls (Telegram)", "@beta_gems (Telegram)"]]);
  assert.match(v.summary, /4 promoters converge, but .*posted 100% the same words.*3 independent voices/);
  assert.match(v.summary, /none named both who paid and how much, which Securities Act §17\(b\) requires \(1 named the payer only\)/);
  const eth = run.social!.perSymbol.find((p) => p.symbol === "ETH")!;
  assert.equal(eth.convergence, null);
  assert.equal(eth.h72.promotional, 0);

  // the hunter counts the converging promoters; payment for live posts is never documented, so that rule stays unknown
  const h = [...run.hunter.selected, ...run.hunter.rejected].find((x) => x.symbol === "MOONX")!;
  assert.equal(h.rules.find((r) => r.id === "promoter-convergence")!.outcome, "red-flag");
  assert.equal(h.rules.find((r) => r.id === "undisclosed-paid")!.outcome, "unknown");
  const t = run.perSymbol.find((p) => p.symbol === "MOONX")!.trade;
  assert.equal(t.checks.find((c) => c.limit === "refuseUndisclosedPaidPromotion")!.value, "unknown");

  // the notebook: a collector.social step that fingerprints every raw reply, then the convergence step
  assert.ok(run.trailOk);
  const kinds = run.trail.map((e) => e.kind);
  assert.ok(kinds.indexOf("collector.social") > kinds.indexOf("collector.ryo-unavailable"));
  assert.ok(kinds.indexOf("convergence.detected") > kinds.indexOf("collector.social"));
  // the judge's evidence bundle quotes the live posts with their links
  const judge = run.perSymbol.find((p) => p.symbol === "MOONX")!.debate;
  assert.ok(judge.bull.claims.length + judge.bear.claims.length > 0);
  assert.ok(run.gaps.some((g) => g.source === "social:reddit"));
});

test("radar run: the notebook's fingerprints are SHA-256 of each raw body; same replies, same notebook", async () => {
  const a = await scenarioRun();
  const step = a.run.trail.find((e) => e.kind === "collector.social")!;
  const raw = (step.data as { raw: { digest: string | null; url: string }[] }).raw;
  assert.equal(raw.length, a.social.log.length);
  for (let i = 0; i < raw.length; i++) assert.equal(raw[i].digest, a.social.log[i].body == null ? null : await sha256Hex(a.social.log[i].body!));
  const b = await scenarioRun();
  assert.equal(canonical(a.run.trail.map((e) => e.data)), canonical(b.run.trail.map((e) => e.data)));
  assert.equal(a.run.headHash, b.run.headHash);
});

test("radar run without social sources is unchanged: no social step, no convergence", async () => {
  const run = await runLive(["AAA"], { ryo: new RyoClient({ apiKey: null }), llm: null, clock: stepClock(AT) });
  assert.equal(run.social, null);
  assert.equal(run.convergence, null);
  assert.ok(!run.trail.some((e) => e.kind.startsWith("collector.social")));
});

// ---------- saved runs ----------

test("saved run keeps every raw social reply; the browser check re-hashes them; an edit is caught", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canary-social-"));
  try {
    const clock = stepClock(AT);
    const ryo = client(server({ analyze_token: { MOONX: withHolders(analyzeA(), 18), ETH: withHolders(analyzeA(), 18) }, deep_analysis: { "*": deepA() } }), clock);
    const { run, social } = await scenarioRun(ryo);
    const { file } = await saveRun({ run, rawRyo: ryo.log, rawSocial: social.log, trigger: "manual", dir, updateLedger: false });
    const s = (await readRun(file, dir))!;
    assert.equal(s.rawSocial!.length, social.log.length);
    const check = await verifySavedRun(s);
    assert.deepEqual(check.problems, []);
    assert.equal(check.socialChecked, social.log.length);
    const text = await readFile(path.join(dir, "runs", file), "utf8");
    assert.deepEqual(findSecrets(text, {}), []);

    const edited = structuredClone(s);
    const i = edited.rawSocial!.findIndex((c) => c.target === "@gamma_signals");
    edited.rawSocial![i].body = edited.rawSocial![i].body!.replace("#ad Partnered post", "Partnered post");
    const bad = await verifySavedRun(edited);
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join(" "), /social reply \d+ \(telegram @gamma_signals\) does not match/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a third-party reply that merely looks key-shaped is withheld from the file, not saved and not fatal", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canary-social-"));
  try {
    const clock = stepClock(AT);
    const ryo = client(server({ analyze_token: { "*": analyzeA() } }), clock);
    const f = fakeFetch((url) => (url.includes("t.me") ? { body: fx("scenario/telegram-alpha_calls.html").replace("Old news:", "Old news: sk-or-abcdefghijklmnop12345") } : { body: '{"posts":[]}' }));
    const social = collector(f, { telegramChannels: ["alpha_calls"], sources: ["telegram"] });
    const run = await runLive(["MOONX"], { ryo, llm: null, clock, social });
    const { file } = await saveRun({ run, rawRyo: ryo.log, rawSocial: social.log, trigger: "manual", dir, updateLedger: false });
    const s = (await readRun(file, dir))!;
    assert.equal(s.rawSocial![0].body, null);
    assert.match(s.rawSocial![0].withheld!, /looks like an OpenRouter key/);
    const check = await verifySavedRun(s);
    assert.equal(check.ok, true);
    assert.equal(check.socialWithheld, 1);
    assert.deepEqual(findSecrets(await readFile(path.join(dir, "runs", file), "utf8"), {}), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
