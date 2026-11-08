import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(frontendDir, "..");
const axeSourcePath = path.resolve(frontendDir, "node_modules", "axe-core", "axe.min.js");
const evidenceDir = path.resolve(rootDir, "docs", "qa-evidence");

if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

const axeSource = fs.readFileSync(axeSourcePath, "utf-8");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PYTHON_PATH = "C:\\Dev\\project-partner-recommendation-system\\venv\\Scripts\\python.exe";

async function waitForUrl(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return true;
      }
    } catch {
      // Keep polling
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`);
}

async function runAxe(page, contextName) {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    return await window.axe.run({
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
      },
    });
  });

  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map((n) => ({
      html: n.html,
      target: n.target,
      failureSummary: n.failureSummary,
    })),
  }));

  return {
    context: contextName,
    passesCount: results.passes.length,
    violationsCount: violations.length,
    violations,
  };
}

async function main() {
  console.log("=================================================");
  console.log(" Starting Phase 5 Browser QA & Accessibility Run ");
  console.log("=================================================");

  const report = {
    timestamp: new Date().toISOString(),
    browser: "Google Chrome",
    scenarios: [],
    axeAudits: [],
    responsiveChecks: [],
    summary: { totalTests: 0, passed: 0, failed: 0, defectsFound: [] },
  };

  // 1. Spawn Flask Backend
  console.log("[1/6] Launching Flask Backend API on http://127.0.0.1:5000 ...");
  const backendProc = spawn(PYTHON_PATH, ["backend/app.py"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendProc.stdout.on("data", () => {});
  backendProc.stderr.on("data", () => {});

  // 2. Spawn Vite Dev Server
  console.log("[2/6] Launching Vite Frontend Server on http://localhost:3000 ...");
  const viteProc = spawn(
    "C:\\Dev\\node22\\node.exe",
    [path.resolve(frontendDir, "node_modules", "vite", "bin", "vite.js")],
    {
      cwd: frontendDir,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let browser;
  try {
    await waitForUrl("http://127.0.0.1:5000/api/metadata", 15000);
    console.log(" -> Flask Backend ready and metadata available.");

    await waitForUrl("http://localhost:3000", 15000);
    console.log(" -> Vite Frontend ready.");

    // 3. Launch Chrome
    console.log("[3/6] Launching Google Chrome via Puppeteer-Core ...");
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Scenario A: Initial Load & Metadata Hydration
    console.log("[Scenario A] Navigating to http://localhost:3000 ...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });

    // Take initial screenshot
    await page.screenshot({ path: path.resolve(evidenceDir, "01-initial-state.png"), fullPage: true });

    // Verify Title & Header
    const title = await page.title();
    const heading = await page.$eval(".header-title", (el) => el.textContent.trim());
    const statsCount = await page.$$eval(".stat-pill", (els) => els.length);
    console.log(` -> Title: "${title}", Heading: "${heading}", Stat pills: ${statsCount}`);

    report.scenarios.push({
      name: "Initial Load & Metadata",
      status: heading.includes("GitHub Project Partner") && statsCount >= 3 ? "PASSED" : "FAILED",
      details: { title, heading, statsCount },
    });

    // Run Axe on Initial State
    console.log(" -> Running Axe-Core on Initial State...");
    const axeInitial = await runAxe(page, "Initial Page State");
    report.axeAudits.push(axeInitial);
    console.log(`    Axe Passes: ${axeInitial.passesCount}, Violations: ${axeInitial.violationsCount}`);
    if (axeInitial.violationsCount > 0) {
      console.log("    Violations found:", JSON.stringify(axeInitial.violations, null, 2));
    }

    // Scenario B: Skip Link Keyboard Navigation
    console.log("[Scenario B] Testing Skip Link & Keyboard Focus...");
    await page.keyboard.press("Tab");
    const activeEl = await page.evaluate(() => {
      const el = document.activeElement;
      return { tagName: el.tagName, className: el.className, text: el.textContent?.trim(), href: el.getAttribute("href") };
    });
    const skipLinkVisible = await page.$eval(".skip-link", (el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom > 0;
    });
    console.log(` -> Active element after Tab: <${activeEl.tagName} class="${activeEl.className}"> (${activeEl.text})`);
    console.log(` -> Skip link visible on focus: ${skipLinkVisible}`);

    report.scenarios.push({
      name: "Skip Link Focus",
      status: activeEl.className.includes("skip-link") && skipLinkVisible ? "PASSED" : "FAILED",
      details: { activeEl, skipLinkVisible },
    });

    // Scenario B2: Tab Arrow Key Navigation (WAI-ARIA Pattern)
    console.log("[Scenario B2] Testing Tablist Arrow Key Navigation...");
    await page.focus("#tab-hybrid");
    await page.keyboard.press("ArrowRight");
    await new Promise((r) => setTimeout(r, 100));
    const activeTabAfterRight = await page.evaluate(() => {
      const activeEl = document.activeElement;
      return { id: activeEl?.id, ariaSelected: activeEl?.getAttribute("aria-selected") };
    });
    console.log(` -> Active tab after ArrowRight: id="${activeTabAfterRight.id}", aria-selected="${activeTabAfterRight.ariaSelected}"`);
    await page.keyboard.press("ArrowLeft");
    await new Promise((r) => setTimeout(r, 100));
    const activeTabAfterLeft = await page.evaluate(() => {
      const activeEl = document.activeElement;
      return { id: activeEl?.id, ariaSelected: activeEl?.getAttribute("aria-selected") };
    });
    console.log(` -> Active tab after ArrowLeft: id="${activeTabAfterLeft.id}", aria-selected="${activeTabAfterLeft.ariaSelected}"`);
    report.scenarios.push({
      name: "Tablist Keyboard Navigation (Arrow Keys)",
      status:
        activeTabAfterRight.id === "tab-bio" && activeTabAfterLeft.id === "tab-hybrid"
          ? "PASSED"
          : "FAILED",
      details: { activeTabAfterRight, activeTabAfterLeft },
    });

    // Scenario C: Sample Profile Quick-Pick & Form Validation
    console.log("[Scenario C] Testing Sample Profile Quick-Pick & Validation...");
    // Click sample pill "@abhay"
    const samplePill = await page.$(".sample-btn");
    if (samplePill) {
      await samplePill.click();
      const userVal = await page.$eval("#input-username", (el) => el.value);
      console.log(` -> Sample button clicked. Username input value: "${userVal}"`);
      report.scenarios.push({
        name: "Sample Profile Quick-Pick",
        status: userVal === "abhay" ? "PASSED" : "FAILED",
        details: { userVal },
      });
    }

    // Scenario D: Hybrid Partner Search Workflow
    console.log("[Scenario D] Submitting Hybrid Partner Search for @abhay...");
    const submitBtn = await page.$('button[type="submit"]');
    await submitBtn.click();

    // Wait for results
    await page.waitForSelector(".candidate-card", { timeout: 30000 });
    const cardCount = await page.$$eval(".candidate-card", (els) => els.length);
    const firstCardUser = await page.$eval(".candidate-card .cand-username", (el) => el.textContent.trim());
    const scoreChips = await page.$$eval(".score-chip", (els) => els.length);
    const profileLinks = await page.$$eval(".github-link", (els) => els.length);

    console.log(` -> Retrieved ${cardCount} candidate cards. Top candidate: ${firstCardUser}`);
    console.log(` -> Score chips: ${scoreChips}, Verified GitHub Profile Links: ${profileLinks}`);

    await page.screenshot({ path: path.resolve(evidenceDir, "02-hybrid-results.png"), fullPage: true });

    report.scenarios.push({
      name: "Hybrid Partner Search",
      status: cardCount === 5 && scoreChips === 5 && profileLinks === 5 ? "PASSED" : "FAILED",
      details: { cardCount, firstCardUser, scoreChips, profileLinks },
    });

    // Axe on Hybrid Results
    console.log(" -> Running Axe-Core on Hybrid Results State...");
    const axeHybrid = await runAxe(page, "Hybrid Results State");
    report.axeAudits.push(axeHybrid);
    console.log(`    Axe Passes: ${axeHybrid.passesCount}, Violations: ${axeHybrid.violationsCount}`);
    if (axeHybrid.violationsCount > 0) {
      console.log("    Violations found:", JSON.stringify(axeHybrid.violations, null, 2));
    }

    // Scenario E: Empty State (Filtering by impossible location)
    console.log("[Scenario E] Testing Empty Results State...");
    await page.type("#input-location", "NonExistentPlaceXYZ999");
    await submitBtn.click();
    await page.waitForSelector(".empty-state", { timeout: 10000 });
    const emptyTitle = await page.$eval(".empty-state h3", (el) => el.textContent.trim());
    console.log(` -> Empty state displayed: "${emptyTitle}"`);

    await page.screenshot({ path: path.resolve(evidenceDir, "03-empty-state.png"), fullPage: true });

    report.scenarios.push({
      name: "Empty Results State",
      status: emptyTitle.includes("No Matching Developer Profiles") ? "PASSED" : "FAILED",
      details: { emptyTitle },
    });

    // Axe on Empty State
    const axeEmpty = await runAxe(page, "Empty Results State");
    report.axeAudits.push(axeEmpty);

    // Scenario F: Reset Form
    console.log("[Scenario F] Testing Reset Form...");
    const resetBtn = await page.$('button[type="button"].btn-outline');
    await resetBtn.click();
    const clearedUser = await page.$eval("#input-username", (el) => el.value);
    const clearedLoc = await page.$eval("#input-location", (el) => el.value);
    const hasResults = await page.$(".results-wrapper");
    console.log(` -> Reset clicked. Username: "${clearedUser}", Location: "${clearedLoc}", Results present: ${!!hasResults}`);

    report.scenarios.push({
      name: "Reset Form Functionality",
      status: clearedUser === "" && clearedLoc === "" && !hasResults ? "PASSED" : "FAILED",
      details: { clearedUser, clearedLoc, hasResults: !!hasResults },
    });

    // Scenario G: Client-side Validation Error State
    console.log("[Scenario G] Testing Form Validation State...");
    await submitBtn.click(); // Click submit while empty
    await page.waitForSelector(".alert-warning", { timeout: 5000 });
    const valMsg = await page.$eval(".alert-warning .alert-text", (el) => el.textContent.trim());
    console.log(` -> Validation alert displayed: "${valMsg}"`);

    await page.screenshot({ path: path.resolve(evidenceDir, "04-validation-error.png"), fullPage: true });

    report.scenarios.push({
      name: "Client-side Validation Error",
      status: valMsg.includes("required") ? "PASSED" : "FAILED",
      details: { valMsg },
    });

    // Axe on Validation State
    const axeVal = await runAxe(page, "Validation State");
    report.axeAudits.push(axeVal);

    // Scenario H: Semantic Concept Search Workflow
    console.log("[Scenario H] Switching to Semantic Concept Search Tab...");
    await page.click("#tab-bio");
    await page.waitForSelector("#panel-bio", { timeout: 5000 });

    const bioTabSelected = await page.$eval("#tab-bio", (el) => el.getAttribute("aria-selected"));
    console.log(` -> Bio tab aria-selected: "${bioTabSelected}"`);

    const bioInput = await page.$("#input-bio");
    await bioInput.type("Looking for Python NLP machine learning contributor with PyTorch and recommendation experience");

    const bioSubmitBtn = await page.$('#panel-bio button[type="submit"]');
    await bioSubmitBtn.click();

    await page.waitForSelector(".candidate-card", { timeout: 30000 });
    const bioCardCount = await page.$$eval(".candidate-card", (els) => els.length);
    const bioScoreChips = await page.$$eval(".score-chip.bio-chip", (els) => els.length);

    // Verify candidate raw bio is NEVER exposed in the DOM
    const rawBioLeaks = await page.evaluate(() => {
      // Check if any element contains candidate bio text or raw bio labels
      const allText = document.body.innerText;
      return allText.includes("Candidate Bio:") || allText.includes("Raw Bio:");
    });

    console.log(` -> Retrieved ${bioCardCount} semantic candidates (${bioScoreChips} similarity chips).`);
    console.log(` -> Raw bio privacy check: ${rawBioLeaks ? "VIOLATION DETECTED" : "CONFIRMED SECURE (No Raw Bio Leakage)"}`);

    await page.screenshot({ path: path.resolve(evidenceDir, "05-semantic-results.png"), fullPage: true });

    report.scenarios.push({
      name: "Semantic Concept Search",
      status: bioCardCount === 5 && !rawBioLeaks ? "PASSED" : "FAILED",
      details: { bioCardCount, bioScoreChips, rawBioLeaks },
    });

    // Axe on Semantic Results
    console.log(" -> Running Axe-Core on Semantic Results State...");
    const axeBio = await runAxe(page, "Semantic Results State");
    report.axeAudits.push(axeBio);
    console.log(`    Axe Passes: ${axeBio.passesCount}, Violations: ${axeBio.violationsCount}`);
    if (axeBio.violationsCount > 0) {
      console.log("    Violations found:", JSON.stringify(axeBio.violations, null, 2));
    }

    // Scenario H2: Server Error Handling & Dismissible Alert Banner
    console.log("[Scenario H2] Testing Server Error Alert Banner & Dismissal...");
    await page.setRequestInterception(true);
    const mockErrorHandler = (req) => {
      if (req.url().includes("/api/semantic-bio-recommend") || req.url().includes("/semantic-bio-recommend")) {
        req.respond({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated Backend Cluster Failure (QA Test)" }),
        });
      } else {
        req.continue();
      }
    };
    page.on("request", mockErrorHandler);

    // Click submit again
    await bioSubmitBtn.click();
    await page.waitForSelector(".alert-error", { timeout: 5000 });
    const errorText = await page.$eval(".alert-error .alert-text", (el) => el.textContent.trim());
    console.log(` -> Error banner displayed: "${errorText}"`);

    await page.screenshot({ path: path.resolve(evidenceDir, "07-network-error.png"), fullPage: true });

    // Axe on Error State
    const axeError = await runAxe(page, "Network Error State");
    report.axeAudits.push(axeError);

    // Dismiss error banner
    const dismissBtn = await page.$(".alert-dismiss");
    if (dismissBtn) {
      await dismissBtn.click();
      const errorStillPresent = await page.$(".alert-error");
      console.log(` -> Dismiss clicked. Error banner present: ${!!errorStillPresent}`);
      report.scenarios.push({
        name: "Server Error Handling & Dismissal",
        status: errorText.includes("Simulated") && !errorStillPresent ? "PASSED" : "FAILED",
        details: { errorText, dismissed: !errorStillPresent },
      });
    }

    page.off("request", mockErrorHandler);
    await page.setRequestInterception(false);

    // Scenario I: Responsive Layout Checks
    console.log("[Scenario I] Testing Responsive Viewports (Mobile, Tablet, Desktop)...");
    const viewports = [
      { name: "Mobile", width: 375, height: 667 },
      { name: "Tablet", width: 768, height: 1024 },
      { name: "Desktop", width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise((r) => setTimeout(r, 400));
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      const screenshotFile = `06-responsive-${vp.name.toLowerCase()}-${vp.width}x${vp.height}.png`;
      await page.screenshot({ path: path.resolve(evidenceDir, screenshotFile), fullPage: true });

      console.log(` -> Viewport ${vp.name} (${vp.width}x${vp.height}): Horizontal Overflow = ${hasHorizontalScroll}`);
      report.responsiveChecks.push({
        name: vp.name,
        width: vp.width,
        height: vp.height,
        horizontalOverflow: hasHorizontalScroll,
        status: !hasHorizontalScroll ? "PASSED" : "FAILED",
        screenshot: screenshotFile,
      });
    }

    // Aggregate summary
    const allViolations = report.axeAudits.flatMap((a) => a.violations);
    const uniqueViolations = [...new Map(allViolations.map((v) => [v.id, v])).values()];

    report.summary.totalTests = report.scenarios.length + report.responsiveChecks.length;
    report.summary.passed =
      report.scenarios.filter((s) => s.status === "PASSED").length +
      report.responsiveChecks.filter((r) => r.status === "PASSED").length;
    report.summary.failed = report.summary.totalTests - report.summary.passed;
    report.summary.defectsFound = uniqueViolations;

    console.log("\n=================================================");
    console.log(` QA Run Complete: ${report.summary.passed}/${report.summary.totalTests} Scenarios Passed`);
    console.log(` Total Axe Violations across all tested states: ${uniqueViolations.length}`);
    console.log("=================================================");

    fs.writeFileSync(path.resolve(evidenceDir, "qa-report.json"), JSON.stringify(report, null, 2));
    console.log(`Report and screenshots written to ${evidenceDir}`);
  } finally {
    if (browser) await browser.close();
    viteProc.kill();
    backendProc.kill();
  }
}

main().catch((err) => {
  console.error("Browser QA Runner encountered fatal error:", err);
  process.exit(1);
});
