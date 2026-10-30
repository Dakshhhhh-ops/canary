"use client";

// "A pump-and-dump in four pictures": an illustrated price line that draws step by step.
import { useEffect, useRef, useState } from "react";
import { useGuide } from "./Guide";

const STEPS = [
  {
    title: "Insiders buy early, while it's cheap",
    body: "A small group creates or quietly buys a coin before anyone has heard of it.",
    upto: 150,
    say: "Step one: insiders buy a coin while it's cheap and nobody has heard of it.",
  },
  {
    title: "Paid influencers hype it",
    body: "Celebrities and “crypto influencers” post that it's going to the moon. Many are paid, and don't say so.",
    upto: 300,
    say: "Step two: influencers are paid to hype it, often without saying they were paid. That part is illegal.",
  },
  {
    title: "Fans rush in, and the price shoots up",
    body: "Followers buy because someone they trust said so. Every buyer pushes the price higher.",
    upto: 400,
    say: "Step three: fans rush in, and every buyer pushes the price higher.",
  },
  {
    title: "Insiders cash out, and the price collapses",
    body: "Insiders sell into the crowd, or pull the money out of the trading pool. Fans are left holding coins nobody will buy.",
    upto: 600,
    say: "Step four: insiders cash out. The price collapses, and fans are left holding coins nobody will buy.",
  },
];

// price line (illustration, not real data)
const PTS: [number, number][] = [
  [0, 222], [40, 220], [80, 223], [120, 219], [150, 218],
  [180, 210], [210, 200], [240, 186], [270, 170], [300, 150],
  [320, 128], [340, 100], [360, 70], [380, 42], [400, 30],
  [415, 60], [430, 130], [450, 190], [480, 215], [520, 226], [560, 230], [600, 232],
];

export function PumpStory() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const guide = useGuide();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setTimeout(() => {
      if (step < STEPS.length - 1) setStep((s) => s + 1);
      else setPlaying(false);
    }, 2600);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [playing, step]);

  const choose = (i: number) => {
    setPlaying(false);
    setStep(i);
    guide?.say(STEPS[i].say, i === 3 ? "alarm" : i === 1 ? "think" : "talk");
  };

  const upto = STEPS[step].upto;
  const shown = PTS.filter(([x]) => x <= upto);
  const d = shown.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const area = `${d} L${shown[shown.length - 1][0]},250 L0,250 Z`;
  const crash = step === 3;

  return (
    <div className="grid items-center gap-6 lg:grid-cols-[1.25fr_1fr]">
      <figure className="card relative overflow-hidden p-4 sm:p-6">
        <figcaption className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">
          <span>Price of the coin</span>
          <span>Illustration</span>
        </figcaption>
        <svg viewBox="0 0 600 260" className="w-full" role="img" aria-label={`Illustrated price chart, step ${step + 1} of 4: ${STEPS[step].title}`}>
          <defs>
            <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={crash ? "#bd3022" : "#ffd84d"} stopOpacity=".45" />
              <stop offset="1" stopColor={crash ? "#bd3022" : "#ffd84d"} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[60, 120, 180, 240].map((y) => (
            <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#ecd9b8" strokeDasharray="4 6" />
          ))}
          <path d={area} fill="url(#fill)" style={{ transition: "d .8s" }} />
          <path d={d} fill="none" stroke={crash ? "#bd3022" : "#2a190e"} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />

          {/* insiders */}
          <g opacity={step >= 0 ? 1 : 0}>
            <circle cx="60" cy="200" r="13" fill="#2a190e" />
            <text x="60" y="205" textAnchor="middle" fontSize="13">🕶️</text>
            <text x="60" y="180" textAnchor="middle" fontSize="12" fontWeight="700" fill="#5c4330">insiders</text>
          </g>
          {/* influencer posts */}
          {step >= 1 &&
            [
              [190, 150, "🚀 to the moon!"],
              [250, 120, "don't miss this 💎"],
              [300, 92, "#ad? 🤫"],
            ].map(([x, y, t], i) => (
              <g key={i} style={{ animation: `pop .4s ${i * 0.15}s both` }}>
                <rect x={(x as number) - 62} y={(y as number) - 34} width="124" height="26" rx="13" fill="#fff" stroke="#2a190e" strokeWidth="2" />
                <text x={x as number} y={(y as number) - 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="#2a190e">
                  {t as string}
                </text>
              </g>
            ))}
          {/* fans */}
          {step >= 2 &&
            [330, 350, 370, 390].map((x, i) => (
              <text key={x} x={x} y={238} textAnchor="middle" fontSize="18" style={{ animation: `pop .35s ${i * 0.1}s both` }}>
                {crash ? "😟" : "🙂"}
              </text>
            ))}
          {/* cash out */}
          {crash && (
            <g style={{ animation: "pop .4s both" }}>
              <rect x="430" y="40" width="150" height="28" rx="14" fill="#bd3022" />
              <text x="505" y="59" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">
                insiders sell 💸
              </text>
            </g>
          )}
        </svg>
        <style>{`@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>
      </figure>

      <div>
        <ol className="space-y-2">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                onClick={() => choose(i)}
                aria-current={step === i}
                className={`flex w-full items-start gap-3 rounded-2xl border-2 p-3 text-left transition ${
                  step === i ? "border-[var(--ink)] bg-[var(--card)] shadow-[0_4px_0_var(--ink)]" : "border-transparent hover:bg-[var(--card)]"
                }`}
              >
                <span className="step-num shrink-0" style={i === 3 && step === 3 ? { background: "var(--alarm)", color: "#fff" } : undefined}>
                  {i + 1}
                </span>
                <span>
                  <span className="block font-display text-lg font-bold leading-tight">{s.title}</span>
                  {step === i && <span className="mt-1 block text-[var(--ink-2)]">{s.body}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <button
          className="btn btn-ghost mt-4"
          onClick={() => {
            setStep(0);
            setPlaying(true);
          }}
        >
          ▶ Play it from the start
        </button>
      </div>
    </div>
  );
}
