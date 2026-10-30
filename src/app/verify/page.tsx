import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { Verifier } from "@/components/Verifier";

export const metadata = { title: "Verify a file · Canary" };

const STEPS: GuideStep[] = [
  { id: "drop", mood: "point", text: "Drop an evidence file from the hotline, or a notebook from a case replay. I'll recompute every fingerprint right here in your browser." },
  { id: "why", mood: "talk", text: "Why this matters: a lawyer or regulator can check, months later, that nobody edited the evidence. Not even us." },
];

export default function VerifyPage() {
  return (
    <Guide intro={{ id: "intro", mood: "wave", text: "Got a Canary file? Let's check nobody has changed it." }} steps={STEPS}>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-4 pt-10">
        <h1 className="font-display text-4xl font-extrabold sm:text-6xl">Check a file</h1>
        <p className="mt-3 max-w-3xl text-lg text-[var(--ink-2)]">
          Every Canary file carries a fingerprint (a SHA-256 hash). Change a single character and the fingerprint no longer matches. Try it.
        </p>
        <section data-guide="drop" className="pt-8">
          <Verifier />
        </section>
        <section data-guide="why" className="grid gap-4 pt-16 md:grid-cols-3">
          {[
            ["🧾", "Evidence files", "Made by the hotline for each victim: the posts, their purchases on the blockchain, and the case facts, with a fingerprint."],
            ["📓", "Agents' notebooks", "Made by every replay: each step is sealed with the fingerprint of the step before, so no step can be edited or removed."],
            ["⛓️", "On-chain records", "The fingerprints can also be written to a blockchain, which proves when the file existed."],
          ].map(([i, t, d]) => (
            <div key={t} className="card p-5">
              <p className="text-3xl">{i}</p>
              <h2 className="font-display mt-2 text-xl font-bold">{t}</h2>
              <p className="mt-1 text-[var(--ink-2)]">{d}</p>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </Guide>
  );
}
