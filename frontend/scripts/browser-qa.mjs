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

async function waitForUrl(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return true;
      }
    } catch {
      // Polling
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

async function captureCleanScreenshot(page, filename, options = {}) {
  const filePath = path.resolve(evidenceDir, filename);
  if (options.fullPage) {
    // Prevent sticky header from obscuring stitched content in fullPage capture
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const header = document.querySelector(".app-header");
      if (header) {
        header.setAttribute("data-prev-pos", header.style.position || "");
        header.style.position = "relative";
      }
    });
    await new Promise((r) => setTimeout(r, 120));
    await page.screenshot({ path: filePath, fullPage: true });
    await page.evaluate(() => {
      const header = document.querySelector(".app-header");
      if (header) {
        header.style.position = header.getAttribute("data-prev-pos") || "";
        header.removeAttribute("data-prev-pos");
      }
    });
  } else if (options.scrollToSelector) {
    // Scroll element cleanly into view with comfortable clearance below the sticky header
    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el) {
        const header = document.querySelector(".app-header");
        const headerHeight = header ? header.offsetHeight + 14 : 90;
        const targetY = el.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top: Math.max(0, targetY) });
      }
    }, options.scrollToSelector);
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: filePath });
  } else {
    await page.screenshot({ path: filePath });
  }
}

