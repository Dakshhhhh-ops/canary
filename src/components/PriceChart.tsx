"use client";

// Real price + pool-money series with promoter posts pinned on the timeline.
import { useMemo, useState } from "react";
import type { PricePoint, PromoterPost } from "@/lib/types";
import { fmtUsd } from "@/lib/format";

const W = 760;
const H = 300;
const PAD = { l: 56, r: 16, t: 22, b: 36 };

const day = (s: string) => new Date(s.length <= 10 ? s + "T00:00:00Z" : s).getTime();
const short = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function PriceChart({
  prices,
  posts = [],
  upto,
  series = "price",
  collapseAt,
  className,
  from,
  to,
}: {
  /** crop the chart to this date range (inclusive) */
  from?: string;
  to?: string;
  prices: PricePoint[];
  posts?: PromoterPost[];
  /** draw only up to this date (for step-by-step replays) */
  upto?: string;
  series?: "price" | "liquidity";
  collapseAt?: string;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(
    () =>
      prices
        .map((p) => ({ t: day(p.t), v: series === "price" ? p.priceUsd : p.liquidityUsd, p }))
        .filter((p) => p.v != null && Number.isFinite(p.v))
        .filter((p) => (!from || p.t >= day(from)) && (!to || p.t <= day(to))) as { t: number; v: number; p: PricePoint }[],
    [prices, series, from, to],
  );
  if (pts.length < 2) return <p className="text-sm text-[var(--ink-3)]">Not enough data to draw a chart.</p>;

  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const vmax = Math.max(...pts.map((p) => p.v)) * 1.08;
  const ticks = 4;
  // tiny token prices make long axis labels ($0.0000055): widen the left margin to fit them
  const tickLabels = Array.from({ length: ticks + 1 }, (_, i) => fmtUsd((vmax / ticks) * i, 1));
  const padL = Math.max(PAD.l, Math.ceil(Math.max(...tickLabels.map((l) => l.length)) * 6.4) + 14);
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / vmax) * (H - PAD.t - PAD.b);
  const cut = upto ? day(upto) : Infinity;
  const vis = pts.filter((p) => p.t <= cut);
  const line = vis.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = vis.length ? `${line} L${x(vis[vis.length - 1].t)},${H - PAD.b} L${x(vis[0].t)},${H - PAD.b} Z` : "";
  const months: number[] = [];
  if (t1 - t0 < 75 * 864e5) {
    const d = new Date(t0);
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7)); // next Monday
    while (d.getTime() <= t1) {
      months.push(d.getTime());
      d.setUTCDate(d.getUTCDate() + 7);
    }
  } else {
    const d = new Date(t0);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() <= t1) {
      months.push(d.getTime());
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  const crash = collapseAt ? day(collapseAt) : null;
  const visiblePosts = posts.filter((p) => day(p.postedAt) >= t0 && day(p.postedAt) <= t1 && day(p.postedAt) <= cut);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 0; i < vis.length; i++) if (Math.abs(x(vis[i].t) - px) < Math.abs(x(vis[best].t) - px)) best = i;
    setHover(vis.length ? best : null);
  };
  const h = hover != null ? vis[hover] : null;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${series === "price" ? "Price" : "Money in the trading pool"} from ${short(t0)} to ${short(t1)}, peak ${fmtUsd(Math.max(...pts.map((p) => p.v)))}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g-${series}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffd84d" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffd84d" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks + 1 }, (_, i) => (vmax / ticks) * i).map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#ecd9b8" strokeDasharray="3 5" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#765b45">
              {fmtUsd(v, 1)}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m} x={x(m)} y={H - 12} textAnchor="middle" fontSize="11" fill="#765b45">
            {new Date(m).toLocaleDateString("en-US", t1 - t0 < 75 * 864e5 ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", year: "2-digit", timeZone: "UTC" })}
          </text>
        ))}
        {crash && crash <= cut && (
          <g>
            <rect x={x(crash)} y={PAD.t} width={Math.max(0, W - PAD.r - x(crash))} height={H - PAD.t - PAD.b} fill="#bd3022" opacity=".06" />
            <text x={x(crash) + 6} y={PAD.t + 14} fontSize="11" fontWeight="700" fill="#bd3022">
              collapse
            </text>
          </g>
        )}
        <path d={area} fill={`url(#g-${series})`} />
        <path d={line} fill="none" stroke="#2a190e" strokeWidth="2.5" strokeLinejoin="round" />
        {visiblePosts.map((p, i) => {
          const px = x(day(p.postedAt));
          const initials = p.promoter
            .split(/\s+/)
            .map((w) => w[0])
            .join("")
            .slice(0, 2);
          return (
            <g key={p.id}>
              <line x1={px} x2={px} y1={PAD.t + 18 + (i % 3) * 22} y2={H - PAD.b} stroke="#fe6a28" strokeWidth="1.5" strokeDasharray="4 3" />
              <circle cx={px} cy={PAD.t + 8 + (i % 3) * 22} r="11" fill={p.disclosedPayment === false ? "#bd3022" : "#fe6a28"} stroke="#2a190e" strokeWidth="1.5" />
              <text x={px} y={PAD.t + 12 + (i % 3) * 22} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#fff">
                {initials}
              </text>
              <title>{`${p.promoter} posted on ${p.platform}, ${short(day(p.postedAt))}${p.disclosedPayment === false ? " (payment not disclosed)" : ""}`}</title>
            </g>
          );
        })}
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={H - PAD.b} stroke="#2a190e" strokeOpacity=".3" />
            <circle cx={x(h.t)} cy={y(h.v)} r="5" fill="#ffd84d" stroke="#2a190e" strokeWidth="2" />
            <g transform={`translate(${Math.min(x(h.t) + 10, W - 170)},${Math.max(PAD.t, y(h.v) - 46)})`}>
              <rect width="160" height="40" rx="10" fill="#fff" stroke="#2a190e" strokeWidth="1.5" />
              <text x="10" y="17" fontSize="11" fill="#765b45">
                {short(h.t)}
              </text>
              <text x="10" y="32" fontSize="13" fontWeight="800" fill="#2a190e">
                {fmtUsd(h.v, h.v >= 1 ? 2 : 4)} {series === "liquidity" ? "in pool" : ""}
              </text>
            </g>
          </g>
        )}
      </svg>
      {visiblePosts.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--ink-3)]">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-[var(--alarm)]" /> promoter post, payment not disclosed
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-[var(--beak)]" /> other promoter post
          </span>
        </p>
      )}
    </div>
  );
}
