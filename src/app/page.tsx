import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { HashDemo } from "@/components/HashDemo";
import { HeroDoki } from "@/components/HeroDoki";
import { TourButton } from "@/components/TourButton";
import { PumpStory } from "@/components/PumpStory";
import { CasePreview } from "@/components/CasePreview";
import { loadCase } from "@/lib/cases";

const INTRO: GuideStep = {
  id: "intro",
  mood: "wave",
  text: "Hi, I'm Doki! Coal miners took canaries underground because they sense danger first. I do the same for crypto scams. Want a quick tour?",
};

const STEPS: GuideStep[] = [
  { id: "hero", mood: "happy", text: "Canary in one line: we catch paid crypto hype early, record the proof where nobody can change it, and help people who lost money file a complaint." },
  { id: "story", mood: "talk", text: "First, what is a pump-and-dump? Tap the four steps, or press play, and I'll explain each one." },
  { id: "law", mood: "think", text: "Is it legal? No. Getting paid to promote an investment without saying so breaks US securities law. Kim Kardashian wrote #AD, and the SEC still made her pay $1.26 million, because she didn't say who paid her or how much." },
  { id: "gap", mood: "alarm", text: "The real problem: by the time anyone complains, the posts are deleted and the money is gone. Victims don't know where to start." },
  { id: "how", mood: "point", text: "So Canary does four things: watch, weigh, record, and help. Each one is done by an agent you can inspect." },
  { id: "agents", mood: "happy", text: "Meet my agent friends. Each one asks a single question, and every answer goes into a tamper-proof notebook." },
  { id: "case", mood: "talk", text: "This really happened. Replay the EthereumMax case and watch the agents work through real blockchain data.", cta: { label: "Replay the real case", href: "/case/emax" } },
  { id: "chain", mood: "think", text: "Why a blockchain? Try editing one of these records. The fingerprints break, so nobody can quietly rewrite history." },
  { id: "hotline", mood: "wave", text: "Lost money in a pump-and-dump? Call me. I'll check your purchase on the blockchain and file the complaints with you.", cta: { label: "Open the hotline", href: "/call" } },
  { id: "limits", mood: "talk", text: "And here is what I can't do. I'd rather be honest than make promises." },
];

const AGENTS = [
  { icon: "📡", name: "Collector", q: "What did promoters post, and what is the coin doing?", src: "Posts from regulators' records and live feeds; market data from RYO and the blockchain." },
  { icon: "🗣️", name: "Multi-influencer watcher", q: "Are several big accounts pushing the same coin at once?", src: "Counts only independent voices. Copy-paste posts and posts paid by the same company count once." },
  { icon: "📰", name: "News checker", q: "Is the story they're telling true?", src: "Checks each claim against what the market data actually shows: cause, then effect." },
  { icon: "🔎", name: "Token hunter", q: "Could you actually sell this coin if you bought it?", src: "Liquidity, who holds the coins, how fast the price ran up. Every rule shows its numbers." },
  { icon: "🐂", name: "Bull", q: "What's the best case for this coin?", src: "Argues from the same evidence as the Bear, and must cite it." },
  { icon: "🐻", name: "Bear", q: "What's the case that this is a scam?", src: "Same evidence, opposite side. Claims without evidence are thrown out." },
  { icon: "⚖️", name: "Judge", q: "Who argued better?", src: "Decides: pump-and-dump, suspicious, or no signal, and explains why." },
  { icon: "🧮", name: "Risk desk", q: "Would we buy it with practice money?", src: "Paper trading only. Its own rules refuse coins with hidden paid promotion." },
  { icon: "⛓️", name: "Chainlink watcher", q: "Did the money just leave the trading pool?", src: "Runs on Chainlink's network and writes alerts and collapses onto the blockchain." },
  { icon: "📞", name: "Doki, the hotline", q: "You lost money. What happened?", src: "Checks your purchase on the blockchain, then files complaints with you, by voice." },
];

