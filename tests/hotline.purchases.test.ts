import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toHotlineCase } from "../src/lib/hotline/caseFacts";
import { checkAddress, findPurchases, formatUnits, getLogsChunked, httpRpc, postsBefore, RpcError, TRANSFER_TOPIC, type Rpc } from "../src/lib/hotline/purchases";
import type { CaseFile } from "../src/lib/types";

const k = toHotlineCase(JSON.parse(readFileSync("data/cases/emax.json", "utf8")) as CaseFile);
const WALLET = "0xac85724be118b69a9aee3b03bd2af2ac0071f26a";
const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const ts = (iso: string) => "0x" + (Date.parse(iso) / 1000).toString(16);
const amt = (tokens: bigint) => "0x" + (tokens * 10n ** 18n).toString(16);

function log(from: string, to: string, tokens: bigint, iso: string, tx: string, block: number) {
  return { address: k.token.address, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: amt(tokens), blockNumber: "0x" + block.toString(16), transactionHash: tx, logIndex: "0x1", blockTimestamp: ts(iso) };
}

const TX1 = "0x" + "a1".repeat(32);
const TX2 = "0x" + "b2".repeat(32);
const TX3 = "0x" + "c3".repeat(32);

function mockRpc(calls: unknown[][] = []): Rpc {
  return async (method, params) => {
    calls.push([method, params]);
    if (method === "eth_blockNumber") return "0x1400000";
    if (method === "eth_getLogs") {
      const f = (params as { topics: (string | string[] | null)[]; fromBlock: string }[])[0];
      assert.equal(f.topics[0], TRANSFER_TOPIC);
      assert.deepEqual(f.topics[1], [pad(k.token.pair!), pad(WALLET)]);
      if (parseInt(f.fromBlock, 16) !== k.pairCreatedBlock) return [];
      return [
        log(k.token.pair!, WALLET, 1_000_000_000n, "2021-06-15T11:15:08Z", TX1, 12638738),
        log(k.token.pair!, WALLET, 2_000_000_000n, "2021-08-01T00:00:00Z", TX2, 12900000),
        log(WALLET, k.token.pair!, 500_000_000n, "2021-06-20T10:00:00Z", TX3, 12670000),
      ];
    }
    throw new Error("unexpected " + method);
  };
}

test("addresses: valid, wrong length, bad checksum", () => {
  const c = checkAddress(WALLET);
  assert.equal(c.ok && c.address, "0xAC85724Be118b69a9AeE3B03bd2af2aC0071F26a");
  assert.equal(checkAddress("0x1234").ok, false);
  assert.equal(checkAddress("ac85724be118b69a9aee3b03bd2af2ac0071f26a").ok, false);
  assert.equal(checkAddress("0xAC85724Be118b69a9AeE3B03bd2af2aC0071F26A").ok, false); // last letter's case flipped
  assert.equal(checkAddress("0xzz85724be118b69a9aee3b03bd2af2ac0071f26a").ok, false);
});

test("formatUnits keeps every digit", () => {
  assert.equal(formatUnits(1924122545506946367218507928n, 18), "1924122545.506946367218507928");
  assert.equal(formatUnits(10n ** 18n, 18), "1");
  assert.equal(formatUnits(0n, 18), "0");
});

test("posts in the 3 days before a buy (day precision; month-precision posts skipped)", () => {
  const p = postsBefore(k, "2021-06-15");
  assert.deepEqual(
    p.map((x) => [x.postId, x.daysBefore]),
    [["kardashian-2021-06-13", 2]],
  );
  assert.equal(p[0].documentedBy, "SEC order");
  assert.equal(postsBefore(k, "2021-06-17").length, 0);
  assert.ok(postsBefore(k, "2021-06-02").every((x) => x.postId !== "mayweather-2021-06-conference"));
});

