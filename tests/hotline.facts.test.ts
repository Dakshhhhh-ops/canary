import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toHotlineCase } from "../src/lib/hotline/caseFacts";
import type { CaseFile } from "../src/lib/types";

const cf = JSON.parse(readFileSync("data/cases/emax.json", "utf8")) as CaseFile;
const k = toHotlineCase(cf);

test("class period typed into caseFacts matches the case file's own words", () => {
  assert.deepEqual(k.classAction?.classPeriod, { from: "2021-05-14", to: "2021-06-27" });
  assert.ok(cf.dataNotes.some((n) => n.includes("purchases from May 14 to June 27, 2021")));
  assert.match(readFileSync("data/cases/emax.sources.md", "utf8"), /class period is May 14 – June 27, 2021/);
});

test("certified states match the case file's August 2025 entry", () => {
  const cert = cf.legal.find((l) => l.id === "class-action-certified-2025")!;
  for (const name of ["California", "Florida", "New York", "New Jersey"]) assert.ok(cert.summary.includes(name), name);
  assert.match(cert.summary, /refused a nationwide class/);
  assert.deepEqual(k.classAction?.certifiedStates, ["CA", "FL", "NY", "NJ"]);
});

test("docket, judge, status and pool block come from the case file", () => {
  assert.ok(cf.legal.some((l) => l.title.includes(k.classAction!.docket)));
  assert.ok(cf.legal.some((l) => l.summary.includes(k.classAction!.judge)));
  assert.ok(cf.legal.some((l) => l.title.includes(k.classAction!.formerName.replace(" et al.", ""))));
  assert.ok(cf.dataNotes.some((n) => n.includes(`block ${k.pairCreatedBlock}`)));
  assert.equal(k.classAction?.status, cf.legal.find((l) => l.id === "class-action-certified-2025")!.outcome);
});