export default async function Home() {
  const emax = await loadCase("emax");
  return (
    <Guide intro={INTRO} steps={STEPS} heroId="hero">
      <Header />
      <main id="main">
        {/* HERO */}
        <section data-guide="hero" className="grain relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-6 px-4 pb-14 pt-10 md:grid-cols-[1.2fr_1fr] md:pt-16">
            <div>
              <p className="chip !bg-[var(--canary-soft)]">
                <span className="live-dot" /> For anyone who&apos;s seen a celebrity hype a coin
              </p>
              <h1 className="font-display mt-5 text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl lg:text-7xl">
                Catch the pump <br className="hidden sm:block" />
                <span className="font-serif font-normal italic text-[var(--brown)]">before</span> it dumps.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-[var(--ink-2)] sm:text-xl">
                Influencers get paid to hype a crypto coin. Fans pile in. Insiders cash out and the price collapses.{" "}
                <strong className="text-[var(--ink)]">Canary</strong> spots the hype early, writes the proof on the blockchain where nobody can
                change it, and helps the people who lost money file a complaint, just by talking.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/case/emax" className="btn btn-primary text-lg">
                  ▶ Watch a real case
                </Link>
                <Link href="/call" className="btn btn-ghost text-lg">
                  📞 I lost money
                </Link>
              </div>
              <p className="mt-4 text-sm text-[var(--ink-3)]">Free. No sign-up. Doki, the bird in the corner, will guide you.</p>
            </div>
            <div className="relative mx-auto aspect-square w-full max-w-[460px]">
              <div className="absolute inset-[8%] rounded-full bg-[var(--canary-soft)]" />
              <div className="absolute inset-[18%] rounded-full border-2 border-dashed border-[var(--line-2)]" />
              <HeroDoki mood="wave" className="absolute inset-0" distance={1.55} />
              <div className="bubble absolute -left-2 top-[2%] max-w-[15rem] p-3 text-sm sm:-left-6">
                <p className="font-bold">Hi, I&apos;m Doki 👋</p>
                <p className="mt-1">Miners took canaries underground to sense danger first. I do that for crypto scams.</p>
                <TourButton className="chip mt-2 !border-[var(--ink)] !bg-[var(--canary)]">▶ Show me around</TourButton>
              </div>
            </div>
          </div>
          {/* three-number strip */}
          <div className="border-y-[1.5px] border-[var(--line)] bg-[var(--card)]">
            <dl className="mx-auto grid max-w-6xl gap-4 px-4 py-5 text-center sm:grid-cols-3">
              <div>
                <dt className="text-sm text-[var(--ink-3)]">One undisclosed paid post cost Kim Kardashian</dt>
                <dd className="font-display text-3xl font-extrabold">$1.26M</dd>
                <dd className="text-xs">
                  <a className="link" href="https://www.sec.gov/newsroom/press-releases/2022-183" target="_blank" rel="noreferrer">
                    SEC, Oct 2022
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--ink-3)]">She was paid for that post</dt>
                <dd className="font-display text-3xl font-extrabold">$250,000</dd>
                <dd className="text-xs">“#AD” didn&apos;t count as disclosing it</dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--ink-3)]">What a victim needs to file a complaint today</dt>
                <dd className="font-display text-3xl font-extrabold">1 phone call</dd>
                <dd className="text-xs">with Doki</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* STORY */}
        <section data-guide="story" className="mx-auto max-w-6xl px-4 pt-20">
          <p className="chip">Start here</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">A pump-and-dump, in four pictures</h2>
          <p className="mt-3 max-w-2xl text-lg text-[var(--ink-2)]">No crypto knowledge needed. Tap each step.</p>
          <div className="mt-8">
            <PumpStory />
          </div>
        </section>

        {/* LAW */}
        <section data-guide="law" className="mx-auto max-w-6xl px-4 pt-24">
          <p className="chip">Is that allowed?</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">
            No. <span className="mark">Hiding that you were paid</span> is against the law.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="card p-5">
              <p className="text-3xl">🏛️</p>
              <h3 className="font-display mt-2 text-xl font-bold">US securities law</h3>
              <p className="mt-2 text-[var(--ink-2)]">
                Section 17(b) of the Securities Act: if you&apos;re paid to promote an investment, you must say who paid you and how much.
              </p>
              <a className="link mt-3 inline-block text-sm" href="https://www.law.cornell.edu/uscode/text/15/77q" target="_blank" rel="noreferrer">
                Read 15 U.S.C. § 77q(b)
              </a>
            </article>
            <article className="card p-5">
              <p className="text-3xl">📸</p>
              <h3 className="font-display mt-2 text-xl font-bold">The Kardashian case</h3>
              <p className="mt-2 text-[var(--ink-2)]">
                Kim Kardashian&apos;s Instagram post about EMAX, a crypto token, ended with “#AD”. The SEC said that wasn&apos;t enough: she
                didn&apos;t disclose that EthereumMax paid her $250,000. She settled for $1.26 million.
              </p>
              <a className="link mt-3 inline-block text-sm" href="https://www.sec.gov/newsroom/press-releases/2022-183" target="_blank" rel="noreferrer">
                SEC press release 2022-183
              </a>
            </article>
            <article className="card p-5">
              <p className="text-3xl">🏷️</p>
              <h3 className="font-display mt-2 text-xl font-bold">Ads must look like ads</h3>
              <p className="mt-2 text-[var(--ink-2)]">
                The US Federal Trade Commission requires influencers to clearly disclose paid endorsements. Other countries, like the UK, have
                similar rules.
              </p>
              <a className="link mt-3 inline-block text-sm" href="https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255" target="_blank" rel="noreferrer">
                FTC Endorsement Guides, 16 CFR 255
              </a>
            </article>
          </div>
        </section>

        {/* GAP */}
        <section data-guide="gap" className="mx-auto max-w-6xl px-4 pt-16">
          <div className="card grid gap-6 border-[var(--alarm)] bg-[var(--alarm-soft)] p-6 sm:p-8 md:grid-cols-[auto_1fr]">
            <p className="text-5xl" aria-hidden>
              ⏳
            </p>
            <div>
              <h2 className="font-display text-2xl font-extrabold sm:text-3xl">So why does it keep happening?</h2>
              <ul className="mt-3 grid gap-2 text-[var(--ink-2)] sm:grid-cols-3">
                <li>
                  <strong className="text-[var(--ink)]">Posts disappear.</strong> Stories expire in 24 hours. Tweets get deleted.
                </li>
                <li>
                  <strong className="text-[var(--ink)]">Nobody connects the dots</strong> between who posted, when, and what the price did.
                </li>
                <li>
                  <strong className="text-[var(--ink)]">Victims don&apos;t know where to go,</strong> and the evidence is too technical to
                  gather alone.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* HOW */}
        <section id="how" data-guide="how" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-24">
          <p className="chip">What Canary does</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">Watch. Weigh. Record. Help.</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-4">
            {[
              { n: 1, t: "Watch", d: "Agents read what promoters post and what the coin is doing: its price, its trading pool, who holds it.", tag: "RYO market data" },
              { n: 2, t: "Weigh", d: "A Bull agent and a Bear agent argue from the same evidence. A Judge decides. A practice trade gets refused by Canary's own rules.", tag: "Agent debate" },
              { n: 3, t: "Record", d: "A Chainlink workflow writes the alert, and later the collapse, onto the blockchain. Nobody can backdate or delete it.", tag: "Chainlink CRE" },
              { n: 4, t: "Help", d: "Victims call Doki. Doki checks their purchase on the blockchain and files complaints with the SEC, FTC and others, in plain words.", tag: "Voice hotline" },
            ].map((s) => (
              <li key={s.n} className="card relative p-5">
                <span className="step-num">{s.n}</span>
                <h3 className="font-display mt-3 text-2xl font-extrabold">{s.t}</h3>
                <p className="mt-2 text-[var(--ink-2)]">{s.d}</p>
                <p className="chip mt-4 !text-xs">{s.tag}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* AGENTS */}
        <section data-guide="agents" className="mx-auto max-w-6xl px-4 pt-24">
          <p className="chip">Who does the work</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">Ten agents, one notebook</h2>
          <p className="mt-3 max-w-2xl text-lg text-[var(--ink-2)]">
            Each agent answers one question and writes its reasoning into a shared notebook. Every page of the notebook is sealed with a
            fingerprint of the page before it, so you can replay exactly why Canary decided what it did.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {AGENTS.map((a) => (
              <li key={a.name} className="card p-4">
                <p className="text-3xl" aria-hidden>
                  {a.icon}
                </p>
                <h3 className="font-display mt-2 text-lg font-bold leading-tight">{a.name}</h3>
                <p className="mt-1 font-serif text-lg italic leading-snug">“{a.q}”</p>
                <p className="mt-2 text-sm text-[var(--ink-3)]">{a.src}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* CASE */}
        <section data-guide="case" className="mx-auto max-w-6xl px-4 pt-24">
          <p className="chip">This really happened</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">EthereumMax, 2021</h2>
          <div className="mt-8">
            <CasePreview data={emax} />
          </div>
          <p className="mt-4 text-[var(--ink-2)]">
            A second real case shows the method isn&apos;t a one-off: in{" "}
            <Link className="link font-semibold" href="/case/saitama">
              Saitama Inu (2021)
            </Link>{" "}
            the promoters were the coin&apos;s own officers, and the SEC&apos;s case is market manipulation, not paid touting.{" "}
            <Link className="link" href="/cases">
              All cases
            </Link>
          </p>
        </section>

        {/* CHAIN */}
        <section data-guide="chain" className="mx-auto max-w-6xl px-4 pt-24">
          <div className="grid items-start gap-8 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="chip">Why a blockchain?</p>
              <h2 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">A screenshot can be faked. This can&apos;t.</h2>
              <p className="mt-4 text-lg text-[var(--ink-2)]">
                When the agents raise an alert, a <strong>Chainlink</strong> workflow writes it onto a public blockchain with the time. When
                the coin collapses, that goes on too. Each victim&apos;s evidence file gets a fingerprint on the same record.
              </p>
              <p className="mt-3 text-lg text-[var(--ink-2)]">
                Months later, a lawyer or regulator can check that the evidence existed <em>before</em> the crash and hasn&apos;t been
                touched since.
              </p>
              <Link href="/verify" className="btn btn-ghost mt-6">
                Check an evidence file →
              </Link>
            </div>
            <HashDemo />
          </div>
        </section>

        {/* HOTLINE */}
        <section data-guide="hotline" className="mx-auto max-w-6xl px-4 pt-24">
          <div className="card grid items-center gap-6 overflow-hidden bg-[var(--canary)] p-6 sm:p-10 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display text-4xl font-extrabold sm:text-5xl">Lost money? Just talk to Doki.</h2>
              <ol className="mt-5 space-y-2 text-lg">
                <li>
                  <strong>1.</strong> Tell Doki what you bought and who told you to.
                </li>
                <li>
                  <strong>2.</strong> Doki finds your purchase on the blockchain. No screenshots needed.
                </li>
                <li>
                  <strong>3.</strong> You approve each complaint before it&apos;s sent: SEC, FTC, your state, the UK FCA.
                </li>
                <li>
                  <strong>4.</strong> Your evidence file gets a fingerprint that can be sealed on the blockchain, so anyone can check it later.
                </li>
              </ol>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/call" className="btn btn-dark text-lg">
                  📞 Talk to Doki now
                </Link>
                <Link href="/call?demo=1" className="btn btn-ghost text-lg">
                  Hear a demo call
                </Link>
              </div>
            </div>
            <div className="bubble w-full max-w-sm rotate-1 p-4 text-sm md:w-80" aria-label="Example of a call with Doki">
              <p className="font-bold">📞 Example call</p>
              <p className="mt-2"><strong>You:</strong> I bought a coin after a celebrity posted about it, and now it&apos;s worth nothing.</p>
              <p className="mt-2"><strong>Doki:</strong> I&apos;m sorry. Which coin, and roughly when? If you have your wallet address, I can find the purchase myself.</p>
              <p className="mt-2"><strong>You:</strong> EMAX, in June 2021.</p>
              <p className="mt-2"><strong>Doki:</strong> Found it: you bought while paid promoters were posting about it without proper disclosure. Shall I prepare your SEC tip?</p>
            </div>
          </div>
        </section>

        {/* LIMITS */}
        <section data-guide="limits" className="mx-auto max-w-6xl px-4 pt-24">
          <p className="chip">Straight talk</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">What Canary can&apos;t do</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {[
              ["It can't promise your money back.", "Complaints start investigations and help class actions. Recovery, if it happens, comes from regulators or courts."],
              ["It isn't a lawyer.", "Canary organises facts and drafts complaints. For advice on your situation, talk to a licensed attorney."],
              ["A warning is not an accusation.", "“Pump-and-dump risk” means the evidence fits the pattern. Canary shows its reasoning so anyone can disagree with it."],
              ["Live social feeds need paid access.", "The real-case replay uses posts documented by the SEC and court filings. Live radar uses RYO market data and says when a source is missing."],
            ].map(([t, d]) => (
              <div key={t} className="card p-5">
                <h3 className="font-display text-lg font-bold">{t}</h3>
                <p className="mt-1 text-[var(--ink-2)]">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-[var(--ink-3)]">
            Judges: the bounty-by-bounty checklist is at{" "}
            <Link className="link" href="/judges">
              /judges
            </Link>
            .
          </p>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}