test("findPurchases: buys, sells, prices, class period, posts, tx links", async () => {
  const calls: unknown[][] = [];
  const r = await findPurchases(WALLET, k, { rpc: mockRpc(calls), now: () => new Date("2026-10-30T00:00:00Z") });
  assert.equal(r.address, "0xAC85724Be118b69a9AeE3B03bd2af2aC0071F26a");
  assert.equal(r.purchases.length, 2);
  assert.equal(r.sales.length, 1);
  const [a, b] = r.purchases;
  assert.equal(a.txHash, TX1);
  assert.equal(a.txUrl, `https://etherscan.io/tx/${TX1}`);
  assert.equal(a.at, "2021-06-15T11:15:08Z");
  assert.equal(a.amount, "1000000000");
  assert.equal(a.priceUsd, k.prices.find((p) => p.t === "2021-06-15")!.priceUsd);
  assert.equal(a.usdEstimate, Math.round(1e9 * a.priceUsd! * 100) / 100);
  assert.equal(a.inClassPeriod, true);
  assert.equal(a.postsBefore[0].promoter, "Kim Kardashian");
  assert.equal(b.inClassPeriod, false); // August 2021 is after June 27
  assert.equal(r.sales[0].txHash, TX3);
  assert.equal(r.totals.boughtTokens, "3000000000");
  assert.equal(r.totals.soldTokens, "500000000");
  assert.equal(r.totals.inClassPeriod, 1);
  assert.equal(r.totals.afterAPost, 1);
  assert.equal(r.source.fromBlock, k.pairCreatedBlock);
  // the range from the pool's creation to the head is fetched in 8M-block chunks
  assert.equal(calls.filter((c) => c[0] === "eth_getLogs").length, Math.ceil((0x1400000 - k.pairCreatedBlock + 1) / 8_000_000));
});

test("findPurchases rejects a bad address before any request", async () => {
  const calls: unknown[][] = [];
  await assert.rejects(findPurchases("0x123", k, { rpc: mockRpc(calls) }));
  assert.equal(calls.length, 0);
});

test("getLogsChunked splits a range the node says is too big", async () => {
  const seen: [number, number][] = [];
  const rpc: Rpc = async (_m, params) => {
    const f = (params as { fromBlock: string; toBlock: string }[])[0];
    const a = parseInt(f.fromBlock, 16);
    const b = parseInt(f.toBlock, 16);
    seen.push([a, b]);
    if (b - a > 1000) throw new RpcError("query returned more than 10000 results", false, true);
    return [];
  };
  await getLogsChunked(rpc, { address: k.token.address, topics: [TRANSFER_TOPIC] }, 0, 3999, 4000);
  const covered = seen.filter(([a, b]) => b - a <= 1000).reduce((s, [a, b]) => s + (b - a + 1), 0);
  assert.equal(covered, 4000);
});

test("httpRpc retries HTTP 429 with backoff, then succeeds", async () => {
  let n = 0;
  const fakeFetch = (async () => {
    n++;
    if (n < 3) return new Response("slow down", { status: 429 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }), { status: 200 });
  }) as unknown as typeof fetch;
  const rpc = httpRpc("http://rpc.test", { fetchImpl: fakeFetch, minGapMs: 0, retries: 4 });
  assert.equal(await rpc("eth_blockNumber", []), "0x10");
  assert.equal(n, 3);
});

test("httpRpc does not retry a plain RPC error", async () => {
  let n = 0;
  const fakeFetch = (async () => {
    n++;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid params" } }), { status: 200 });
  }) as unknown as typeof fetch;
  await assert.rejects(httpRpc("http://rpc.test", { fetchImpl: fakeFetch, minGapMs: 0 })("eth_getLogs", []));
  assert.equal(n, 1);
});

test("the demo wallet is a real sample buyer from the case file, with a saved real lookup", () => {
  assert.ok(k.demoWallet);
  const cf = JSON.parse(readFileSync("data/cases/emax.json", "utf8"));
  assert.ok(cf.buyersInWindow.sample.some((s: { address: string }) => s.address === k.demoWallet!.address));
  const snap = JSON.parse(readFileSync("src/lib/hotline/demoSnapshot.json", "utf8"));
  assert.equal(snap.address.toLowerCase(), k.demoWallet!.address.toLowerCase());
  assert.ok(snap.purchases.length > 0);
  // the case file's sample says this wallet's first buy in the window was this transaction
  const sample = cf.buyersInWindow.sample.find((s: { address: string }) => s.address === k.demoWallet!.address);
  assert.ok(snap.purchases.some((p: { txHash: string }) => p.txHash === sample.txHash));
});
