// Accessibility audit: loads the main pages in Chromium, runs axe (WCAG 2.0/2.1 A + AA) and reports violations,
// plus any page errors / console errors seen while loading (hydration problems show up here).
//
//   node tests/a11y.run.cjs [baseUrl]          (default http://localhost:3100)
//   CHROME_PATH=... node tests/a11y.run.cjs    (use a different Chromium build)
//
// Exits 1 when any page has a violation or a page error, so it can gate a deploy.
/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run with `node` */
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = (process.argv[2] || process.env.A11Y_BASE || "http://localhost:3100").replace(/\/$/, "");
const PAGES = [
  { path: "/" },
  { path: "/case/emax" },
  // the same page after the ten agents have run (results, notebook, verdict)
  {
    path: "/case/emax",
    note: "after Run",
    act: async (page) => {
      await page.getByRole("button", { name: /Run the agents/ }).click();
      await page.waitForTimeout(Number(process.env.A11Y_RUN_WAIT || 30000));
    },
  },
  { path: "/cases" },
  { path: "/case/saitama" },
  { path: "/call" },
  { path: "/call?demo=1" }, // loaded, not played
  { path: "/verify" },
  { path: "/how" },
  { path: "/not-found-test" },
];
const CHROME = process.env.CHROME_PATH || "C:/Users/daksh/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";
const VIEWPORTS = (process.env.A11Y_VIEWPORTS || "1400x900,390x844").split(",").map((v) => v.split("x").map(Number));

// Console noise that isn't ours: dev-only React tooling notices, and WebGL fallbacks in headless swiftshader.
const IGNORE = [/Download the React DevTools/i, /GPU stall due to ReadPixels/i, /WebGL/i, /THREE\.WebGLRenderer/i];

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  let total = 0;
  let errors = 0;
  for (const [width, height] of VIEWPORTS) {
    for (const { path, note, act } of PAGES) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const problems = [];
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        // a 404 for /not-found-test is the point of that page
        if (path === "/not-found-test" && /404/.test(t)) return;
        if (!IGNORE.some((r) => r.test(t))) problems.push(`console: ${t.slice(0, 300)}`);
      });
      const label = `${path}${note ? ` (${note})` : ""} @${width}x${height}`;
      let res;
      try {
        await page.goto(BASE + path, { waitUntil: "load", timeout: 180000 });
        // pages that poll (on-chain status) never go fully idle; don't wait forever for it
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2500); // let Doki and the typewriter settle
        if (act) await act(page);
        res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      } catch (e) {
        errors++;
        console.log(`✗ ${label}: could not audit: ${String(e.message || e).split("\n")[0]}`);
        await context.close();
        continue;
      }
      if (!res.violations.length && !problems.length) console.log(`✓ ${label}: no violations`);
      for (const v of res.violations) {
        total += v.nodes.length;
        console.log(`✗ ${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length})`);
        for (const n of v.nodes.slice(0, 6)) {
          console.log(`    ${n.target.join(" ")}`);
          const why = (n.any[0] || n.all[0] || n.none[0])?.message;
          if (why) console.log(`      ${why.slice(0, 220)}`);
        }
      }
      for (const p of problems) {
        errors++;
        console.log(`✗ ${label}: ${p}`);
      }
      await context.close();
    }
  }
  await browser.close();
  console.log(`\n${total} violation node(s), ${errors} page/console error(s)`);
  process.exit(total || errors ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
