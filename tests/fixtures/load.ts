// TEST FIXTURE loader: a fictional token and fictional promoters, illustrative numbers only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseFile } from "../../src/lib/types";

export const loadFixture = (): CaseFile => JSON.parse(readFileSync(join(__dirname, "case.fixture.json"), "utf8"));
