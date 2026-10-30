import assert from "node:assert/strict";
import { test } from "node:test";
import { GENESIS, hashEntry, stepClock, Trail, verifyTrail } from "../src/lib/engine/trail";

async function sample() {
  const t = new Trail(stepClock("2026-10-30T00:00:00Z"));
  await t.append({ agent: "collector", kind: "a", summary: "one", evidenceIds: ["x"], data: { n: 1, skip: undefined } });
  await t.append({ agent: "convergence", kind: "b", summary: "two", evidenceIds: [], data: [1, 2, 3] });
  await t.append({ agent: "judge", kind: "c", summary: "three", evidenceIds: ["y", "z"], data: { b: 2, a: 1 } });
  return t;
}

test("trail chains hashes and verifies", async () => {
  const t = await sample();
  assert.equal(t.entries[0].prevHash, GENESIS);
  assert.equal(t.entries[1].prevHash, t.entries[0].hash);
  assert.equal(t.entries[1].at, "2026-10-30T00:00:01.000Z");
  assert.match(t.entries[2].hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(t.entries[0].data, { n: 1 }); // undefined dropped before hashing: what is stored is what was hashed
  assert.equal((await verifyTrail(t.entries)).ok, true);
});

test("identical inputs give an identical trail", async () => {
  const a = await sample();
  const b = await sample();
  assert.deepEqual(a.entries, b.entries);
});

test("survives a JSON round trip (as sent to the browser)", async () => {
  const t = await sample();
  assert.equal((await verifyTrail(JSON.parse(JSON.stringify(t.entries)))).ok, true);
});

test("tampering with data is caught at that entry", async () => {
  const t = await sample();
  const forged = structuredClone(t.entries);
  (forged[1].data as number[])[0] = 99;
  const v = await verifyTrail(forged);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.seq, 1);
    assert.match(v.reason, /changed after it was written/);
  }
});

test("re-hashing a forged entry still breaks the next link", async () => {
  const t = await sample();
  const forged = structuredClone(t.entries);
  forged[0].summary = "forged";
  const { hash: _h, ...body } = forged[0];
  void _h;
  forged[0].hash = await hashEntry(body);
  const v = await verifyTrail(forged);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.seq, 1);
});

test("removing an entry is caught", async () => {
  const t = await sample();
  const v = await verifyTrail([t.entries[0], t.entries[2]]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.seq, 1);
});
