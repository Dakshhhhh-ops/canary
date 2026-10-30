"use client";

// Browser voice for the hotline: speechSynthesis for Doki (and the demo caller), SpeechRecognition for the caller.
// Everything degrades: no voices -> timed beak movement; no recognition -> the text box; a blocked mic -> a clear message.

import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

export type MicState = "off" | "starting" | "on" | "denied" | "unsupported" | "error";
export type Speaker = "doki" | "caller";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

function pickVoice(kind: Speaker): SpeechSynthesisVoice | undefined {
  const all = window.speechSynthesis?.getVoices() ?? [];
  const en = all.filter((v) => /^en[-_]/i.test(v.lang));
  if (kind === "doki")
    return en.find((v) => /aria|jenny|samantha|zira|female|google us english/i.test(v.name)) ?? en.find((v) => /en[-_]US/i.test(v.lang)) ?? en[0];
  return en.find((v) => /guy|david|daniel|male|google uk english male|mark|ryan/i.test(v.name) && !/female/i.test(v.name)) ?? en.find((v) => /en[-_]GB/i.test(v.lang)) ?? en[1] ?? en[0];
}

export function useSpeech(opts: { onFinal: (text: string) => void; onBargeIn?: () => void }) {
  const [speaking, setSpeaking] = useState<Speaker | null>(null);
  const [mic, setMic] = useState<MicState>("off");
  const [interim, setInterim] = useState("");
  const [muted, setMuted] = useState(false);
  const [ttsOk, setTtsOk] = useState(false);
  const [line, setLine] = useState("");
  const [fast, setFast] = useState(false);
  const fastRef = useRef(false);
  fastRef.current = fast; // the sentence Doki is saying now (or said last)
  const recRef = useRef<Recognition | null>(null);
  const wantMic = useRef(false);
  const cancelRef = useRef(0); // bumping this cancels everything in flight
  const currentLine = useRef("");
  const speakingRef = useRef<Speaker | null>(null);
  const mutedRef = useRef(false);
  const ttsBroken = useRef(false);
  const onFinalRef = useRef(opts.onFinal);
  const onBargeRef = useRef(opts.onBargeIn);
  onFinalRef.current = opts.onFinal;
  onBargeRef.current = opts.onBargeIn;
  mutedRef.current = muted;

  useEffect(() => {
    const synth = window.speechSynthesis;
    setTtsOk(Boolean(synth));
    synth?.getVoices();
    const ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!ctor) setMic("unsupported");
    return () => {
      synth?.cancel();
      wantMic.current = false;
      recRef.current?.abort();
    };
  }, []);

  const setSpk = (s: Speaker | null) => {
    speakingRef.current = s;
    setSpeaking(s);
  };

  /** Echo guard: is this recognised text just Doki's own voice coming back through the speakers? */
  const isEcho = (text: string) => {
    if (!speakingRef.current || !currentLine.current) return false;
    const heard = words(text);
    if (!heard.length) return true;
    const said = new Set(words(currentLine.current));
    return heard.filter((w) => said.has(w)).length / heard.length >= 0.6;
  };

  const cancelSpeech = useCallback(() => {
    cancelRef.current += 1;
    window.speechSynthesis?.cancel();
    setSpk(null);
  }, []);

  /** Speak lines one by one; resolves when finished or cancelled. */
  const speak = useCallback(async (lines: string[], who: Speaker = "doki") => {
    const ticket = ++cancelRef.current;
    window.speechSynthesis?.cancel();
    for (const line of lines) {
      if (cancelRef.current !== ticket) return;
      currentLine.current = line;
      if (who === "doki") setLine(line);
      setSpk(who);
      const synth = window.speechSynthesis;
      const k = fastRef.current ? 0.6 : 1;
      const estimate = Math.min(9000, 700 + line.length * 58) * k;
      if (!synth || mutedRef.current || ttsBroken.current) {
        await sleep(mutedRef.current ? Math.min(4200, 500 + line.length * 32) * k : estimate);
        continue;
      }
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(line);
        const v = pickVoice(who);
        if (v) u.voice = v;
        u.lang = v?.lang ?? "en-US";
        u.rate = (who === "doki" ? 1.03 : 1.0) * (fastRef.current ? 1.45 : 1);
        u.pitch = who === "doki" ? 1.25 : 0.85;
        let started = false;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        u.onstart = () => {
          started = true;
          setSpk(who);
        };
        u.onboundary = () => setSpk(who);
        u.onend = finish;
        u.onerror = finish;
        synth.speak(u);
        // Some browsers (and headless ones) never start: fall back to timed beak movement.
        setTimeout(() => {
          if (!started && !done) {
            ttsBroken.current = true;
            synth.cancel();
            sleep(estimate).then(finish);
          }
        }, 2500);
        // watchdog against a lost onend
        setTimeout(finish, estimate * 2 + 4000);
        const poll = setInterval(() => {
          if (cancelRef.current !== ticket) {
            clearInterval(poll);
            finish();
          }
          if (done) clearInterval(poll);
        }, 120);
      });
    }
    if (cancelRef.current === ticket) {
      setSpk(null);
      currentLine.current = "";
    }
  }, []);

  const startRec = useCallback(() => {
    const ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!ctor) return setMic("unsupported");
    try {
      recRef.current?.abort();
    } catch {}
    const rec = new ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => setMic("on");
    rec.onresult = (e) => {
      let finalText = "";
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else inter += r[0].transcript;
      }
      if (inter) {
        if (!isEcho(inter)) {
          setInterim(inter);
          // barge-in: the caller started talking over Doki
          if (speakingRef.current === "doki" && words(inter).length >= 2) {
            cancelSpeech();
            onBargeRef.current?.();
          }
        }
      }
      if (finalText.trim()) {
        setInterim("");
        if (isEcho(finalText)) return;
        if (speakingRef.current === "doki") cancelSpeech();
        onFinalRef.current(finalText.trim());
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantMic.current = false;
        setMic("denied");
      } else if (e.error === "audio-capture") {
        wantMic.current = false;
        setMic("error");
      }
      // "no-speech" and "aborted" are normal: onend restarts
    };
    rec.onend = () => {
      setInterim("");
      if (wantMic.current) setTimeout(() => wantMic.current && startRec(), 250);
      else setMic((m) => (m === "denied" || m === "error" || m === "unsupported" ? m : "off"));
    };
    recRef.current = rec;
    setMic("starting");
    try {
      rec.start();
    } catch {
      setMic("error");
    }
  }, [cancelSpeech]);

  const micOn = useCallback(() => {
    wantMic.current = true;
    startRec();
  }, [startRec]);
  const micOff = useCallback(() => {
    wantMic.current = false;
    try {
      recRef.current?.stop();
    } catch {}
    setMic((m) => (m === "unsupported" ? m : "off"));
    setInterim("");
  }, []);

  return { speaking, speak, cancelSpeech, mic, micOn, micOff, interim, muted, setMuted, ttsOk, speakingRef, line, fast, setFast };
}
