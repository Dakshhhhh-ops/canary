// Paper ledger across runs. Practice money only: nothing here can place an order.
//
// The ledger's history IS a hash-chained trail (trail.ts): every change — a run arriving, a position
// opened by an accepted practice trade, a mark to market, a close at stop / take-profit / expiry, a
// trade skipped by the circuit breaker — is one entry. The current state (open positions, closed
// trades, totals) is never stored on its own authority: it is re-derived by replaying the trail, so
// verifying the chain verifies the numbers. Browser-safe (Web Crypto only), so judges can re-check it.

import { canonical } from "../canonical";
import { DAY, fmtUsd } from "./series";
import { systemClock, Trail, verifyTrail, type Clock } from "./trail";
import type { LiveRun } from "./pipeline";
import type { RiskLimits } from "./types";
import type { TrailEntry } from "../types";

export const LEDGER_FORMAT = "canary.radar.ledger/1";
export const DEFAULT_EXPIRY_DAYS = 7;

export type Position = {
  id: string; // "<symbol>@<openedAt>"
  symbol: string;
  openedAt: string;
  entryPriceUsd: number;
  sizeUsd: number;
  qty: number; // coins bought with sizeUsd at the entry price
  stopPriceUsd: number;
  takeProfitPriceUsd: number;
  expiresAt: string;
  evidenceIds: string[];
  runFile: string; // saved run that opened it
  runTrailHead: string; // that run's trail head
  riskEntryHash: string; // the trail entry where the risk desk accepted it
  lastPriceUsd: number;
  lastMarkAt: string;
  unrealisedUsd: number;
};

export type ClosedTrade = Position & {
  closedAt: string;
  exitPriceUsd: number;
  reason: "stop" | "take-profit" | "expiry";
  pnlUsd: number;
  note: string;
  closeRunFile: string;
};

export type LedgerRunRef = { file: string; at: string; head: string; symbols: string[]; accepted: number; refused: number; trigger: string };

export type LedgerState = {
  positions: Position[];
  closed: ClosedTrade[];
  runs: LedgerRunRef[];
  totals: { realisedUsd: number; unrealisedUsd: number; opened: number; closed: number; wins: number; losses: number };
};

