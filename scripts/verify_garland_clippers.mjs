import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-clippers";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACTS = path.join(ROOT, "artifacts");


function assert(condition, message) {
  if (!condition) throw new Error(message);
}


class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      (this.listeners.get(message.method) || []).forEach((callback) => callback(message.params));
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) || [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }

  once(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const callback = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== callback));
        resolve(params);
      };
      this.on(method, callback);
    });
  }

  close() {
    this.socket.close();
  }
}


async function waitForFile(file, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      await access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}


async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}


async function waitForChart(client) {
  await evaluate(client, `new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const root = document.querySelector('[data-garland-clippers-chart]');
      if (root?.garlandClippersChart?.rows.length === 5 && root.querySelectorAll('svg').length === 3) resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('Garland chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}


async function captureElement(client, filename) {
  const clip = await evaluate(client, `(() => {
    const rect = document.querySelector('[data-garland-clippers-chart]').getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip });
  await writeFile(path.join(ARTIFACTS, filename), Buffer.from(result.data, "base64"));
}


async function run() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "garland-chart-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--use-angle=swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let client;
  const browserErrors = [];

  try {
    const activePortFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(activePortFile);
    const [port] = (await readFile(activePortFile, "utf8")).trim().split(/\s+/);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    assert(page, "No browser page target was available.");
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    client.on("Runtime.exceptionThrown", (params) => browserErrors.push(params.exceptionDetails.text));
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") browserErrors.push(params.args.map((arg) => arg.value || arg.description).join(" "));
    });
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }),
    ]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: URL });
    await loaded;
    await waitForChart(client);

    const desktop = await evaluate(client, `(() => {
      const root = document.querySelector('[data-garland-clippers-chart]');
      const chart = root.garlandClippersChart;
      const style = getComputedStyle(root);
      const intro = root.parentElement.querySelector('.story--clippers-intro');
      const continuation = root.parentElement.querySelector('.story--clippers-continuation');
      const labels = [...root.querySelectorAll('.garland-chart__value')].map((node) => node.textContent.trim());
      const tickDetails = [...root.querySelectorAll('.garland-chart__tick-detail')].map((node) => node.textContent.trim());
      return {
        busy: root.getAttribute('aria-busy'),
        initialized: root.dataset.garlandInitialized,
        roots: document.querySelectorAll('[data-garland-clippers-chart]').length,
        rows: chart.rows.length,
        seasons: chart.rows.map((row) => row.season),
        panels: root.querySelectorAll('.garland-chart__panel').length,
        svgs: root.querySelectorAll('svg').length,
        bars: root.querySelectorAll('.garland-chart__bar').length,
        points: root.querySelectorAll('.garland-chart__point').length,
        hits: root.querySelectorAll('.garland-chart__hit').length,
        labels,
        tickDetails,
        reference: root.querySelector('.garland-chart__reference-label')?.textContent,
        tableRows: root.querySelectorAll('.garland-chart__table-row').length,
        tableText: root.querySelector('.garland-chart__table')?.textContent.replace(/\\s+/g, ' ').trim(),
        selected: chart.selectedSeason,
        inspection: root.querySelector('.garland-chart__inspection-values').textContent.replace(/\\s+/g, ' ').trim(),
        identity: style.getPropertyValue('--team-identity').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
        secondary: style.getPropertyValue('--team-secondary').trim(),
        story: {
          introCount: intro?.querySelectorAll(':scope > p').length,
          continuationCount: continuation?.querySelectorAll(':scope > p').length,
          chartFollowsIntro: intro?.nextElementSibling === root,
          continuationFollowsChart: root.nextElementSibling === continuation,
          linkCount: intro?.querySelectorAll('a').length,
          hasPlaceholder: !!root.closest('.team-body')?.querySelector('.watch'),
        },
      };
    })()`);
    assert(desktop.busy === "false" && desktop.initialized === "true" && desktop.roots === 1, "Chart did not initialize exactly once.");
    assert(desktop.rows === 5 && desktop.seasons.join("|") === "2021-22|2022-23|2023-24|2024-25|2025-26", "Five-season coverage is incorrect.");
    assert(desktop.panels === 3 && desktop.svgs === 3 && desktop.bars === 5 && desktop.points === 15 && desktop.hits === 15, "Panel marks or keyboard targets are incomplete.");
    ["68 G", "69 G", "57 G", "75 G", "45 G", "30.3", "30.5", "26.7", "32.3", "30.6", "12.0", "11.0", "9.7", "10.6", "10.9", "57.6%", "58.7%", "56.0%", "60.0%", "58.2%"].forEach((value) => assert(desktop.labels.includes(value), `Direct labels omit ${value}.`));
    ["14 not played", "13 not played", "25 not played", "7 not played", "37 not played", "35.7 MPG", "35.5 MPG", "33.4 MPG", "30.7 MPG", "29.9 MPG"].forEach((value) => assert(desktop.tickDetails.includes(value), `Availability labels omit ${value}.`));
    assert(desktop.reference === "82-game schedule", "The verified schedule reference is missing.");
    assert(desktop.tableRows === 5 && desktop.tableText.includes("2 teams (combined total)") && desktop.tableText.includes("37") && desktop.tableText.includes("58.2%"), "Accessible table omits combined-team or latest-season values.");
    assert(desktop.selected === "2025-26" && desktop.inspection.includes("45 games · 37 not played") && desktop.inspection.includes("30.6 points / 100") && desktop.inspection.includes("10.9 assists / 100") && desktop.inspection.includes("58.2% TS"), "Default selected-season text is incomplete.");
    assert(desktop.identity.toLowerCase() === "#c8102e" && desktop.surface.toLowerCase() === "#f8e2e6" && desktop.secondary.toLowerCase() === "#1d428a", "Clippers palette tokens are not inherited.");
    assert(desktop.story.introCount === 6 && desktop.story.continuationCount === 3 && desktop.story.chartFollowsIntro && desktop.story.continuationFollowsChart && desktop.story.linkCount === 1 && !desktop.story.hasPlaceholder, "Story copy, chart placement, link or placeholder state is incorrect.");
    await captureElement(client, "garland-clippers-desktop.png");

    const interaction = await evaluate(client, `(async () => {
      const root = document.querySelector('[data-garland-clippers-chart]');
      const hit = root.querySelector('.garland-chart__hit[data-season="2023-24"]');
      hit.focus();
      hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const selected = root.garlandClippersChart.selectedSeason;
      const inspection = root.querySelector('.garland-chart__inspection-values').textContent.replace(/\\s+/g, ' ').trim();
      const announcement = root.querySelector('.garland-chart__announcement').textContent;
      const card = root.closest('details');
      card.open = false;
      await new Promise((resolve) => setTimeout(resolve, 60));
      card.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { selected, inspection, announcement, svgs: root.querySelectorAll('svg').length, roots: document.querySelectorAll('[data-garland-clippers-chart]').length };
    })()`);
    assert(interaction.selected === "2023-24" && interaction.inspection.includes("57 games · 25 not played") && interaction.inspection.includes("26.7 points / 100") && interaction.inspection.includes("9.7 assists / 100") && interaction.inspection.includes("56.0% TS"), "Keyboard selection did not update all textual details.");
    assert(interaction.announcement.includes("25 not played") && interaction.svgs === 3 && interaction.roots === 1, "Live announcement or collapse/reopen state is incorrect.");

    await evaluate(client, `document.querySelector('[data-garland-clippers-chart]').garlandClippersChart.selectSeason('2025-26', false)`);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(client, `new Promise((resolve) => { window.dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 180); })`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-garland-clippers-chart]');
      const firstPanel = root.querySelector('.garland-chart__panel');
      const firstHit = root.querySelector('.garland-chart__hit');
      firstHit.focus();
      root.querySelector('.garland-chart__table-details').open = true;
      return {
        panelWidth: firstPanel.getBoundingClientRect().width,
        plotWidth: root.querySelector('.garland-chart__plot').getBoundingClientRect().width,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        tableRows: root.querySelectorAll('.garland-chart__table-row').length,
        tableDisplay: getComputedStyle(root.querySelector('.garland-chart__table-row')).display,
        hitFocused: document.activeElement === firstHit,
        hitRole: firstHit.getAttribute('role'),
      };
    })()`);
    assert(mobile.panelWidth <= mobile.plotWidth && mobile.pageWidth <= mobile.viewportWidth, `Mobile layout overflowed (${mobile.pageWidth} > ${mobile.viewportWidth}).`);
    assert(mobile.tableRows === 5 && mobile.tableDisplay === "grid" && mobile.hitFocused && mobile.hitRole === "button", "Mobile table or keyboard target is incomplete.");
    await evaluate(client, `document.querySelector('.garland-chart__table-details').open = false`);
    await captureElement(client, "garland-clippers-mobile.png");

    await client.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert(await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`), "Reduced-motion mode was not recognized.");
    assert(browserErrors.length === 0, `Browser console/runtime errors: ${browserErrors.join(" | ")}`);

    console.log("PASS: five unique regular-season records and supplied 2025-26 combined total.");
    console.log("PASS: three aligned panels, direct labels, 82-game reference and accessible table.");
    console.log("PASS: Clippers theme, complete story placement and neutral absence language.");
    console.log("PASS: keyboard/touch selection, collapse/reopen, 390px layout and no page overflow.");
    console.log("Wrote artifacts/garland-clippers-desktop.png and artifacts/garland-clippers-mobile.png");
  } finally {
    if (client) client.close();
    chrome.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await rm(profile, { recursive: true, force: true });
  }
}


run().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
