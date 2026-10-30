// src/lib/claims/verify.ts: the app side of the canary-claims Chainlink CRE workflow.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  caseIdForSlug,
  createTriggerJwt,
  forwardToWorkflow,
  simulateCommand,
  stableStringify,
  triggerMissing,
  validateVerifyRequest,
  workflowInput,
} from "../src/lib/claims/verify";
import type { PurchaseReport } from "../src/lib/hotline/purchases";

const demoPayload = JSON.parse(readFileSync("cre/canary-claims/payloads/demo-emax.json", "utf8"));
const workflowConfig = JSON.parse(readFileSync("cre/canary-claims/config.staging.json", "utf8"));
const snap = JSON.parse(readFileSync("src/lib/hotline/demoSnapshot.json", "utf8")) as PurchaseReport;
const KEY = `0x${"11".repeat(32)}` as Hex; // test-only key
const body = {
  wallet: "0xac85724be118b69a9aee3b03bd2af2ac0071f26a",
  evidenceHash: demoPayload.evidenceHash,
  claimantRef: demoPayload.claimantRef,
  walletSalt: demoPayload.walletSalt,
  purchaseBlocks: snap.purchases.filter((p) => p.inClassPeriod).map((p) => p.blockNumber),
};
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

test("the case id matches the workflow config and the app's caseIdOf", () => {
  assert.equal(caseIdForSlug("emax"), workflowConfig.cases[0].caseId);
});

test("validates verify requests", () => {
  const ok = validateVerifyRequest(body);
  assert.ok(ok);
  assert.equal(ok.caseSlug, "emax");
  assert.equal(ok.wallet, "0xAC85724Be118b69a9AeE3B03bd2af2aC0071F26a");
  assert.equal(validateVerifyRequest({ ...body, wallet: "0x123" }), null);
  assert.equal(validateVerifyRequest({ ...body, evidenceHash: `0x${"00".repeat(32)}` }), null);
  assert.equal(validateVerifyRequest({ ...body, walletSalt: "0x12" }), null);
  assert.equal(validateVerifyRequest({ ...body, purchaseBlocks: [1.5] }), null);
  assert.equal(validateVerifyRequest({ ...body, purchaseBlocks: new Array(201).fill(1) }), null);
  assert.equal(validateVerifyRequest(null), null);
  assert.equal(validateVerifyRequest({ ...body, purchaseBlocks: undefined })?.purchaseBlocks, undefined);
});

test("the hotline demo wallet produces exactly the documented demo payload", () => {
  const req = validateVerifyRequest(body)!;
  const input = workflowInput(req, req.purchaseBlocks!, req.walletSalt!);
  assert.deepEqual(input, demoPayload);
  const cmd = simulateCommand(input);
  assert.match(cmd, /^cre workflow simulate \.\/canary-claims -T staging-settings --non-interactive --trigger-index 0 --http-payload '/);
  assert.deepEqual(JSON.parse(cmd.slice(cmd.indexOf("'") + 1, -1)), demoPayload);
});

test("reports which trigger settings are missing", () => {
  assert.deepEqual(triggerMissing({}), ["CRE_CLAIMS_TRIGGER_URL", "CRE_CLAIMS_WORKFLOW_ID", "CRE_CLAIMS_TRIGGER_KEY"]);
  assert.deepEqual(triggerMissing({ CRE_CLAIMS_TRIGGER_URL: "https://01.gateway.zone-a.cre.chain.link", CRE_CLAIMS_WORKFLOW_ID: "ab".repeat(32), CRE_CLAIMS_TRIGGER_KEY: KEY }), []);
});

test("stableStringify sorts keys at every level", () => {
  assert.equal(stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}');
});

test("the gateway JWT carries the request digest and recovers to the signing key", async () => {
  const request = { jsonrpc: "2.0", id: "r1", method: "workflows.execute", params: { input: demoPayload, workflow: { workflowID: "ab".repeat(32) } } };
  const jwt = await createTriggerJwt(request, KEY, 1_800_000_000);
  const [h, p, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(fromB64url(h).toString()), { alg: "ETH", typ: "JWT" });
  const payload = JSON.parse(fromB64url(p).toString());
  assert.equal(payload.digest, `0x${createHash("sha256").update(stableStringify(request)).digest("hex")}`);
  assert.equal(payload.exp - payload.iat, 300);
  const raw = fromB64url(sig);
  assert.equal(raw.length, 65);
  assert.ok(raw[64] === 0 || raw[64] === 1);
  const signature = `0x${raw.subarray(0, 64).toString("hex")}${(raw[64] + 27).toString(16)}` as Hex;
  const signer = await recoverMessageAddress({ message: `${h}.${p}`, signature });
  assert.equal(signer, privateKeyToAccount(KEY).address);
  assert.equal(payload.iss, signer);
});

test("forwards the claim to the CRE gateway as a signed workflows.execute request", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { workflow_execution_id: "exec-1" } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = { CRE_CLAIMS_TRIGGER_URL: "https://01.gateway.zone-a.cre.chain.link", CRE_CLAIMS_WORKFLOW_ID: "AB".repeat(32), CRE_CLAIMS_TRIGGER_KEY: KEY };
  const out = await forwardToWorkflow(demoPayload, { env, fetchImpl });
  assert.deepEqual(out.gateway, { workflow_execution_id: "exec-1" });
  assert.ok(seen);
  const { url, init } = seen as { url: string; init: RequestInit };
  assert.equal(url, env.CRE_CLAIMS_TRIGGER_URL);
  const sent = JSON.parse(String(init.body));
  assert.equal(sent.method, "workflows.execute");
  assert.equal(sent.params.workflow.workflowID, "ab".repeat(32));
  assert.deepEqual(sent.params.input, demoPayload);
  const jwt = String((init.headers as Record<string, string>).authorization).replace(/^Bearer /, "");
  const payload = JSON.parse(fromB64url(jwt.split(".")[1]).toString());
  assert.equal(payload.digest, `0x${createHash("sha256").update(String(init.body)).digest("hex")}`);

  const failing = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(forwardToWorkflow(demoPayload, { env, fetchImpl: failing }), /HTTP 401/);
});
