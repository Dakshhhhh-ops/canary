// End-to-end smoke check in a real Chromium: the flows a judge clicks through and the demo video shows.
//
//   node tests/e2e.smoke.cjs [baseUrl]          (default http://localhost:3100)
//   CHROME_PATH=... node tests/e2e.smoke.cjs    (use a different Chromium build)
//   E2E_ONLY=call,saitama-call,cases,pages      (run only some of the checks)
//
// Checks:
//   call          /call?demo=1: plays the demo call to the end, opens the claim pack, downloads the PDF (must be a real PDF),
//                 then redrafts for UK, EU and India and checks each regulator's text appears, and the PDF still builds.
//   saitama-call  /call: a typed call from a Saitama buyer (sample wallet) reaches a Saitama claim pack citing the right law.
//   cases         /case/emax and /case/saitama: "Run the agents" runs to a verdict.
//   pages         /, /cases, /radar, /verify, /judges load.
// Every page must load with no page errors and no console errors (same noise filter as tests/a11y.run.cjs).
// Exits 1 on any failure.
/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run with `node` */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = (process.argv[2] || process.env.E2E_BASE || "http://localhost:3100").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Users/daksh/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";
const ONLY = (process.env.E2E_ONLY || "call,saitama-call,cases,pages").split(",");
const IGNORE = [/Download the React DevTools/i, /GPU stall due to ReadPixels/i, /WebGL/i, /THREE\.WebGLRenderer/i];

let failures = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`✗ ${msg}`);
};
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

async function newPage(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!IGNORE.some((r) => r.test(t))) problems.push(`console: ${t.slice(0, 300)}`);
  });
  const done = async () => {
    for (const p of problems) fail(`${label}: ${p}`);
    if (!problems.length) ok(`${label}: no page or console errors`);
    await context.close();
  };
  return { page, done };
}

async function goto(page, path) {
  const res = await page.goto(BASE + path, { waitUntil: "load", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500); // let React hydrate before clicking
  return res;
}

/** Clicks "Download PDF" and returns the downloaded bytes. */
async function downloadPdf(page) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: /Download PDF/ }).click()]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(file) };
}

function checkPdf(label, { name, bytes }) {
  check(/\.pdf$/.test(name), `${label}: download is named ${name}`);
  check(bytes.subarray(0, 5).toString("latin1") === "%PDF-", `${label}: file starts with %PDF-`);
  check(bytes.length > 5000, `${label}: PDF is ${bytes.length.toLocaleString()} bytes`);
  check(/%%EOF\s*$/.test(bytes.subarray(-32).toString("latin1")), `${label}: PDF ends with %%EOF`);
}

/** All the drafts' text (the print-only copy holds every document, open or not). */
const packText = (page) => page.evaluate(() => document.querySelector("main#main")?.parentElement?.textContent ?? document.body.textContent ?? "");

async function pickRules(page, value, eu) {
  await page.getByLabel("Draft for the rules of").selectOption(value);
  await page.waitForTimeout(800);
  if (eu) {
    await page.locator("label", { hasText: /^Country/ }).locator("select").selectOption(eu);
    await page.waitForTimeout(800);
  }
}

async function claimPackChecks(page, label, { expectCase }) {
  await page.waitForURL(/\/claim\/[a-z0-9]+/, { timeout: 120000, waitUntil: "commit" }).catch((e) => {
    throw new Error(`still at ${page.url()} after opening the claim pack: ${String(e.message).split("\n")[0]}`);
  });
  await page.getByRole("heading", { name: "Your claim pack" }).waitFor({ timeout: 120000 });
  ok(`${label}: claim pack opened at ${new URL(page.url()).pathname}`);
  let text = await packText(page);
  for (const re of expectCase) check(re.test(text), `${label}: pack mentions ${re}`);
  checkPdf(`${label} (as drafted)`, await downloadPdf(page));
  return text;
}

// ---------- the demo call (EMAX) ----------

