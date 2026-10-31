import Link from "next/link";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/cases", label: "Real cases" },
  { href: "/radar", label: "Live radar" },
  { href: "/call", label: "Hotline" },
  { href: "/verify", label: "Verify" },
  { href: "/judges", label: "For judges" },
];

export function Logo({ small }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 64 64" className={small ? "h-7 w-7" : "h-9 w-9"} aria-hidden>
        <circle cx="32" cy="34" r="24" fill="#ffd84d" stroke="#ba5c25" strokeWidth="3" />
        <ellipse cx="25" cy="31" rx="3" ry="4.5" fill="#773d26" />
        <ellipse cx="39" cy="31" rx="3" ry="4.5" fill="#773d26" />
        <path d="M28 37 L32 43 L36 37 Z" fill="#fe6a28" />
        <circle cx="19" cy="38" r="3" fill="#fea759" opacity=".8" />
        <circle cx="45" cy="38" r="3" fill="#fea759" opacity=".8" />
      </svg>
      <span className="font-display text-xl font-extrabold tracking-tight">Canary</span>
    </span>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b-[1.5px] border-[var(--line)] bg-[var(--paper)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" aria-label="Canary home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-sm font-semibold text-[var(--ink-2)] hover:bg-[var(--canary-soft)] hover:text-[var(--ink)]">
              {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/call" className="btn btn-dark !min-h-[40px] !px-4 !py-1.5 text-sm">
          📞 Call the hotline
        </Link>
      </div>
      <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="chip shrink-0 !text-xs">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t-[1.5px] border-[var(--line)] bg-[var(--paper-2)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
        <div>
          <Logo small />
          <p className="mt-3 text-sm text-[var(--ink-2)]">
            Built for the BLI Legal Tech Hackathon 2. Canary is an information tool, not a law firm, and nothing here is legal advice.
          </p>
        </div>
        <div className="text-sm">
          <p className="font-bold">Explore</p>
          <ul className="mt-2 space-y-1.5">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link className="link" href={n.href}>
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <Link className="link" href="/how">
                Architecture
              </Link>
            </li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="font-bold">If you lost money</p>
          <ul className="mt-2 space-y-1.5 text-[var(--ink-2)]">
            <li>
              US: <a className="link" href="https://www.sec.gov/tcr" target="_blank" rel="noreferrer">SEC tips</a> ·{" "}
              <a className="link" href="https://reportfraud.ftc.gov" target="_blank" rel="noreferrer">FTC</a> ·{" "}
              <a className="link" href="https://www.ic3.gov" target="_blank" rel="noreferrer">FBI IC3</a>
            </li>
            <li>
              UK: <a className="link" href="https://www.fca.org.uk/consumers/report-scam" target="_blank" rel="noreferrer">FCA</a> ·{" "}
              <a className="link" href="https://www.reportfraud.police.uk" target="_blank" rel="noreferrer">Report Fraud</a>
            </li>
            <li>
              India: <a className="link" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">cybercrime.gov.in</a> · call 1930
            </li>
            <li className="pt-1">Nobody legitimate will ask you to pay to “recover” your crypto.</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
