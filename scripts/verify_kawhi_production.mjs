import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-raptors";
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
      const root = document.querySelector('[data-kawhi-production-chart]');
      if (root?.kawhiProductionChart?.rows.length === 28 && root.querySelectorAll('svg').length === 3) resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('Kawhi chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}


async function captureElement(client, filename) {
  const clip = await evaluate(client, `(() => {
    const rect = document.querySelector('[data-kawhi-production-chart]').getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip });
  await writeFile(path.join(ARTIFACTS, filename), Buffer.from(result.data, "base64"));
}


async function run() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "kawhi-chart-chrome-"));
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
      const root = document.querySelector('[data-kawhi-production-chart]');
      const chart = root.kawhiProductionChart;
      const coordinateErrors = [];
      chart.panelStates.forEach((state) => {
        if (state.metric.kind === 'bar') {
          root.querySelectorAll('.kawhi-production__bar').forEach((mark) => {
            const row = chart.regularBySeason.get(mark.dataset.season);
            const expectedY = row.games === 0 ? state.bottom - 2 : state.y(row.games);
            const expectedHeight = row.games === 0 ? 2 : state.bottom - state.y(row.games);
            if (Math.abs(Number(mark.getAttribute('y')) - expectedY) > .01 || Math.abs(Number(mark.getAttribute('height')) - expectedHeight) > .01) {
              coordinateErrors.push([state.metric.key, row.season]);
            }
          });
        } else {
          root.querySelectorAll('.kawhi-production__panel').forEach(() => {});
          const panel = [...root.querySelectorAll('.kawhi-production__panel')].find((item) => item.querySelector('title')?.textContent === state.metric.title);
          panel.querySelectorAll('.kawhi-production__point').forEach((mark) => {
            const row = chart.regularBySeason.get(mark.dataset.season);
            if (Math.abs(Number(mark.getAttribute('cx')) - state.x(row.season)) > .01 || Math.abs(Number(mark.getAttribute('cy')) - state.y(row[state.metric.key])) > .01) {
              coordinateErrors.push([state.metric.key, row.season]);
            }
          });
        }
      });
      const tableRows = [...root.querySelectorAll('.kawhi-production__table-row')].map((row) => [...row.children].map((cell) => cell.textContent.trim()));
      const style = getComputedStyle(root);
      const intro = root.parentElement.querySelector('.story--raptors-intro');
      const continuation = root.parentElement.querySelector('.story--raptors-continuation');
      return {
        busy: root.getAttribute('aria-busy'),
        rows: chart.rows.length,
        regularRows: chart.regularRows.length,
        postseasonRows: chart.postseasonRows.length,
        panels: root.querySelectorAll('.kawhi-production__panel').length,
        svgs: root.querySelectorAll('svg').length,
        bars: root.querySelectorAll('.kawhi-production__bar').length,
        points: root.querySelectorAll('.kawhi-production__point').length,
        lineSegments: [...root.querySelectorAll('.kawhi-production__line')].map((line) => (line.getAttribute('d').match(/M/g) || []).length),
        missedLabels: [...root.querySelectorAll('.kawhi-production__missed-label')].map((node) => node.textContent),
        directLabels: [...root.querySelectorAll('.kawhi-production__direct-value')].map((node) => node.textContent),
        domains: chart.panelStates.map((state) => state.y.domain()),
        coordinateErrors,
        playoffItems: root.querySelectorAll('.kawhi-production__playoff-item').length,
        twoGameItems: root.querySelectorAll('.kawhi-production__playoff-item.is-two-game').length,
        playoffText: root.querySelector('.kawhi-production__playoff-list').textContent.replace(/\\s+/g, ' ').trim(),
        tableRows,
        selected: chart.selectedSeason,
        inspection: root.querySelector('.kawhi-production__inspection-values').textContent.replace(/\\s+/g, ' ').trim(),
        latest: root.querySelector('.kawhi-production__latest').textContent.trim(),
        identity: style.getPropertyValue('--team-identity').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
        story: {
          introCount: intro?.querySelectorAll(':scope > p').length,
          continuationCount: continuation?.querySelectorAll(':scope > p').length,
          chartFollowsIntro: intro?.nextElementSibling === root,
          continuationFollowsChart: root.nextElementSibling === continuation,
          latestSentence: intro?.lastElementChild?.textContent.includes('he averaged 27.9 points over 65 games and made All-NBA second team last season'),
          links: intro?.querySelectorAll('a').length,
        },
      };
    })()`);
    assert(desktop.busy === "false" && desktop.rows === 28 && desktop.regularRows === 8 && desktop.postseasonRows === 7, "Normalized row counts or loading state were incorrect.");
    assert(desktop.panels === 3 && desktop.svgs === 3 && desktop.bars === 8 && desktop.points === 14, "The main panels or marks were incomplete.");
    assert(JSON.stringify(desktop.lineSegments) === JSON.stringify([2, 2]), "Rate lines did not break at the missed season.");
    assert(JSON.stringify(desktop.domains) === JSON.stringify([[0,82],[0,50],[0.45,0.7]]), "Panel domains changed unexpectedly.");
    assert(desktop.coordinateErrors.length === 0, `Plotted coordinates disagreed with normalized values: ${JSON.stringify(desktop.coordinateErrors)}`);
    assert(desktop.missedLabels.length === 6 && desktop.missedLabels.join(" ").includes("Missed season"), "Missed-season annotations were incomplete.");
    ["60", "65", "37.5", "43.3", "60.6%", "62.9%"].forEach((value) => assert(desktop.directLabels.includes(value), `Direct labels omitted ${value}.`));
    assert(desktop.playoffItems === 7 && desktop.twoGameItems === 2, "Postseason strip did not preserve all aligned seasons or two-game warnings.");
    ["24 G / 939 min", "13 G / 511 min", "11 G / 432 min", "2 G / 80 min", "2 G / 59 min", "7 G / 265 min", "No appearance recorded in supplied tables"].forEach((value) => assert(desktop.playoffText.includes(value), `Postseason strip omitted ${value}. Actual: ${desktop.playoffText}`));
    assert(desktop.tableRows.length === 15, "Accessible table did not contain eight regular-season and seven postseason rows.");
    const expectedLatest = ["2025–26", "Regular season", "LAC", "Appeared", "34", "65", "65", "32.1", "2,085", "27.9", "43.3", "5.6", "62.9%", "33.5%", "8.4%"];
    assert(JSON.stringify(desktop.tableRows.at(-1)) === JSON.stringify(expectedLatest), `Latest table row disagreed: ${JSON.stringify(desktop.tableRows.at(-1))}`);
    assert(desktop.selected === "2025-26" && desktop.inspection.includes("65 games · 2,085 total minutes · 32.1 MPG · age 34") && desktop.inspection.includes("43.3 points/100") && desktop.inspection.includes("62.9% TS"), "Default latest-season inspection was incomplete.");
    assert(desktop.latest === "2025–26: 65 games · 43.3 points per 100 · 62.9% TS", "Latest-season callout changed.");
    assert(desktop.identity.toLowerCase() === "#ce1141" && desktop.surface.toLowerCase() === "#f9e2e8", "Toronto theme tokens were not inherited.");
    assert(desktop.story.introCount === 6 && desktop.story.continuationCount === 5 && desktop.story.chartFollowsIntro && desktop.story.continuationFollowsChart && desktop.story.latestSentence && desktop.story.links === 2, "Raptors copy, links, or chart placement changed.");
    await captureElement(client, "kawhi-production-availability-desktop.png");

    const interaction = await evaluate(client, `(async () => {
      const root = document.querySelector('[data-kawhi-production-chart]');
      const hit = root.querySelector('.kawhi-production__season-hit[data-season="2021-22"]');
      hit.focus();
      hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const missedTitle = root.querySelector('.kawhi-production__inspection-title').textContent;
      const missedInspection = root.querySelector('.kawhi-production__inspection-values').textContent.replace(/\\s+/g, ' ').trim();
      const playoff = root.querySelector('.kawhi-production__playoff-item[data-season="2023-24"]');
      playoff.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      const touchTitle = root.querySelector('.kawhi-production__inspection-title').textContent;
      const touchInspection = root.querySelector('.kawhi-production__inspection-values').textContent.replace(/\\s+/g, ' ').trim();
      const card = root.closest('details');
      card.open = false;
      await new Promise((resolve) => setTimeout(resolve, 60));
      card.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { missedTitle, missedInspection, touchTitle, touchInspection, svgs: root.querySelectorAll('svg').length, roots: document.querySelectorAll('[data-kawhi-production-chart]').length, initialized: root.dataset.kawhiInitialized };
    })()`);
    assert(interaction.missedTitle === "2021–22" && interaction.missedInspection.includes("No appearances · 0 games · 0 total minutes") && interaction.missedInspection.includes("undefined—not zero"), "Keyboard inspection did not distinguish no appearances from undefined rates.");
    assert(interaction.missedInspection.includes("No appearance recorded in supplied tables") && interaction.missedInspection.includes("no absence reason is inferred"), "Missing postseason record was treated as a zero or given a cause.");
    assert(interaction.touchTitle === "2023–24" && interaction.touchInspection.includes("2 games · 59 total minutes") && interaction.touchInspection.includes("21.5 points/100") && interaction.touchInspection.includes("47.4% TS") && interaction.touchInspection.includes("2-game sample"), "Touch inspection did not expose the small playoff sample and rates.");
    assert(interaction.svgs === 3 && interaction.roots === 1 && interaction.initialized === "true", "Reopening duplicated chart elements or handlers.");

    await evaluate(client, `document.querySelector('[data-kawhi-production-chart]').kawhiProductionChart.selectSeason('2025-26', false)`);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(client, `new Promise((resolve) => { window.dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 180); })`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-kawhi-production-chart]');
      const panels = root.querySelector('.kawhi-production__panels');
      const firstPanel = root.querySelector('.kawhi-production__panel');
      const firstHit = root.querySelector('.kawhi-production__season-hit');
      firstHit.focus();
      return {
        columns: getComputedStyle(panels).gridTemplateColumns,
        panelWidth: firstPanel.getBoundingClientRect().width,
        plotWidth: root.querySelector('.kawhi-production__plot').getBoundingClientRect().width,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        playoffColumns: getComputedStyle(root.querySelector('.kawhi-production__playoff-list')).gridTemplateColumns,
        tableRows: root.querySelectorAll('.kawhi-production__table-row').length,
        hitFocused: document.activeElement === firstHit,
        hitRole: firstHit.getAttribute('role'),
      };
    })()`);
    assert(!mobile.columns.includes(" ") && mobile.panelWidth <= mobile.plotWidth, "Main panels did not stack at 390px.");
    assert(!mobile.playoffColumns.includes(" "), "Postseason strip did not become a chronological list on mobile.");
    assert(mobile.pageWidth <= mobile.viewportWidth, `Mobile page overflowed (${mobile.pageWidth} > ${mobile.viewportWidth}).`);
    assert(mobile.tableRows === 15 && mobile.hitFocused && mobile.hitRole === "button", "Mobile table or keyboard target was incomplete.");
    await captureElement(client, "kawhi-production-availability-mobile.png");

    await client.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert(await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`), "Reduced-motion mode was not recognized.");
    assert(browserErrors.length === 0, `Browser console/runtime errors: ${browserErrors.join(" | ")}`);

    console.log("PASS: 28 normalized records; eight regular-season slots and seven postseason slots.");
    console.log("PASS: exact domains, source-driven coordinates, direct labels, line breaks and 15-row accessible table.");
    console.log("PASS: story placement and latest-season sentence; Toronto theme and postseason coverage language.");
    console.log("PASS: keyboard/touch inspection, missed-season semantics, two-game warnings, collapse/reopen and resize.");
    console.log("PASS: 390px stacking, no page overflow, reduced motion and no browser console/runtime errors.");
    console.log("Wrote artifacts/kawhi-production-availability-desktop.png and artifacts/kawhi-production-availability-mobile.png");
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