async function main() {
  console.log("=================================================");
  console.log(" Starting Phase 6 Dark Dashboard Browser QA Run  ");
  console.log("=================================================");

  const report = {
    timestamp: new Date().toISOString(),
    browser: "Google Chrome",
    theme: "Dark Developer Dashboard",
    scenarios: [],
    axeAudits: [],
    responsiveChecks: [],
    screenshots: [],
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
    await waitForUrl("http://127.0.0.1:5000/api/metadata", 20000);
    console.log(" -> Flask Backend ready and metadata available.");

    await waitForUrl("http://localhost:3000", 20000);
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

    // Scenario A: Desktop Homepage & Initial Hydration
    console.log("[Scenario A] Navigating to http://localhost:3000 ...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });

    const screenshotHome = "01-desktop-homepage.png";
    await captureCleanScreenshot(page, screenshotHome, { fullPage: true });
    report.screenshots.push(screenshotHome);

    const title = await page.title();
    const brandName = await page.$eval(".brand-name", (el) => el.textContent.trim());
    const apiBadge = await page.$eval(".api-status-badge", (el) => el.textContent.trim());
    const metricCards = await page.$$eval(".metric-card", (els) => els.length);
    console.log(` -> Title: "${title}", Brand: "${brandName}", API: "${apiBadge}", Metric cards: ${metricCards}`);

    report.scenarios.push({
      name: "Desktop Homepage & Shell Hydration",
      status: brandName === "Project Partner" && apiBadge.includes("Online") && metricCards === 4 ? "PASSED" : "FAILED",
      details: { title, brandName, apiBadge, metricCards },
    });

    // Axe on Initial State
    console.log(" -> Running Axe-Core on Initial Dark Dashboard State...");
    const axeInitial = await runAxe(page, "Initial Page State");
    report.axeAudits.push(axeInitial);
    console.log(`    Axe Passes: ${axeInitial.passesCount}, Violations: ${axeInitial.violationsCount}`);

    // Scenario B: Skip Link & Tablist Arrow Navigation
    console.log("[Scenario B] Testing Skip Link & Keyboard Navigation...");
    await page.keyboard.press("Tab");
    const activeEl = await page.evaluate(() => {
      const el = document.activeElement;
      return { tagName: el.tagName, className: el.className, text: el.textContent?.trim(), href: el.getAttribute("href") };
    });
    const skipLinkVisible = await page.$eval(".skip-link", (el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom > 0;
    });

    await page.focus("#tab-hybrid");
    await page.keyboard.press("ArrowRight");
    await new Promise((r) => setTimeout(r, 100));
    const tabAfterRight = await page.evaluate(() => ({
      id: document.activeElement?.id,
      selected: document.activeElement?.getAttribute("aria-selected"),
    }));

    await page.keyboard.press("ArrowLeft");
    await new Promise((r) => setTimeout(r, 100));
    const tabAfterLeft = await page.evaluate(() => ({
      id: document.activeElement?.id,
      selected: document.activeElement?.getAttribute("aria-selected"),
    }));

    console.log(` -> Active element after Tab: <${activeEl.tagName} class="${activeEl.className}"> (${activeEl.text})`);
    console.log(` -> Skip Link: ${skipLinkVisible}, Tab ArrowRight: ${tabAfterRight.id}, Tab ArrowLeft: ${tabAfterLeft.id}`);
    report.scenarios.push({
      name: "Keyboard Navigation & Skip Link",
      status: skipLinkVisible && tabAfterRight.id === "tab-bio" && tabAfterLeft.id === "tab-hybrid" ? "PASSED" : "FAILED",
      details: { skipLinkVisible, tabAfterRight, tabAfterLeft },
    });

    // Scenario C: Sample Profile Quick-Pick & Hybrid Search
    console.log("[Scenario C] Submitting Hybrid Partner Search for @abhay...");
    const sampleBtn = await page.$(".sample-btn");
    if (sampleBtn) await sampleBtn.click();

    const submitBtn = await page.$('button[type="submit"]');
    const loadingPromise = page.waitForSelector(".loading-state", { timeout: 3000 }).catch(() => null);
    await submitBtn.click();
    const loadingEl = await loadingPromise;
    if (loadingEl) {
      const screenshotLoading = "11-loading-state.png";
      await captureCleanScreenshot(page, screenshotLoading, { fullPage: true });
      report.screenshots.push(screenshotLoading);
    }

    await page.waitForSelector(".candidate-card", { timeout: 15000 });
    const hybridCount = await page.$$eval(".candidate-card", (els) => els.length);
    const firstUser = await page.$eval(".candidate-card .cand-username", (el) => el.textContent.trim());
    const breakdownMeters = await page.$$eval(".breakdown-meter-fill", (els) => els.length);
    const profileLinks = await page.$$eval(".github-link", (els) => els.length);

    console.log(` -> Retrieved ${hybridCount} candidate cards (${firstUser}). Meters: ${breakdownMeters}, Links: ${profileLinks}`);

    const screenshotHybrid = "02-desktop-hybrid-results.png";
    await captureCleanScreenshot(page, screenshotHybrid, { fullPage: true });
    report.screenshots.push(screenshotHybrid);

    report.scenarios.push({
      name: "Desktop Hybrid Results Workflow",
      status: hybridCount === 5 && breakdownMeters >= 15 && profileLinks === 5 ? "PASSED" : "FAILED",
      details: { hybridCount, firstUser, breakdownMeters, profileLinks },
    });

    // Axe on Hybrid Results
    console.log(" -> Running Axe-Core on Hybrid Results State...");
    const axeHybrid = await runAxe(page, "Hybrid Results State");
    report.axeAudits.push(axeHybrid);
    console.log(`    Axe Passes: ${axeHybrid.passesCount}, Violations: ${axeHybrid.violationsCount}`);

    // Scenario D: Empty Results State
    console.log("[Scenario D] Testing Empty Results State...");
    await page.type("#input-location", "UnknownAtlantisIsland999");
    await submitBtn.click();
    await page.waitForSelector(".empty-state", { timeout: 15000 });
    const emptyTitle = await page.$eval(".empty-state h3", (el) => el.textContent.trim());

    const screenshotEmpty = "03-empty-state.png";
    await captureCleanScreenshot(page, screenshotEmpty, { fullPage: true });
    report.screenshots.push(screenshotEmpty);

    report.scenarios.push({
      name: "Empty Results State",
      status: emptyTitle.includes("No Matching Developer Profiles") ? "PASSED" : "FAILED",
      details: { emptyTitle },
    });

    const axeEmpty = await runAxe(page, "Empty Results State");
    report.axeAudits.push(axeEmpty);

    // Scenario E: Form Reset & Validation Error
    console.log("[Scenario E] Testing Form Reset and Validation Error...");
    const resetBtn = await page.$('button[type="button"].btn-outline');
    await resetBtn.click();

    await submitBtn.click(); // Submit empty
    await page.waitForSelector(".alert-warning", { timeout: 5000 });
    const valMsg = await page.$eval(".alert-warning .alert-text", (el) => el.textContent.trim());
    const isInvalid = await page.$eval("#input-username", (el) => el.getAttribute("aria-invalid"));

    const screenshotVal = "04-validation-error.png";
    await captureCleanScreenshot(page, screenshotVal, { fullPage: true });
    report.screenshots.push(screenshotVal);

    report.scenarios.push({
      name: "Form Validation Error & Semantics",
      status: valMsg.includes("required") && isInvalid === "true" ? "PASSED" : "FAILED",
      details: { valMsg, isInvalid },
    });

    const axeVal = await runAxe(page, "Validation Error State");
    report.axeAudits.push(axeVal);

    // Scenario F: Semantic Concept Search Workflow
    console.log("[Scenario F] Switching to Semantic Concept Search Tab...");
    await page.click("#tab-bio");
    await page.waitForSelector("#panel-bio", { timeout: 5000 });

    const promptChip = await page.$(".prompt-chip");
    if (promptChip) await promptChip.click();

    const bioSubmitBtn = await page.$('#panel-bio button[type="submit"]');
    await bioSubmitBtn.click();

    await page.waitForSelector(".candidate-card", { timeout: 30000 });
    const bioCount = await page.$$eval(".candidate-card", (els) => els.length);
    const engineLabel = await page.$eval(".results-meta strong", (el) => el.textContent.trim());

    // Privacy check
    const rawBioLeaks = await page.evaluate(() => {
      const allText = document.body.innerText;
      return allText.includes("Candidate Bio:") || allText.includes("Raw Bio:");
    });

    console.log(` -> Semantic candidates: ${bioCount}, Engine label: "${engineLabel}", Raw bio leaks: ${rawBioLeaks}`);

    const screenshotSemantic = "05-desktop-semantic-results.png";
    await captureCleanScreenshot(page, screenshotSemantic, { fullPage: true });
    report.screenshots.push(screenshotSemantic);

    report.scenarios.push({
      name: "Semantic Concept Search & Privacy",
      status: bioCount === 5 && !rawBioLeaks && engineLabel.length > 0 ? "PASSED" : "FAILED",
      details: { bioCount, engineLabel, rawBioLeaks },
    });

    // Axe on Semantic Results
    const axeBio = await runAxe(page, "Semantic Results State");
    report.axeAudits.push(axeBio);

    // Scenario G: Simulated Server Error & Dismissal
    console.log("[Scenario G] Testing Simulated Server Error & Dismissal...");
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

    // Ensure input-bio has text to trigger request rather than validation warning
    await page.type("#input-bio", " Python test query for 500 error");
    await bioSubmitBtn.click();
    await page.waitForSelector(".alert-error", { timeout: 10000 });
    const errorText = await page.$eval(".alert-error .alert-text", (el) => el.textContent.trim());

    const screenshotError = "06-network-error.png";
    await captureCleanScreenshot(page, screenshotError, { fullPage: true });
    report.screenshots.push(screenshotError);

    const axeError = await runAxe(page, "Network Error State");
    report.axeAudits.push(axeError);

    const dismissBtn = await page.$(".alert-dismiss");
    if (dismissBtn) await dismissBtn.click();
    const errorPresent = await page.$(".alert-error");

    page.off("request", mockErrorHandler);
    await page.setRequestInterception(false);

    report.scenarios.push({
      name: "Server Error Handling & Dismissal",
      status: errorText.includes("Simulated") && !errorPresent ? "PASSED" : "FAILED",
      details: { errorText, dismissed: !errorPresent },
    });

    // Scenario H: About & Contributor Modal Dialog
    console.log("[Scenario H] Opening About & Team Modal...");
    const aboutBtn = await page.$(".btn-header-link");
    if (aboutBtn) {
      await aboutBtn.click();
      await page.waitForSelector(".modal-card", { timeout: 5000 });

      const modalTitle = await page.$eval(".modal-title", (el) => el.textContent.trim());
      const teamListCount = await page.$$eval(".modal-team-list li", (els) => els.length);

      const screenshotModal = "07-about-modal.png";
      await captureCleanScreenshot(page, screenshotModal);
      report.screenshots.push(screenshotModal);

      const axeModal = await runAxe(page, "About Modal State");
      report.axeAudits.push(axeModal);

      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 200));
      const modalStillOpen = await page.$(".modal-card");

      console.log(` -> Modal: "${modalTitle}", Contributors: ${teamListCount}, Esc closes: ${!modalStillOpen}`);
      report.scenarios.push({
        name: "About & Contributor Modal Dialog",
        status: modalTitle.includes("About Project Partner") && teamListCount === 10 && !modalStillOpen ? "PASSED" : "FAILED",
        details: { modalTitle, teamListCount, closedOnEsc: !modalStillOpen },
      });
    }

    // Scenario I: Responsive Layout Checks (Mobile 375px, Compact 320px, & Tablet 768px)
    console.log("[Scenario I] Testing Mobile & Tablet Viewports...");

    // 1. Mobile Dark view (375x667)
    await page.setViewport({ width: 375, height: 667 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 400));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

    // Ensure candidate cards are rendered for mobile results capture
    await page.click("#tab-hybrid");
    const hybridInputVal = await page.$eval("#input-username", (el) => el.value);
    if (!hybridInputVal) {
      await page.type("#input-username", "abhay");
      const submitMobile = await page.$('button[type="submit"]');
      await submitMobile.click();
      await page.waitForSelector(".candidate-card", { timeout: 15000 });
    }

    // Scroll to top for mobile search interface
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 200));
    const screenshotMobileSearch = "08-mobile-search-interface.png";
    await captureCleanScreenshot(page, screenshotMobileSearch);
    report.screenshots.push(screenshotMobileSearch);

    // Mobile recommendation cards scrolled cleanly below sticky header
    const screenshotMobileCards = "09-mobile-recommendation-cards.png";
    await captureCleanScreenshot(page, screenshotMobileCards, { scrollToSelector: ".results-container" });
    report.screenshots.push(screenshotMobileCards);

    // 2. Extra Compact Mobile View (320x568 - iPhone SE)
    await page.setViewport({ width: 320, height: 568 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 300));
    const mobile320Overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const screenshot320 = "16-mobile-320px-header.png";
    await captureCleanScreenshot(page, screenshot320);
    report.screenshots.push(screenshot320);

    // Test theme selector responsiveness and click functionality at 320px
    const themeBtnDark320 = await page.$("#theme-btn-dark");
    if (themeBtnDark320) await themeBtnDark320.click();
    await new Promise((r) => setTimeout(r, 100));
    const theme320Dark = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));

    // 3. Tablet view (768x1024)
    await page.setViewport({ width: 768, height: 1024 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 400));
    const tabletOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const screenshotTablet = "10-tablet-layout.png";
    await captureCleanScreenshot(page, screenshotTablet, { fullPage: true });
    report.screenshots.push(screenshotTablet);

    // Test theme selector at 768px
    const themeBtnSystem768 = await page.$("#theme-btn-system");
    if (themeBtnSystem768) await themeBtnSystem768.click();
    await new Promise((r) => setTimeout(r, 100));

    report.responsiveChecks.push(
      { name: "Tablet (768x1024)", overflow: tabletOverflow, status: !tabletOverflow ? "PASSED" : "FAILED", screenshot: screenshotTablet },
      { name: "Mobile (375x667)", overflow: mobileOverflow, status: !mobileOverflow ? "PASSED" : "FAILED", screenshot: screenshotMobileCards },
      { name: "Compact Mobile (320x568)", overflow: mobile320Overflow, status: !mobile320Overflow ? "PASSED" : "FAILED", screenshot: screenshot320 }
    );

    // Scenario J: Theme Support (Light, Dark, System) & Light Theme Verification
    console.log("[Scenario J] Testing Theme Switcher & Light Theme Accessibility...");
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 200));

    // 1. Switch to Light Theme
    const lightBtn = await page.$("#theme-btn-light");
    if (lightBtn) await lightBtn.click();
    await new Promise((r) => setTimeout(r, 200));

    const lightThemeAttr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const storedPref = await page.evaluate(() => localStorage.getItem("partner_theme_pref"));

    const screenshotLightHome = "12-desktop-light-homepage.png";
    await captureCleanScreenshot(page, screenshotLightHome, { fullPage: true });
    report.screenshots.push(screenshotLightHome);

    const axeLightHome = await runAxe(page, "Desktop Light Homepage");
    report.axeAudits.push(axeLightHome);
    console.log(`    Axe Passes (Light Homepage): ${axeLightHome.passesCount}, Violations: ${axeLightHome.violationsCount}`);

    // 2. Perform Hybrid Search in Light Theme
    await page.click("#tab-hybrid");
    const hybridInput = await page.$("#input-username");
    await hybridInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type("#input-username", "abhay");
    const hybridSubmit = await page.$('button[type="submit"]');
    await hybridSubmit.click();
    await page.waitForSelector(".candidate-card", { timeout: 15000 });

    const screenshotLightHybrid = "13-desktop-light-hybrid-results.png";
    await captureCleanScreenshot(page, screenshotLightHybrid, { fullPage: true });
    report.screenshots.push(screenshotLightHybrid);

    const axeLightHybrid = await runAxe(page, "Desktop Light Hybrid Results");
    report.axeAudits.push(axeLightHybrid);
    console.log(`    Axe Passes (Light Hybrid): ${axeLightHybrid.passesCount}, Violations: ${axeLightHybrid.violationsCount}`);

    // 3. Mobile View in Light Theme (375x667)
    await page.setViewport({ width: 375, height: 667 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 300));
    const mobileLightOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

    const screenshotMobileLight = "14-mobile-light-interface.png";
    await captureCleanScreenshot(page, screenshotMobileLight);
    report.screenshots.push(screenshotMobileLight);

    const screenshotMobileLightCards = "15-mobile-light-recommendation-cards.png";
    await captureCleanScreenshot(page, screenshotMobileLightCards, { scrollToSelector: ".results-container" });
    report.screenshots.push(screenshotMobileLightCards);

    // 4. Test Dark and System buttons at desktop width
    await page.setViewport({ width: 1280, height: 800 });
    const darkBtn = await page.$("#theme-btn-dark");
    if (darkBtn) await darkBtn.click();
    await new Promise((r) => setTimeout(r, 150));
    const darkThemeAttr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));

    const systemBtn = await page.$("#theme-btn-system");
    if (systemBtn) await systemBtn.click();
    await new Promise((r) => setTimeout(r, 150));
    const systemPref = await page.evaluate(() => localStorage.getItem("partner_theme_pref"));

    report.scenarios.push({
      name: "Theme Selection & Light Theme Accessibility",
      status:
        lightThemeAttr === "light" &&
        storedPref === "light" &&
        !mobileLightOverflow &&
        darkThemeAttr === "dark" &&
        systemPref === "system" &&
        theme320Dark === "dark"
          ? "PASSED"
          : "FAILED",
      details: { lightThemeAttr, storedPref, mobileLightOverflow, darkThemeAttr, systemPref, theme320Dark },
    });

    // Summary calculation
    const allViolations = report.axeAudits.flatMap((a) => a.violations);
    const uniqueViolations = [...new Map(allViolations.map((v) => [v.id, v])).values()];

    report.summary.totalTests = report.scenarios.length + report.responsiveChecks.length;
    report.summary.passed =
      report.scenarios.filter((s) => s.status === "PASSED").length +
      report.responsiveChecks.filter((r) => r.status === "PASSED").length;
    report.summary.failed = report.summary.totalTests - report.summary.passed;
    report.summary.defectsFound = uniqueViolations;

    console.log("\n=================================================");
    console.log(` Dark Dashboard QA Complete: ${report.summary.passed}/${report.summary.totalTests} Scenarios Passed`);
    console.log(` Total Axe Violations across all tested states: ${uniqueViolations.length}`);
    console.log("=================================================");

    fs.writeFileSync(path.resolve(evidenceDir, "qa-report.json"), JSON.stringify(report, null, 2));
    console.log(`Updated report and screenshots saved to ${evidenceDir}`);
  } finally {
    if (browser) await browser.close();
    viteProc.kill();
    backendProc.kill();
  }
}

main().catch((err) => {
  console.error("Browser QA Runner fatal error:", err);
  process.exit(1);
});
