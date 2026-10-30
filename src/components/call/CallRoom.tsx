"use client";

// The hotline call: Doki asks, the caller talks or types, the blockchain gets checked, the claim pack gets built.
// The conversation engine runs here in the browser (src/lib/hotline/agent.ts), so names and emails stay on this device.
// Only a public wallet address goes to the server (for the blockchain lookup).

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildClaimPack, newClaimId } from "@/lib/claims";
import { Trail } from "@/lib/engine/trail";
import { applyPurchaseResult, consentedDocs, PROGRESS, respond, startCall, type HotlineState, type Reply } from "@/lib/hotline/agent";
import type { HotlineCase } from "@/lib/hotline/caseFacts";
import { EXTRACTABLE, type RawExtract } from "@/lib/hotline/extract";
import type { PurchaseReport } from "@/lib/hotline/purchases";
import type { Mood } from "../Mascot";
import { rememberInTab, saveClaim } from "./claimStore";
import { PurchasesCard } from "./PurchasesCard";
import { useSpeech } from "./useSpeech";

const Mascot = dynamic(() => import("../Mascot").then((m) => m.Mascot), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-full bg-[var(--canary-soft)]" />,
});

type Line = { id: number; who: "doki" | "you"; text: string; redacted?: boolean; alert?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function demoScript(k: HotlineCase): string[] {
  const addr = k.demoWallet?.address ?? "";
  return [
    "Hi. I lost money on a coin called EthereumMax.",
    "I saw Kim Kardashian's Instagram post about it.",
    "I think it was July 2021.",
    "No, it was June.",
    `Here's my wallet: ${addr}`,
    "About three thousand dollars. And a guy on Telegram says he can get it back if I pay a fee.",
    "New York.",
    "Sam Taylor.",
    "sam@example.com",
    "Yes, that's right.",
    "Yes.",
    "Yes.",
    "Yes.",
  ];
}

export function CallRoom({ kase, demo }: { kase: HotlineCase; demo: boolean }) {
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ r: PurchaseReport; live: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [claimId, setClaimId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [demoOn, setDemoOn] = useState(false);
  const stateRef = useRef<HotlineState | null>(null);
  const trailRef = useRef<Trail | null>(null);
  const idRef = useRef(0);
  const demoRef = useRef(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback((who: Line["who"], text: string, extra: Partial<Line> = {}) => {
    setLines((ls) => [...ls, { id: ++idRef.current, who, text, ...extra }]);
  }, []);

  const handleUserRef = useRef<(text: string) => Promise<void>>(async () => {});
  const speech = useSpeech({ onFinal: (t) => void handleUserRef.current(t) });
  const { speak, cancelSpeech } = speech;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, report, claimId]);

  const makeClaim = useCallback(async () => {
    const s = stateRef.current;
    if (!s) return;
    try {
      const id = newClaimId();
      const trail = trailRef.current;
      await trail?.append({ agent: "claims", kind: "hotline.claim-prepared", summary: "The caller agreed to the documents; the claim pack was built in the browser.", evidenceIds: [], data: { consents: consentedDocs(s), purchases: s.facts.purchases?.purchases.length ?? 0 } });
      const pack = await buildClaimPack({ id, kase, facts: s.facts, consents: consentedDocs(s), generatedAt: new Date().toISOString(), trailHead: trail?.head ?? null, origin: window.location.origin });
      const stored = { pack, edits: {}, done: {} };
      rememberInTab(stored);
      if (!saveClaim(stored)) setClaimError("This browser won't let me save the pack, so keep this tab open, or print it from the next page.");
      setClaimId(id);
    } catch {
      setClaimError("Something went wrong while building your documents. Please try again.");
    }
  }, [kase]);

  /** Show and speak a reply, then carry out what it asks for (a blockchain check, the claim pack). */
  const play = useCallback(
    async (r: Reply) => {
      setReply(r);
      push("doki", r.say.join(" "), { alert: Boolean(r.alert) });
      await speak(r.say, "doki");
      if (r.action?.type === "check-wallet") {
        const address = r.action.address;
        busyRef.current = true;
        setBusy(true);
        let result: { ok: true; report: PurchaseReport } | { ok: false; error: string };
        let live = true;
        try {
          const res = await fetch("/api/hotline/purchases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, caseSlug: kase.slug }) });
          const j = (await res.json()) as { ok: boolean; live?: boolean; report?: PurchaseReport; error?: string };
          live = j.live !== false;
          result = j.ok && j.report ? { ok: true, report: j.report } : { ok: false, error: j.error ?? "failed" };
        } catch {
          result = { ok: false, error: "network" };
        }
        busyRef.current = false;
        setBusy(false);
        if (result.ok) {
          setReport({ r: result.report, live });
          await trailRef.current?.append({ agent: "claims", kind: "hotline.purchases-checked", summary: `Read ${result.report.purchases.length} purchases of ${kase.token.symbol} for the caller's public address from Ethereum.`, evidenceIds: result.report.purchases.map((p) => p.txHash), data: { address: result.report.address, live, toBlock: result.report.source.toBlock } });
        }
        const t = applyPurchaseResult(stateRef.current!, result, kase);
        stateRef.current = t.state;
        await play(t.reply);
      } else if (r.action?.type === "make-claim") {
        await makeClaim();
      }
    },
    [kase, makeClaim, push, speak],
  );

  const handleUser = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || !stateRef.current) return;
      cancelSpeech();
      setDraft("");
      const before = stateRef.current;
      let t = respond(before, text, kase);
      // Optional LLM help, only for steps that never carry a name or email, and only when the rules didn't understand.
      if (t.reply.unclear && EXTRACTABLE.includes(before.step)) {
        try {
          const res = await fetch("/api/hotline/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: before.step, text }), signal: AbortSignal.timeout(5000) });
          const j = (await res.json()) as { fields?: Partial<RawExtract> & Record<string, unknown> };
          if (j.fields && Object.keys(j.fields).length) t = respond(before, text, kase, { extracted: j.fields as never });
        } catch {}
      }
      push("you", t.reply.redactUser ? "" : text, { redacted: t.reply.redactUser });
      stateRef.current = t.state;
      await play(t.reply);
    },
    [cancelSpeech, kase, play, push],
  );
  handleUserRef.current = handleUser;

  const start = useCallback(async () => {
    setStarted(true);
    trailRef.current = new Trail();
    await trailRef.current.append({ agent: "claims", kind: "hotline.call-started", summary: "A hotline call started.", evidenceIds: [], data: { case: kase.slug } });
    const t = startCall(kase);
    stateRef.current = t.state;
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    await play(t.reply);
  }, [kase, play]);

  const runDemo = useCallback(async () => {
    demoRef.current = true;
    setDemoOn(true);
    await start();
    for (const line of demoScript(kase)) {
      while (demoRef.current && (speech.speakingRef.current || busyRef.current)) await sleep(150);
      if (!demoRef.current) return;
      await sleep(650);
      // type it out, so a viewer can follow
      for (let i = 1; i <= line.length && demoRef.current; i += Math.max(1, Math.round(line.length / 28))) {
        setDraft(line.slice(0, i));
        await sleep(28);
      }
      if (!demoRef.current) return;
      setDraft(line);
      if (!/0x[0-9a-f]{40}/i.test(line)) await speak([line], "caller");
      else await speak(["Here's my wallet address."], "caller");
      if (!demoRef.current) return;
      await handleUser(line);
    }
    demoRef.current = false;
    setDemoOn(false);
  }, [handleUser, kase, speak, speech.speakingRef, start]);

  const stopDemo = () => {
    demoRef.current = false;
    setDemoOn(false);
    setDraft("");
  };

  useEffect(() => () => void (demoRef.current = false), []);

  const step = reply?.step ?? "coin";
  const progress = reply?.progress ?? 0;
  const dokiTalking = speech.speaking === "doki";
  const mood: Mood = busy ? "think" : reply?.alert ? "alarm" : !started ? "wave" : dokiTalking ? (reply && ["wave", "happy", "alarm", "point"].includes(reply.mood) ? reply.mood : "talk") : (reply?.mood ?? "idle") === "talk" ? "idle" : (reply?.mood ?? "idle");
  const status = !started
    ? "Ready when you are"
    : busy
      ? "Checking the blockchain…"
      : speech.speaking === "doki"
        ? "Doki is talking…"
        : speech.speaking === "caller"
          ? "The caller is talking…"
          : speech.mic === "on"
            ? "Listening… just talk"
            : step === "done"
              ? "Call finished"
              : "Your turn: talk or type";

  const micLabel =
    speech.mic === "on" ? "Stop listening" : speech.mic === "starting" ? "Starting the microphone…" : speech.mic === "unsupported" ? "Voice not available here" : speech.mic === "denied" ? "Microphone blocked" : "Talk to Doki";
  const toggleMic = () => {
    if (speech.mic === "on" || speech.mic === "starting") speech.micOff();
    else {
      cancelSpeech();
      speech.micOn();
    }
  };

  // the bubble follows Doki's voice sentence by sentence; when Doki is quiet it keeps the question on screen
  const latest = !reply
    ? "Hi, I'm Doki. Press start, and tell me what happened. You can talk or type."
    : dokiTalking && speech.line
      ? speech.line
      : reply.say.slice(-2).join(" ");
  const hint = reply?.inputHint;
  const placeholder = hint === "address" ? "Paste your wallet address (0x…)" : hint === "email" ? "Your email, or type skip" : hint === "name" ? "Your name, or type skip" : "Type your answer…";
  const suggestions = useMemo(() => {
    const s = reply?.suggestions ?? [];
    return hint === "address" && kase.demoWallet ? [...s, "Try a sample wallet"] : s;
  }, [reply, hint, kase.demoWallet]);

  const pick = (s: string) => {
    if (s === "Try a sample wallet" && kase.demoWallet) return void handleUser(kase.demoWallet.address);
    void handleUser(s.replace(/'s posts$/, ""));
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-4 pb-10 pt-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-8 lg:pt-10">
      {/* Doki */}
      <section aria-label="Doki" className="lg:sticky lg:top-20 lg:self-start">
        <div className="card relative overflow-hidden p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="chip !bg-[var(--canary-soft)]">
              {started && step !== "done" ? <span className="live-dot" /> : <span aria-hidden>📞</span>} {demo || demoOn ? "Demo call" : "Canary hotline"}
            </p>
            <p className="text-sm font-semibold text-[var(--ink-2)]" aria-live="polite">
              {status}
            </p>
          </div>
          <div className="relative mx-auto mt-2 aspect-square w-full max-w-[190px] sm:max-w-[300px]">
            <div className={`absolute inset-[9%] rounded-full transition-colors ${mood === "alarm" ? "bg-[var(--alarm-soft)]" : busy ? "bg-[var(--sky-soft)]" : "bg-[var(--canary-soft)]"}`} />
            {busy && <div className="absolute inset-[4%] animate-spin rounded-full border-4 border-dashed border-[var(--sky)] [animation-duration:6s]" aria-hidden />}
            <Mascot mood={mood} talking={dokiTalking} distance={1.5} className="absolute inset-0" label={`Doki, ${status}`} />
          </div>
          <div className={`bubble mt-1 p-4 ${reply?.alert ? "!border-[var(--alarm)] !shadow-[0_5px_0_var(--alarm)]" : ""}`}>
            <p className="text-[1.02rem] leading-snug">{latest}</p>
          </div>
          {!started ? (
            <div className="mt-5 grid gap-3">
              {demo ? (
                <>
                  <button className="btn btn-primary text-lg" onClick={() => void runDemo()}>
                    ▶ Play the demo call
                  </button>
                  <button className="btn btn-ghost" onClick={() => void start()}>
                    Start my own call
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary text-lg" onClick={() => void start()}>
                    📞 Start the call
                  </button>
                  <Link className="btn btn-ghost" href="/call?demo=1">
                    ▶ Hear a demo call
                  </Link>
                </>
              )}
              <p className="text-center text-xs text-[var(--ink-3)]">Doki talks out loud. Turn your sound on, or mute it below.</p>
            </div>
          ) : step === "done" && claimId ? (
            <div className="mt-5 grid gap-2">
              <Link href={`/claim/${claimId}`} className="btn btn-primary text-lg">
                🗂️ Open my claim pack →
              </Link>
              <button className="btn btn-ghost !min-h-[44px] text-sm" onClick={() => window.location.reload()}>
                📞 Start a new call
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                className={`btn ${speech.mic === "on" ? "btn-alarm" : "btn-dark"} !min-h-[56px] !px-6 text-base disabled:cursor-not-allowed disabled:opacity-45`}
                onClick={toggleMic}
                disabled={speech.mic === "unsupported" || demoOn}
                aria-pressed={speech.mic === "on"}
              >
                <span aria-hidden>{speech.mic === "on" ? "⏹" : "🎙️"}</span> {micLabel}
              </button>
              {dokiTalking && (
                <button className="btn btn-ghost !min-h-[44px] !px-4 text-sm" onClick={cancelSpeech}>
                  ✋ Interrupt
                </button>
              )}
              <button className="btn btn-ghost !min-h-[44px] !px-4 text-sm" onClick={() => speech.setMuted(!speech.muted)} aria-pressed={speech.muted}>
                {speech.muted ? "🔇 Sound off" : "🔊 Sound on"}
              </button>
              {demoOn && (
                <button className="btn btn-ghost !min-h-[44px] !px-4 text-sm" onClick={() => speech.setFast(!speech.fast)} aria-pressed={speech.fast}>
                  {speech.fast ? "⏩ Fast" : "⏩ Speed up"}
                </button>
              )}
              {demoOn && (
                <button className="btn btn-ghost !min-h-[44px] !px-4 text-sm" onClick={stopDemo}>
                  ⏸ Stop the demo
                </button>
              )}
            </div>
          )}
          {speech.mic === "denied" && <p className="mt-3 rounded-2xl bg-[var(--alarm-soft)] p-3 text-sm">Your browser blocked the microphone. Allow it in the address bar, or just type your answers.</p>}
          {speech.mic === "unsupported" && started && <p className="mt-3 text-center text-xs text-[var(--ink-3)]">This browser can&apos;t listen. Type your answers, or tap a suggestion.</p>}
        </div>
        <div className="mt-4 hidden rounded-[22px] border-[1.5px] border-dashed border-[var(--line-2)] p-4 text-sm text-[var(--ink-2)] lg:block">
          <p className="font-bold text-[var(--ink)]">🔒 What stays private</p>
          <p className="mt-1">This conversation runs in your browser. Only a public wallet address is sent, to read the blockchain. Doki never asks for passwords or secret words.</p>
          <p className="mt-2">Not legal advice. Canary drafts documents; you decide what to send.</p>
        </div>
      </section>

      {/* Conversation */}
      <section aria-label="Conversation" className="flex min-w-0 flex-col gap-4">
        <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Call progress" tabIndex={0}>
          {PROGRESS.map((p, i) => {
            const state = !started ? "todo" : i < progress || step === "done" ? "done" : i === progress ? "now" : "todo";
            return (
              <li
                key={p.label}
                aria-current={state === "now" ? "step" : undefined}
                className={`chip shrink-0 !text-xs ${state === "now" ? "!border-[var(--ink)] !bg-[var(--canary)]" : state === "done" ? "!border-[var(--ok)] !bg-[var(--ok-soft)]" : "opacity-70"}`}
              >
                <span aria-hidden>{state === "done" ? "✓" : i + 1}</span> {p.label}
              </li>
            );
          })}
        </ol>

        <div className="card flex min-h-[320px] flex-col">
          <div ref={logRef} role="log" aria-live="polite" aria-label="Call transcript" className="max-h-[52vh] min-h-[260px] flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            {!lines.length && (
              <div className="grid h-full place-items-center py-10 text-center text-[var(--ink-3)]">
                <p>
                  The transcript appears here.
                  <br />
                  {demo ? "Press “Play the demo call” to watch a full call." : "Press “Start the call” to begin."}
                </p>
              </div>
            )}
            {lines.map((l) =>
              l.who === "doki" ? (
                <div key={l.id} className="flex items-start gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[var(--ink)] bg-[var(--canary)] text-sm" aria-hidden>
                    🐤
                  </span>
                  <p className={`max-w-[85%] rounded-2xl rounded-tl-sm border-[1.5px] px-3.5 py-2 ${l.alert ? "border-[var(--alarm)] bg-[var(--alarm-soft)]" : "border-[var(--line)] bg-[var(--paper)]"}`}>
                    <span className="sr-only">Doki: </span>
                    {l.text}
                  </p>
                </div>
              ) : (
                <div key={l.id} className="flex justify-end">
                  <p className={`max-w-[85%] break-words rounded-2xl rounded-tr-sm px-3.5 py-2 ${l.redacted ? "border-[1.5px] border-dashed border-[var(--alarm)] bg-[var(--card)] italic text-[var(--ink-2)]" : "bg-[var(--ink)] text-[var(--paper)]"}`}>
                    <span className="sr-only">You: </span>
                    {l.redacted ? "🔒 Removed for your safety. It was never saved." : l.text}
                  </p>
                </div>
              ),
            )}
            {busy && (
              <p className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
                <span className="live-dot !bg-[var(--sky)]" /> Reading Ethereum event logs for this address…
              </p>
            )}
            {speech.interim && <p className="text-right text-sm italic text-[var(--ink-3)]">“{speech.interim}”</p>}
          </div>

          {started && step !== "done" && (
            <div className="border-t-[1.5px] border-[var(--line)] p-3 sm:p-4">
              {suggestions.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Quick answers">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="chip !min-h-[40px] !px-3.5 !text-sm hover:!bg-[var(--canary-soft)]" onClick={() => pick(s)} disabled={busy || demoOn}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleUser(draft);
                }}
              >
                <label htmlFor="answer" className="sr-only">
                  Your answer
                </label>
                <input
                  id="answer"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (speech.speaking === "doki") cancelSpeech();
                  }}
                  placeholder={placeholder}
                  autoComplete={hint === "email" ? "email" : hint === "name" ? "name" : "off"}
                  inputMode={hint === "email" ? "email" : "text"}
                  spellCheck={hint !== "address"}
                  readOnly={demoOn}
                  className={`min-w-0 flex-1 rounded-full border-2 border-[var(--ink)] bg-[var(--card)] px-4 py-3 text-base outline-none focus:ring-4 focus:ring-[var(--canary)] ${hint === "address" ? "font-mono text-sm" : ""}`}
                />
                <button type="submit" className="btn btn-primary !px-5 disabled:opacity-50" disabled={!draft.trim() || demoOn}>
                  Send
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--ink-3)]">Never type your seed phrase, private key or passwords. Doki will never ask.</p>
            </div>
          )}
        </div>

        {report && <PurchasesCard report={report.r} live={report.live} />}

        {claimId && (
          <section className="card border-[var(--ink)] bg-[var(--canary-soft)] p-5 sm:p-6" aria-labelledby="pack-ready">
            <h2 id="pack-ready" className="font-display text-2xl font-extrabold">
              Your claim pack is ready 🎉
            </h2>
            <p className="mt-2 text-[var(--ink-2)]">
              Every document is a draft you can edit. Nothing has been sent anywhere. It&apos;s saved in this browser only.
            </p>
            <Link href={`/claim/${claimId}`} className="btn btn-dark mt-4 text-lg">
              Open my claim pack →
            </Link>
          </section>
        )}
        {claimError && <p className="rounded-2xl bg-[var(--alarm-soft)] p-3 text-sm">{claimError}</p>}

        <div className="rounded-[22px] border-[1.5px] border-dashed border-[var(--line-2)] p-4 text-sm text-[var(--ink-2)] lg:hidden">
          <p className="font-bold text-[var(--ink)]">🔒 What stays private</p>
          <p className="mt-1">This conversation runs in your browser. Only a public wallet address is sent, to read the blockchain. Not legal advice.</p>
        </div>
      </section>
    </div>
  );
}
