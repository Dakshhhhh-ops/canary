import assert from "node:assert/strict";
import { test } from "node:test";
import { detectConvergence, textSimilarity } from "../src/lib/engine/convergence";
import type { PromoterPost } from "../src/lib/types";
import { loadFixture } from "./fixtures/load";

const post = (id: string, promoter: string, postedAt: string, text: string, extra: Partial<PromoterPost> = {}): PromoterPost => ({
  id,
  promoter,
  platform: "x",
  postedAt,
  datePrecision: "day",
  text,
  disclosedPayment: false,
  sources: [],
  ...extra,
});

test("copy-paste similarity", () => {
  assert.ok(textSimilarity("Sharing what my friends just told me about $ABC! Swipe up now", "sharing what my friends just told me about $ABC!! swipe up now 🚀") > 0.8);
  assert.ok(textSimilarity("Big night. Proud to rep $ABC.", "Sharing what my friends told me about $ABC") < 0.3);
});

test("fixture: 5 promoters converge, echoes collapse them to 3 independent voices", () => {
  const r = detectConvergence(loadFixture().posts, { tokenOf: "FMAX", windowHours: 14 * 24 });
  assert.equal(r.detected, true);
  const ev = r.events[0];
  assert.equal(ev.promoters.length, 5);
  assert.equal(ev.independentVoices, 3);
  assert.ok(ev.echoLinks.some((l) => l.reason === "same-payer" && l.a === "post-a" && l.b === "post-b"), "payer match ignores case");
  assert.ok(ev.echoLinks.some((l) => l.reason === "copy-paste"));
  assert.deepEqual(ev.disclosure.paidButUndisclosed, ["post-a", "post-b"]);
  assert.deepEqual(ev.disclosure.disclosed, ["post-e"]);
  assert.ok(!ev.postIds.includes("post-f"), "a post from two months earlier is outside the window");
});

test("many accounts, few independent voices = coordinated", () => {
  const r = detectConvergence(loadFixture().posts, { tokenOf: "FMAX", windowHours: 14 * 24, minPromoters: 4 });
  assert.equal(r.events[0].coordinated, true);
  assert.match(r.events[0].reasoning.join(" "), /organised, not organic/);
});

test("cashtags attribute tokens; window and threshold respected", () => {
  const posts = [
    post("1", "A", "2024-01-01", "buy $ZZZ now"),
    post("2", "B", "2024-01-02", "loving $ZZZ and $QQQ"),
    post("3", "C", "2024-01-03", "$zzz is the next big thing"),
    post("4", "D", "2024-01-20", "$ZZZ again"),
    post("5", "E", "2024-01-02", "no token here"),
  ];
  const r = detectConvergence(posts, { windowHours: 72 });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].token, "ZZZ");
  assert.deepEqual(r.events[0].postIds, ["1", "2", "3"]);
  assert.equal(r.events[0].independentVoices, 3);
  assert.equal(r.events[0].coordinated, false);
  assert.deepEqual(r.skipped.map((s) => s.postId), ["5"]);
  assert.equal(detectConvergence(posts, { windowHours: 24 }).detected, false);
});

test("the same promoter posting three times is one promoter", () => {
  const posts = [post("1", "A", "2024-01-01", "$ZZZ"), post("2", "A", "2024-01-01", "$ZZZ!"), post("3", "A", "2024-01-02", "$ZZZ!!")];
  const r = detectConvergence(posts);
  assert.equal(r.detected, false);
  assert.equal(r.bestCluster?.promoters.length, 1);
});
