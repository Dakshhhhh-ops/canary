import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto grid max-w-3xl place-items-center px-4 py-24 text-center">
        <p className="text-6xl">🐤❓</p>
        <h1 className="font-display mt-4 text-4xl font-extrabold">Doki can&apos;t find that page</h1>
        <p className="mt-3 text-lg text-[var(--ink-2)]">It may have moved. Here are the main places to go.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn btn-primary">Home</Link>
          <Link href="/case/emax" className="btn btn-ghost">The real case</Link>
          <Link href="/call" className="btn btn-ghost">📞 I lost money</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
