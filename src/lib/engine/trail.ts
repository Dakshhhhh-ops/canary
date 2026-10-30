// Hash-chained reasoning trail. Each entry stores the previous entry's hash and its own
// SHA-256 over canonical JSON (sorted keys, no whitespace) of every field except `hash`.
// Change one byte anywhere and verifyTrail names the first entry that no longer adds up.
// Uses Web Crypto only, so the browser can re-verify a trail the server produced.

import { canonical, sha256Hex } from "../canonical";
import type { TrailEntry } from "../types";

export const GENESIS = "0".repeat(64);

export type Clock = () => string;

/** Real time. */
export const systemClock: Clock = () => new Date().toISOString();

/** Deterministic clock: start, start+step, start+2*step, ... (for tests and replays). */
export function stepClock(startIso: string, stepMs = 1000): Clock {
  let n = 0;
  const t0 = Date.parse(startIso);
  return () => new Date(t0 + stepMs * n++).toISOString();
}

export type TrailInput = Omit<TrailEntry, "seq" | "at" | "prevHash" | "hash">;

/** JSON round-trip so the stored data is exactly what was hashed (drops undefined, functions, NaN → null). */
const jsonSafe = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export async function hashEntry(entry: Omit<TrailEntry, "hash">): Promise<string> {
  const { seq, at, agent, kind, summary, evidenceIds, data, prevHash } = entry;
  return sha256Hex(canonical({ seq, at, agent, kind, summary, evidenceIds, data, prevHash }));
}

export class Trail {
  readonly entries: TrailEntry[] = [];
  constructor(private clock: Clock = systemClock) {}

  get head(): string {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
  }

  /** Append one step. seq, at, prevHash and hash are filled in here. */
  async append(input: TrailInput): Promise<TrailEntry> {
    const body: Omit<TrailEntry, "hash"> = {
      seq: this.entries.length,
      at: this.clock(),
      agent: input.agent,
      kind: input.kind,
      summary: input.summary,
      evidenceIds: [...input.evidenceIds],
      data: jsonSafe(input.data),
      prevHash: this.head,
    };
    const entry: TrailEntry = { ...body, hash: await hashEntry(body) };
    this.entries.push(entry);
    return entry;
  }
}

export type TrailCheck = { ok: true; count: number; head: string } | { ok: false; seq: number; reason: string };

/** Walk the chain from the start; report the first entry whose seq, link or hash is wrong. */
export async function verifyTrail(entries: readonly TrailEntry[]): Promise<TrailCheck> {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { ok: false, seq: i, reason: `entry ${i} says seq ${e.seq}: an entry was removed, added or reordered` };
    if (e.prevHash !== prev) return { ok: false, seq: i, reason: `entry ${i} points to ${short(e.prevHash)} but the previous entry's hash is ${short(prev)}` };
    const { hash, ...body } = e;
    const expected = await hashEntry(body);
    if (hash !== expected) return { ok: false, seq: i, reason: `entry ${i} was changed after it was written (hash ${short(hash)} ≠ recomputed ${short(expected)})` };
    prev = hash;
  }
  return { ok: true, count: entries.length, head: prev };
}

const short = (h: string) => `${String(h).slice(0, 10)}…`;