async function demoCall(browser) {
  const label = "/call?demo=1";
  const { page, done } = await newPage(browser, label);
  try {
    await goto(page, "/call?demo=1");
    await page.getByRole("button", { name: /Play the demo call/ }).click();
    // no audio in a headless run: mute and speed up, so the scripted call runs on timers
    await page.getByRole("button", { name: /Sound on/ }).click();
    await page.getByRole("button", { name: /Speed up/ }).click();
    const open = page.getByRole("link", { name: /Open my claim pack/ }).first();
    await open.waitFor({ timeout: 6 * 60000 });
    const transcript = await page.getByRole("log", { name: "Call transcript" }).textContent();
    check(/Found it\. \d+ purchases? of EMAX/.test(transcript ?? ""), `${label}: Doki found the demo wallet's EMAX purchases`);
    check(/recover|fee/i.test(transcript ?? "") && /scammers/.test(transcript ?? ""), `${label}: Doki warned about the recovery scam`);
    await open.click();
    const us = await claimPackChecks(page, label, { expectCase: [/EthereumMax \(EMAX\)/, /Tip for the SEC/i, /ReportFraud\.ftc\.gov|reportfraud\.ftc\.gov/, /class action/i] });

    await pickRules(page, "UK");
    const uk = await packText(page);
    check(/Financial Conduct Authority|FCA/.test(uk) && /Report Fraud/.test(uk), `${label}: UK rules draft for the FCA and Report Fraud`);
    check(!/Report for the FTC/.test(uk), `${label}: UK rules dropped the FTC report`);
    check(uk !== us, `${label}: UK drafts differ from the US drafts`);
    checkPdf(`${label} (UK)`, await downloadPdf(page));

    await pickRules(page, "EU", "DE");
    const eu = await packText(page);
    check(/MiCA|Regulation \(EU\) 2023\/1114/.test(eu), `${label}: EU rules cite MiCA`);
    check(/BaFin/.test(eu), `${label}: EU (Germany) drafts for BaFin`);
    check(!/Reports for the FCA/.test(eu), `${label}: EU rules dropped the UK reports`);
    checkPdf(`${label} (EU, Germany)`, await downloadPdf(page));

    await pickRules(page, "IN");
    const ind = await packText(page);
    check(/cybercrime\.gov\.in/.test(ind) && /ASCI/.test(ind), `${label}: India rules draft for cybercrime.gov.in and ASCI`);
    // the picker's own help text names MiCA ("EU (MiCA, your national regulator)"), so leave it out
    check(!/MiCA/.test(ind.replace(/US, UK \(FCA\), EU \(MiCA[^.]*\./g, "")), `${label}: India rules dropped the EU complaint`);
    checkPdf(`${label} (India)`, await downloadPdf(page));
  } catch (e) {
    fail(`${label}: ${String(e.message || e).split("\n")[0]}`);
  }
  await done();
}

// ---------- a typed call from a Saitama buyer ----------

async function saitamaCall(browser) {
  const label = "/call (Saitama buyer)";
  const { page, done } = await newPage(browser, label);
  try {
    await goto(page, "/call");
    await page.getByRole("button", { name: /Start the call/ }).click();
    await page.getByRole("button", { name: /Sound on/ }).click();
    const input = page.getByLabel("Your answer");
    const say = async (text, waitFor) => {
      await input.fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      if (waitFor) await page.getByRole("log", { name: "Call transcript" }).getByText(waitFor).last().waitFor({ timeout: 120000 });
      await page.waitForTimeout(300);
    };
    await page.getByRole("log", { name: "Call transcript" }).getByText("Which coin did you buy?").waitFor({ timeout: 60000 });
    await say("I bought Saitama Inu", /Who or what made you want to buy it\?/);
    await say("Nam Tran's tweets", /When did you buy it\?/);
    await say("November 2021", /wallet address/);
    await page.getByRole("button", { name: "Try a sample wallet" }).click();
    await page.getByRole("log", { name: "Call transcript" }).getByText(/How much money did you lose/).last().waitFor({ timeout: 120000 });
    const transcript = (await page.getByRole("log", { name: "Call transcript" }).textContent()) ?? "";
    check(/Saitama Inu\. I know that one\./.test(transcript), `${label}: Doki recognised Saitama Inu`);
    check(/Found it\. (One purchase|\d+ purchases) of SAITAMA/.test(transcript), `${label}: Doki found the sample wallet's SAITAMA purchases`);
    await say("About 2000 dollars", /Where do you live/);
    await say("Texas", /What name should go on them/);
    await say("skip", /email address/);
    await say("skip", /Is that right\?/);
    await say("Yes", /Shall I draft/);
    for (let i = 0; i < 4; i++) {
      const more = await page.getByLabel("Your answer").isVisible().catch(() => false);
      if (!more) break;
      await say("Yes");
      await page.waitForTimeout(1500);
    }
    await page.getByRole("link", { name: /Open my claim pack/ }).first().click();
    const text = await claimPackChecks(page, label, { expectCase: [/Saitama Inu \(SAITAMA\)/, /1:24-cv-12586/, /9\(a\)\(2\)/, /10\(b\)/, /17\(a\)/] });
    check(!/Section 17\(b\)|77q\(b\)/.test(text), `${label}: Saitama drafts do not cite §17(b) (not a paid-promotion case)`);
    check(!/EthereumMax|Kardashian|class action/i.test(text.replace(/no class action/gi, "")), `${label}: no EMAX facts in the Saitama pack`);
  } catch (e) {
    fail(`${label}: ${String(e.message || e).split("\n")[0]}`);
  }
  await done();
}

// ---------- the case pages ----------

async function runCase(browser, slug) {
  const label = `/case/${slug} (Run the agents)`;
  const { page, done } = await newPage(browser, label);
  try {
    await goto(page, `/case/${slug}`);
    await page.getByRole("button", { name: /Run the agents/ }).click();
    await page.getByRole("button", { name: /Skip ahead/ }).click({ timeout: 30000 }).catch(() => {});
    await page.getByRole("button", { name: /Run again/ }).waitFor({ timeout: 3 * 60000 });
    const body = (await page.textContent("main")) ?? "";
    check(!/The run stopped/.test(body), `${label}: the run finished without an error`);
    check(/Verdict:|pump-and-dump/i.test(body), `${label}: a verdict is shown`);
  } catch (e) {
    fail(`${label}: ${String(e.message || e).split("\n")[0]}`);
  }
  await done();
}

async function loadPage(browser, path) {
  const { page, done } = await newPage(browser, path);
  try {
    const res = await goto(page, path);
    check(res && res.status() < 400, `${path}: HTTP ${res && res.status()}`);
    await page.waitForTimeout(2500);
  } catch (e) {
    fail(`${path}: ${String(e.message || e).split("\n")[0]}`);
  }
  await done();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  if (ONLY.includes("pages")) for (const p of ["/", "/cases", "/radar", "/verify", "/judges"]) await loadPage(browser, p);
  if (ONLY.includes("cases")) for (const slug of ["emax", "saitama"]) await runCase(browser, slug);
  if (ONLY.includes("call")) await demoCall(browser);
  if (ONLY.includes("saitama-call")) await saitamaCall(browser);
  await browser.close();
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
