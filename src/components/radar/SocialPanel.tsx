"use client";

// Live promoter posts for one radar run: which free sources answered (and which were gaps, with why),
// per coin how many accounts posted and pushed it in the last 24 / 72 hours, the Multi-KOL watcher's
// verdict with its echo groups, and every post with a link to the original. Plain words, no guesses.
import type { SocialPost, SocialSummary, SourceStatus } from "@/lib/social/types";

const when = (iso: string) => `${iso.slice(5, 10).replace("-", "/")} ${iso.slice(11, 16)} UTC`;
const safeUrl = (u: string) => (/^https:\/\/(t\.me|bsky\.app|www\.reddit\.com|farcaster\.xyz)\//.test(u) ? u : null);

function SourceChip({ s }: { s: SourceStatus }) {
  const ok = s.state === "answered" || s.state === "partial";
  const cls = ok ? "!border-[var(--ok)] !text-[var(--ok)]" : s.state === "off" ? "" : "!border-[var(--alarm)] !text-[var(--alarm)]";
  const label = s.state === "answered" ? `✓ ${s.label}` : s.state === "partial" ? `✓ ${s.label} (${s.answered} of ${s.asked})` : s.state === "off" ? `${s.label}: off` : `✗ ${s.label}: gap`;
  return (
    <li className={`chip ${cls}`} title={s.note}>
      {label}
      {ok && <span className="font-normal"> · {s.kept} posts kept</span>}
    </li>
  );
}

function Post({ p }: { p: SocialPost }) {
  const url = safeUrl(p.url);
  const s = p.signals;
  const text = p.text.length > 260 ? `${p.text.slice(0, 260)}…` : p.text;
  return (
    <li className="rounded-xl bg-[var(--paper)] p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-3)]">
        <span className="font-bold text-[var(--ink)]">{p.handle}</span>
        <span>{p.network === "telegram" ? "Telegram" : p.network === "bluesky" ? "Bluesky" : p.network === "reddit" ? "Reddit" : "Farcaster"}</span>
        <span>{when(p.postedAt)}</span>
        {p.followers ? <span>{p.followers.toLocaleString("en-US")} followers</span> : null}
        {p.views ? <span>{p.views.toLocaleString("en-US")} views</span> : null}
        <span className="font-mono">{p.symbols.join(" ")}</span>
      </div>
      <p className="mt-1 whitespace-pre-line break-words text-sm">{text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {s.promotional && s.shill.length > 0 && <span className="chip !border-[var(--beak)] !bg-[var(--beak-soft)] !text-[0.7rem]">promotion words: {s.shill.slice(0, 4).join(", ")}</span>}
        {s.disclosure.said ? (
          <span className={`chip !text-[0.7rem] ${s.disclosure.complete ? "!border-[var(--ok)] !text-[var(--ok)]" : ""}`}>
            says paid ({s.disclosure.terms.join(", ")}){s.disclosure.complete ? "; names payer and amount" : `; ${[!s.disclosure.payer && "no payer", !s.disclosure.amount && "no amount"].filter(Boolean).join(", ")}`}
          </span>
        ) : (
          <span className="chip !text-[0.7rem]">no payment disclosure</span>
        )}
        {s.contracts.length > 0 && <span className="chip font-mono !text-[0.7rem]">contract {s.contracts[0].address.slice(0, 10)}…</span>}
        {s.forwardedFrom && <span className="chip !text-[0.7rem]">forwarded from {s.forwardedFrom}</span>}
        {url && (
          <a className="link ml-auto" href={url} target="_blank" rel="noreferrer nofollow">
            Open the original post ↗
          </a>
        )}
      </div>
    </li>
  );
}

export function SocialPanel({ social }: { social: SocialSummary }) {
  const answered = social.sources.filter((s) => s.answered > 0);
  const gaps = social.sources.filter((s) => s.state === "gap");
  return (
    <section className="card p-5" aria-labelledby="social-h">
      <h3 id="social-h" className="font-display text-xl font-extrabold">
        🗣️ What promoters posted in the last {social.windowHours} hours
      </h3>
      <p className="mt-1 text-sm text-[var(--ink-2)]">
        Read live from free public sources, no paid API. A post counts as <em>pushing</em> a coin when it uses promotion words like &ldquo;100x&rdquo;,
        &ldquo;to the moon&rdquo; or &ldquo;buy now&rdquo;. The multi-influencer watcher then counts the promoters; accounts that copy each other&apos;s words count
        as one voice.
      </p>

      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {social.sources.map((s) => (
          <SourceChip key={s.id} s={s} />
        ))}
      </ul>
      <ul className="mt-2 space-y-1 text-xs text-[var(--ink-3)]">
        {social.sources
          .filter((s) => s.state !== "off")
          .map((s) => (
            <li key={s.id}>
              <strong>{s.label}:</strong> {s.note}
            </li>
          ))}
      </ul>
      {!answered.length && (
        <p className="mt-3 rounded-xl border-2 border-[var(--alarm)] bg-[var(--alarm-soft)] p-3 text-sm font-semibold">
          No source answered this time{gaps.length ? ` (${gaps.map((g) => g.label).join(", ")})` : ""}. Nothing was made up: the reasons are in the gaps below.
        </p>
      )}

      {answered.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {social.perSymbol.map((v) => (
            <div key={v.symbol} className={`rounded-xl border-[1.5px] p-3 text-sm ${v.convergence?.detected ? "border-[var(--alarm)] bg-[var(--alarm-soft)]" : "border-[var(--line)]"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-lg font-extrabold">{v.symbol}</span>
                {v.convergence?.detected && (
                  <span className="chip !border-[var(--alarm)] !text-[var(--alarm)]">
                    {v.convergence.promoters} promoters converging{v.convergence.coordinated ? " · looks organised" : ""}
                  </span>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ["accounts, 72 h", v.h72.accounts],
                    ["accounts, 24 h", v.h24.accounts],
                    ["pushing it", v.h72.promotionalAccounts],
                    ["independent voices", v.convergence ? v.convergence.independentVoices : "—"],
                    ["said they were paid", v.h72.disclosed],
                    ["named payer + amount", v.h72.disclosedComplete],
                  ] as [string, number | string][]
                ).map(([k, n]) => (
                  <div key={k} className="flex flex-col-reverse rounded-lg bg-[var(--paper)] p-1.5">
                    <dt className="text-[0.68rem] text-[var(--ink-3)]">{k}</dt>
                    <dd className="font-bold">{n}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[var(--ink-2)]">{v.summary}</p>
              {v.convergence && v.convergence.echoGroups.length > 0 && (
                <p className="mt-1 text-xs text-[var(--ink-3)]">Counted as one voice: {v.convergence.echoGroups.map((g) => g.join(" + ")).join("; ")}</p>
              )}
              {v.h72.contracts.length > 0 && <p className="mt-1 break-all font-mono text-[0.7rem] text-[var(--ink-3)]">Contracts named: {v.h72.contracts.join(", ")}</p>}
            </div>
          ))}
        </div>
      )}

      {social.posts.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-bold">
            The {social.posts.length} posts about these coins, with links to the originals
          </summary>
          <ul className="mt-3 space-y-2">
            {social.posts.map((p) => (
              <Post key={p.id} p={p} />
            ))}
          </ul>
        </details>
      )}

      <p className="mt-4 text-xs text-[var(--ink-3)]">
        Read {social.read} public posts in all; {social.posts.length} name these coins inside the window{social.outsideWindow ? ` (${social.outsideWindow} more were older)` : ""}. Each raw page and
        search reply is fingerprinted (SHA-256) in the notebook. &ldquo;No payment disclosure&rdquo; is not proof anyone was paid. US law (Securities Act §17(b)) says a
        paid promoter must disclose the payment, who paid and how much; &ldquo;#ad&rdquo; alone says only the first. A preview shows a channel&apos;s latest posts only.
      </p>
    </section>
  );
}
