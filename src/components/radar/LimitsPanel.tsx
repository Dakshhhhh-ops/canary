"use client";

// The risk desk's published limits, adjustable. Defaults are shown next to each one; the server
// checks and clamps whatever arrives, so these sliders are a convenience, not the guard.
import { DEFAULT_VALUES, LIMIT_FIELDS, type LimitField, type LimitValues } from "@/lib/radar/limits";
import { fmtUsd } from "@/lib/format";

const show = (f: LimitField, v: number) => (f.unit === "usd" ? fmtUsd(v, v < 1000 || v % 1000 === 0 ? 0 : 1) : `${v}%`);

export function LimitsPanel({ values, onChange, disabled }: { values: LimitValues; onChange: (v: LimitValues) => void; disabled?: boolean }) {
  const changed = LIMIT_FIELDS.some((f) => values[f.key] !== f.default);
  return (
    <details className="card p-5" open>
      <summary className="cursor-pointer">
        <span className="font-display text-lg font-bold">Your risk limits</span>
        <span className="ml-2 text-sm text-[var(--ink-3)]">the practice trade must pass every one</span>
      </summary>
      <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {LIMIT_FIELDS.map((f) => {
          const v = values[f.key];
          const idx = f.stops ? Math.max(0, f.stops.findIndex((s) => s >= v)) : 0;
          const id = `limit-${f.key}`;
          return (
            <div key={f.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-sm font-bold">
                  {f.label}
                </label>
                <span className="font-display text-lg font-extrabold">{show(f, v)}</span>
              </div>
              <input
                id={id}
                type="range"
                className="mt-1 w-full accent-[var(--beak)]"
                disabled={disabled}
                min={f.stops ? 0 : f.min}
                max={f.stops ? f.stops.length - 1 : f.max}
                step={f.stops ? 1 : (f.step ?? 1)}
                value={f.stops ? idx : v}
                aria-valuetext={show(f, v)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange({ ...values, [f.key]: f.stops ? f.stops[n] : n });
                }}
              />
              <p className="text-xs text-[var(--ink-3)]">
                {f.help} Default {show(f, f.default)}.
              </p>
            </div>
          );
        })}
      </div>
      {changed && (
        <button className="link mt-4 text-sm" onClick={() => onChange({ ...DEFAULT_VALUES })} disabled={disabled}>
          Back to the defaults
        </button>
      )}
    </details>
  );
}