export type LedgerFile = { format: typeof LEDGER_FORMAT; updatedAt: string; state: LedgerState; trail: TrailEntry[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const emptyState = (): LedgerState => ({ positions: [], closed: [], runs: [], totals: { realisedUsd: 0, unrealisedUsd: 0, opened: 0, closed: 0, wins: 0, losses: 0 } });
export const emptyLedger = (at: string): LedgerFile => ({ format: LEDGER_FORMAT, updatedAt: at, state: emptyState(), trail: [] });

// ---------- replay: state is a pure function of the trail ----------

type MarkData = { id: string; priceUsd: number; at: string; unrealisedUsd: number };
type CloseData = { id: string; at: string; exitPriceUsd: number; reason: ClosedTrade["reason"]; pnlUsd: number; note: string; runFile: string };

function apply(state: LedgerState, e: TrailEntry): LedgerState {
  const d = e.data as Record<string, unknown>;
  switch (e.kind) {
    case "ledger.run":
      state.runs.push(d as unknown as LedgerRunRef);
      break;
    case "ledger.open":
      state.positions.push({ ...(d as unknown as Position) });
      state.totals.opened++;
      break;
    case "ledger.mark": {
      const m = d as unknown as MarkData;
      const p = state.positions.find((x) => x.id === m.id);
      if (p) Object.assign(p, { lastPriceUsd: m.priceUsd, lastMarkAt: m.at, unrealisedUsd: m.unrealisedUsd });
      break;
    }
    case "ledger.close": {
      const c = d as unknown as CloseData;
      const i = state.positions.findIndex((x) => x.id === c.id);
      if (i < 0) break;
      const [p] = state.positions.splice(i, 1);
      state.closed.push({ ...p, lastPriceUsd: c.exitPriceUsd, lastMarkAt: c.at, unrealisedUsd: 0, closedAt: c.at, exitPriceUsd: c.exitPriceUsd, reason: c.reason, pnlUsd: c.pnlUsd, note: c.note, closeRunFile: c.runFile });
      state.totals.closed++;
      if (c.pnlUsd >= 0) state.totals.wins++;
      else state.totals.losses++;
      break;
    }
    // ledger.skip / ledger.no-price / ledger.breaker change nothing: they are the record of a decision not to act
  }
  state.totals.realisedUsd = r2(state.closed.reduce((s, c) => s + c.pnlUsd, 0));
  state.totals.unrealisedUsd = r2(state.positions.reduce((s, p) => s + p.unrealisedUsd, 0));
  return state;
}

export const replayLedger = (entries: readonly TrailEntry[]): LedgerState => entries.reduce(apply, emptyState());

/** Losses realised on a UTC day (for the daily circuit breaker). */
export const lossOnDay = (state: LedgerState, dayIso: string) => r2(state.closed.filter((c) => c.closedAt.slice(0, 10) === dayIso.slice(0, 10) && c.pnlUsd < 0).reduce((s, c) => s - c.pnlUsd, 0));

/** The chain is intact AND the stored state is exactly what replaying it gives. */
export async function verifyLedger(file: LedgerFile): Promise<{ ok: true; entries: number; head: string } | { ok: false; reason: string }> {
  const chain = await verifyTrail(file.trail);
  if (!chain.ok) return { ok: false, reason: `ledger trail broken at entry ${chain.seq}: ${chain.reason}` };
  if (canonical(replayLedger(file.trail)) !== canonical(file.state)) return { ok: false, reason: "the stored positions and totals do not match what the ledger trail adds up to" };
  return { ok: true, entries: chain.count, head: chain.head };
}

// ---------- update after a run ----------

export type LedgerUpdate = {
  run: LiveRun;
  runFile: string;
  trigger: string; // "schedule" | "manual" | "ui" | ...
  limits?: RiskLimits; // defaults to the run's own limits
  expiryDays?: number;
  clock?: Clock;
};

/**
 * Apply one saved run to the ledger: record the run, mark every open position the run priced, close
 * those that hit their stop or take-profit or expired, then open a position for each ACCEPTED practice
 * trade (unless one is already open in that coin, or today's realised losses tripped the breaker).
 */
export async function updateLedger(prev: LedgerFile | null, u: LedgerUpdate): Promise<{ file: LedgerFile; added: TrailEntry[] }> {
  if (u.run.mode !== "live") throw new Error("only live runs can touch the paper ledger");
  const clock = u.clock ?? systemClock;
  const limits = u.limits ?? u.run.limits;
  const expiryMs = (u.expiryDays ?? DEFAULT_EXPIRY_DAYS) * DAY;
  const trail = new Trail(clock);
  if (prev) {
    const ok = await verifyTrail(prev.trail);
    if (!ok.ok) throw new Error(`the existing ledger does not verify (entry ${ok.seq}: ${ok.reason}); refusing to build on it`);
    trail.entries.push(...prev.trail);
  }
  const state = replayLedger(trail.entries);
  const start = trail.entries.length;
  const add = async (kind: string, summary: string, evidenceIds: string[], data: unknown) => apply(state, await trail.append({ agent: "risk", kind, summary, evidenceIds, data }));

  const accepted = u.run.perSymbol.filter((p) => p.trade.decision === "accepted");
  await add("ledger.run", `Run ${u.runFile}: ${u.run.symbols.join(", ")} — ${accepted.length} practice trade${accepted.length === 1 ? "" : "s"} accepted, ${u.run.perSymbol.length - accepted.length} refused.`, [`run:${u.runFile}`], {
    file: u.runFile,
    at: u.run.startedAt,
    head: u.run.headHash,
    symbols: u.run.symbols,
    accepted: accepted.length,
    refused: u.run.perSymbol.length - accepted.length,
    trigger: u.trigger,
  } satisfies LedgerRunRef);

  // 1. mark to market, close on stop / take-profit / expiry
  const now = u.run.startedAt;
  for (const p of [...state.positions]) {
    if (!u.run.symbols.includes(p.symbol)) continue; // this run did not look at that coin
    const f = u.run.facts.find((x) => x.symbol === p.symbol);
    const price = f?.priceUsd ?? null;
    const expired = Date.parse(now) >= Date.parse(p.expiresAt);
    if (price === null || !(price > 0)) {
      await add("ledger.no-price", `${p.symbol}: no price in this run, so the open position could not be marked${expired ? " (it has expired and will close at the next price)" : ""}.`, [`run:${u.runFile}`], { id: p.id, symbol: p.symbol, expired });
      continue;
    }
    const ev = [`run:${u.runFile}`, `market:${p.symbol}`];
    let close: Omit<CloseData, "id" | "at" | "runFile" | "pnlUsd"> | null = null;
    if (price <= p.stopPriceUsd)
      close = { reason: "stop", exitPriceUsd: price, note: `RYO's price ${fmtUsd(price)} is at or below the stop ${fmtUsd(p.stopPriceUsd)}. Sold at the observed price${price < p.stopPriceUsd ? " (below the stop: prices are only seen every few hours, so the loss is bigger than planned)" : ""}.` };
    else if (price >= p.takeProfitPriceUsd) close = { reason: "take-profit", exitPriceUsd: p.takeProfitPriceUsd, note: `RYO's price ${fmtUsd(price)} reached the take-profit ${fmtUsd(p.takeProfitPriceUsd)}. Sold at the take-profit level (a resting order would not fill higher).` };
    else if (expired) close = { reason: "expiry", exitPriceUsd: price, note: `${u.expiryDays ?? DEFAULT_EXPIRY_DAYS} days passed without the stop or the take-profit being hit. Sold at RYO's price ${fmtUsd(price)}.` };
    if (close) {
      const pnlUsd = r2(p.qty * close.exitPriceUsd - p.sizeUsd);
      await add("ledger.close", `${p.symbol}: closed at ${close.reason === "take-profit" ? "take-profit" : close.reason} for ${pnlUsd >= 0 ? "+" : "-"}${fmtUsd(Math.abs(pnlUsd))}.`, ev, { id: p.id, at: now, runFile: u.runFile, pnlUsd, ...close } satisfies CloseData);
    } else {
      const unrealisedUsd = r2(p.qty * price - p.sizeUsd);
      await add("ledger.mark", `${p.symbol}: marked at ${fmtUsd(price)} (${unrealisedUsd >= 0 ? "+" : "-"}${fmtUsd(Math.abs(unrealisedUsd))} on paper).`, ev, { id: p.id, priceUsd: price, at: now, unrealisedUsd } satisfies MarkData);
    }
  }

  // 2. open positions for accepted practice trades
  for (const a of accepted) {
    const plan = a.trade.plan;
    const ev = [`run:${u.runFile}`, ...plan.evidenceIds];
    if (state.positions.some((p) => p.symbol === a.symbol)) {
      await add("ledger.skip", `${a.symbol}: already holding a practice position, so the new one was not added on top.`, ev, { symbol: a.symbol, reason: "already-open" });
      continue;
    }
    const lost = lossOnDay(state, now);
    if (lost >= limits.dailyLossLimitUsd) {
      await add("ledger.breaker", `${a.symbol}: circuit breaker — ${fmtUsd(lost)} already lost today, at or over the ${fmtUsd(limits.dailyLossLimitUsd)} daily limit. Not opened.`, ev, { symbol: a.symbol, lossTodayUsd: lost, dailyLossLimitUsd: limits.dailyLossLimitUsd });
      continue;
    }
    const pos: Position = {
      id: `${a.symbol}@${now}`,
      symbol: a.symbol,
      openedAt: now,
      entryPriceUsd: plan.entryPriceUsd,
      sizeUsd: plan.sizeUsd,
      qty: plan.sizeUsd / plan.entryPriceUsd,
      stopPriceUsd: plan.stopPriceUsd,
      takeProfitPriceUsd: plan.exitPriceUsd,
      expiresAt: new Date(Date.parse(now) + expiryMs).toISOString(),
      evidenceIds: plan.evidenceIds,
      runFile: u.runFile,
      runTrailHead: u.run.headHash,
      riskEntryHash: a.riskEntryHash,
      lastPriceUsd: plan.entryPriceUsd,
      lastMarkAt: now,
      unrealisedUsd: 0,
    };
    await add("ledger.open", `${a.symbol}: opened ${fmtUsd(pos.sizeUsd)} at ${fmtUsd(pos.entryPriceUsd)}, stop ${fmtUsd(pos.stopPriceUsd)}, take-profit ${fmtUsd(pos.takeProfitPriceUsd)}.`, ev, pos);
  }

  const file: LedgerFile = { format: LEDGER_FORMAT, updatedAt: clock(), state, trail: trail.entries };
  return { file, added: trail.entries.slice(start) };
}
