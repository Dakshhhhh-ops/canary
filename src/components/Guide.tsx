"use client";

// Doki the guide: a docked mascot with a speech bubble.
// - Scroll mode: any element with data-guide="<id>" makes Doki say that step's line when it comes into view.
// - Tour mode: Next/Back walk through the page's steps, scrolling to and spotlighting each target.
// - Read aloud: browser speech; Doki's beak moves while it talks.
import dynamic from "next/dynamic";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Mood } from "./Mascot";

const Mascot = dynamic(() => import("./Mascot").then((m) => m.Mascot), { ssr: false });

export type GuideStep = {
  id: string; // matches data-guide="<id>" on the page
  text: string;
  mood?: Mood;
  cta?: { label: string; href: string };
};

type Ctx = {
  say: (text: string, mood?: Mood) => void;
  setMood: (m: Mood) => void;
  startTour: () => void;
  open: boolean;
};
const GuideCtx = createContext<Ctx | null>(null);
export const useGuide = () => useContext(GuideCtx);

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export function Guide({
  steps,
  intro,
  children,
  heroId,
  quiet,
}: {
  steps: GuideStep[];
  intro: GuideStep;
  children: React.ReactNode;
  /** while this data-guide section is on screen, the dock stays tucked away (the page shows its own Doki there) */
  heroId?: string;
  /** start with the bubble folded and don't pop it open while scrolling (dense pages) */
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [current, setCurrent] = useState<GuideStep>(intro);
  const [mood, setMood] = useState<Mood>(intro.mood ?? "wave");
  const [touring, setTouring] = useState(false);
  const [index, setIndex] = useState(-1);
  const [voice, setVoice] = useState(false);
  const [talking, setTalking] = useState(false);
  const [typed, setTyped] = useState(intro.text.length);
  const [bubble, setBubble] = useState(!quiet);
  // a bubble Doki opened by himself while you scroll stays compact (just the line); the buttons show once you open it
  const [pinned, setPinned] = useState(true);
  // small screens behave like quiet pages: Doki talks when you tap him or take the tour
  const quietRef = useRef(Boolean(quiet));
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      quietRef.current = Boolean(quiet) || mq.matches;
      if (mq.matches) setBubble(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [quiet]);
  const pinnedNext = useRef(false);
  const touringRef = useRef(false);
  touringRef.current = touring;
  const [heroVisible, setHeroVisible] = useState(Boolean(heroId));

  useEffect(() => {
    if (!heroId) return;
    const el = document.querySelector(`[data-guide="${heroId}"]`);
    if (!el) return setHeroVisible(false);
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting && e.intersectionRatio > 0.3), { threshold: [0, 0.3, 0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, [heroId]);

  useEffect(() => {
    if (store.get("canary.guide") === "hidden") setOpen(false);
    if (store.get("canary.voice") === "on") setVoice(true);
  }, []);

  // typewriter + beak movement, with or without speech
  const speak = useCallback(
    (step: GuideStep, open = true) => {
      setCurrent(step);
      setMood(step.mood ?? "talk");
      setTyped(0);
      if (open) {
        setBubble(true);
        setPinned(pinnedNext.current);
      }
      pinnedNext.current = false;
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      synth?.cancel();
      if (voice && synth) {
        const u = new SpeechSynthesisUtterance(step.text);
        u.rate = 1.02;
        u.pitch = 1.25;
        const v = synth.getVoices().find((x) => /en[-_](US|GB)/i.test(x.lang) && /female|samantha|zira|aria|jenny|google us/i.test(x.name));
        if (v) u.voice = v;
        u.onstart = () => setTalking(true);
        u.onend = () => setTalking(false);
        u.onerror = () => setTalking(false);
        synth.speak(u);
      } else {
        setTalking(true);
        window.setTimeout(() => setTalking(false), Math.min(4500, 900 + step.text.length * 28));
      }
    },
    [voice],
  );

  useEffect(() => {
    if (typed >= current.text.length) return;
    const id = window.setTimeout(() => setTyped((n) => Math.min(current.text.length, n + 2)), 12);
    return () => window.clearTimeout(id);
  }, [typed, current.text]);

  // fold the bubble away a while after Doki finishes, so it doesn't sit on top of the page
  useEffect(() => {
    if (touring || talking || typed < current.text.length || current.cta) return;
    const id = window.setTimeout(() => setBubble(false), pinned ? 9000 : 6000);
    return () => window.clearTimeout(id);
  }, [touring, talking, typed, current, pinned]);

  // scroll mode
  useEffect(() => {
    const byId = new Map(steps.map((s) => [s.id, s]));
    let last = "";
    const io = new IntersectionObserver(
      (entries) => {
        if (touringRef.current) return;
        const best = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const id = (best.target as HTMLElement).dataset.guide ?? "";
        const step = byId.get(id);
        if (step && id !== last) {
          last = id;
          speak(step, !quietRef.current);
        }
      },
      { threshold: [0.35, 0.6], rootMargin: "-10% 0px -30% 0px" },
    );
    document.querySelectorAll<HTMLElement>("[data-guide]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [steps, speak]);

  // tour mode: scroll to + spotlight
  const goTo = useCallback(
    (i: number) => {
      const step = steps[i];
      if (!step) return;
      setIndex(i);
      document.querySelectorAll(".guide-spot").forEach((el) => el.classList.remove("guide-spot"));
      const el = document.querySelector<HTMLElement>(`[data-guide="${step.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        el.classList.add("guide-spot");
      }
      pinnedNext.current = true;
      speak(step);
    },
    [steps, speak],
  );
  const startTour = useCallback(() => {
    setOpen(true);
    setTouring(true);
    goTo(0);
  }, [goTo]);
  const endTour = useCallback(() => {
    setTouring(false);
    setIndex(-1);
    document.querySelectorAll(".guide-spot").forEach((el) => el.classList.remove("guide-spot"));
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({
      say: (text, m) => {
        // on phones (and quiet pages) the page’s own announcements stay compact so they cover less
        pinnedNext.current = !quietRef.current;
        speak({ id: "adhoc", text, mood: m });
      },
      setMood,
      startTour,
      open,
    }),
    [speak, startTour, open],
  );

  const hide = () => {
    setOpen(false);
    store.set("canary.guide", "hidden");
    window.speechSynthesis?.cancel();
    endTour();
  };
  const show = () => {
    setOpen(true);
    store.set("canary.guide", "shown");
  };
  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    store.set("canary.voice", next ? "on" : "off");
    if (!next) window.speechSynthesis?.cancel();
  };

  return (
    <GuideCtx.Provider value={ctx}>
      {children}
      <style>{`.guide-spot{outline:4px solid var(--beak);outline-offset:8px;border-radius:24px;transition:outline-color .3s}`}</style>
      {heroVisible && !touring ? null : open ? (
        <aside
          aria-label="Doki, your guide"
          className="fixed bottom-3 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-end gap-2 sm:bottom-5 sm:right-5"
        >
          {bubble ? (
          <div className="bubble mb-6 w-[min(300px,calc(100vw-7rem))] p-4 text-[0.95rem] leading-snug">
            <p aria-live="polite" className="min-h-[3.2em]">
              <span>{current.text.slice(0, typed)}</span>
              <span className="sr-only">{current.text}</span>
            </p>
            {current.cta && (
              <Link href={current.cta.href} className="link mt-2 inline-block font-semibold">
                {current.cta.label} →
              </Link>
            )}
            {touring || pinned ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
              {touring ? (
                <>
                  <button className="chip" onClick={() => goTo(Math.max(0, index - 1))} disabled={index <= 0}>
                    ← Back
                  </button>
                  {index < steps.length - 1 ? (
                    <button className="chip !bg-[var(--canary)] !border-[var(--ink)]" onClick={() => goTo(index + 1)}>
                      Next → <span className="font-mono text-xs opacity-70">{index + 1}/{steps.length}</span>
                    </button>
                  ) : (
                    <button className="chip !bg-[var(--canary)] !border-[var(--ink)]" onClick={endTour}>
                      Done ✓
                    </button>
                  )}
                  <button className="chip" onClick={endTour}>
                    Stop tour
                  </button>
                </>
              ) : (
                <button className="chip !bg-[var(--canary)] !border-[var(--ink)]" onClick={startTour}>
                  ▶ Show me around
                </button>
              )}
              <button className="chip" onClick={toggleVoice} aria-pressed={voice} title="Doki reads aloud">
                {voice ? "🔊 Voice on" : "🔈 Read aloud"}
              </button>
              <button className="chip" onClick={hide} aria-label="Hide Doki">
                Hide
              </button>
            </div>
            ) : (
              <button type="button" className="mt-1 text-xs font-semibold text-[var(--ink-2)] underline decoration-[var(--canary)] decoration-2 underline-offset-2" onClick={() => setPinned(true)}>
                More from Doki
              </button>
            )}
          </div>
          ) : (
            <button className="bubble mb-10 hidden px-3 py-1.5 text-sm font-bold sm:block" onClick={() => {
                setPinned(true);
                setBubble(true);
              }}
              aria-label="Show what Doki said">
              💬 Doki
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPinned(true);
              setBubble((b) => !b);
            }} aria-label={bubble ? "Fold Doki's speech bubble" : "Show Doki's speech bubble"} className="shrink-0 cursor-pointer rounded-full">
          <Mascot distance={1.6} mood={talking ? (mood === "alarm" || mood === "happy" ? mood : "talk") : mood} talking={talking} className="pointer-events-none h-24 w-20 sm:h-40 sm:w-32" />
          </button>
        </aside>
      ) : (
        <button
          onClick={show}
          className="fixed bottom-4 right-4 z-50 grid h-16 w-16 place-items-center rounded-full border-2 border-[var(--ink)] bg-[var(--canary)] text-2xl shadow-[0_4px_0_var(--ink)]"
          aria-label="Show Doki, your guide"
          title="Ask Doki"
        >
          🐤
        </button>
      )}
    </GuideCtx.Provider>
  );
}
