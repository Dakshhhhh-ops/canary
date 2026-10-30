import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Footer, Header } from "@/components/Chrome";
import { CallRoom } from "@/components/call/CallRoom";
import { loadCase } from "@/lib/cases";
import { toHotlineCase } from "@/lib/hotline/caseFacts";

export const metadata: Metadata = {
  title: "Call Doki: the Canary hotline",
  description: "Lost money after an influencer hyped a coin? Talk to Doki. It checks your purchase on the blockchain and drafts your complaints.",
};

export default async function CallPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const cf = await loadCase("emax");
  if (!cf) notFound();
  const kase = toHotlineCase(cf);
  return (
    <>
      <Header />
      <main id="main" className="grain">
        <div className="mx-auto max-w-6xl px-4 pt-8">
          <p className="chip">📞 The hotline</p>
          <h1 className="font-display mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">
            Lost money to a hyped coin? <span className="mark">Talk to Doki.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-[var(--ink-2)]">
            A few short questions, a check of your purchase on the blockchain, and your complaints drafted for the right regulators. Free, and
            your details stay on your device.
          </p>
        </div>
        <CallRoom kase={kase} demo={demo === "1"} />
      </main>
      <Footer />
    </>
  );
}
