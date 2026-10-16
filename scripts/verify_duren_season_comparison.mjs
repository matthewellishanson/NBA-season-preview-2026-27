import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-pistons";
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
  const start = Date.now();
  while (Date.now() - start < timeout) {
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
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}


async function waitForChart(client) {
  await evaluate(client, `new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const root = document.querySelector('[data-duren-season-comparison]');
      if (root?.durenSeasonComparison?.rows.length === 6 && root.querySelectorAll('svg').length === 4) resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('Duren chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}


async function captureElement(client, output) {
  const clip = await evaluate(client, `(() => {
    const element = document.querySelector('[data-duren-season-comparison]');
    const rect = element.getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
    clip,
  });
  await writeFile(path.join(ARTIFACTS, output), Buffer.from(result.data, "base64"));
}


async function run() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "duren-chart-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
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
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: URL });
    await loaded;
    await waitForChart(client);

    const desktop = await evaluate(client, `(() => {
      const root = document.querySelector('[data-duren-season-comparison]');
      const chart = root.durenSeasonComparison;
      const keyFor = (row) => row.season + '|' + row.seasonType;
      const coordinateErrors = [];
      const labelErrors = [];
      root.querySelectorAll('.duren-comparison__panel').forEach((panel, panelIndex) => {
        const state = chart.panelStates[panelIndex];
        panel.querySelectorAll('.duren-comparison__mark').forEach((mark) => {
          const row = chart.plottedRows.find((candidate) => keyFor(candidate) === mark.dataset.key);
          const match = mark.getAttribute('transform').match(/translate\\(([-0-9.]+),([-0-9.]+)\\)/);
          const actual = match ? [Number(match[1]), Number(match[2])] : [NaN, NaN];
          const expected = [state.x(row[state.metric.key]), state.y(row.season)];
          if (!actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) < 0.01)) {
            coordinateErrors.push([state.metric.key, mark.dataset.key, actual, expected]);
          }
        });
        panel.querySelectorAll('.duren-comparison__connector').forEach((connector, seasonIndex) => {
          const season = ['2024-25', '2025-26'][seasonIndex];
          const regular = chart.plottedRows.find((row) => row.season === season && row.seasonType === 'regular_season');
          const playoffs = chart.plottedRows.find((row) => row.season === season && row.seasonType === 'playoffs');
          const actual = ['x1', 'x2', 'y1', 'y2'].map((attribute) => Number(connector.getAttribute(attribute)));
          const expected = [state.x(regular[state.metric.key]), state.x(playoffs[state.metric.key]), state.y(season), state.y(season)];
          if (actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) >= 0.01)) {
            coordinateErrors.push([state.metric.key, season, 'connector', actual, expected]);
          }
        });
        panel.querySelectorAll('.duren-comparison__value').forEach((label, rowIndex) => {
          const row = chart.plottedRows[rowIndex];
          const raw = row[state.metric.key];
          const expected = state.metric.key === 'trueShooting' ? (raw * 100).toFixed(1) + '%'
            : ['totalReboundPct', 'turnoverPct'].includes(state.metric.key) ? raw.toFixed(1) + '%'
            : raw.toFixed(1);
          if (label.textContent !== expected) labelErrors.push([state.metric.key, keyFor(row), label.textContent, expected]);
        });
      });
      const formatters = [
        (row) => row.season.replace('-', '–'),
        (row) => row.seasonType === 'regular_season' ? 'Regular season' : 'Playoffs',
        (row) => String(row.games),
        (row) => row.totalMinutes.toLocaleString('en-US'),
        (row) => row.minutesPerGame.toFixed(1),
        (row) => row.usage.toFixed(1) + '%',
        (row) => row.pointsPer100.toFixed(1),
        (row) => (row.trueShooting * 100).toFixed(1) + '%',
        (row) => row.totalReboundPct.toFixed(1) + '%',
        (row) => row.turnoverPct.toFixed(1) + '%',
      ];
      const tableErrors = [];
      root.querySelectorAll('.duren-comparison__table-row').forEach((tableRow, rowIndex) => {
        const row = chart.plottedRows[rowIndex];
        [...tableRow.children].forEach((cell, columnIndex) => {
          const expected = formatters[columnIndex](row);
          if (cell.textContent.trim() !== expected) tableErrors.push([keyFor(row), columnIndex, cell.textContent.trim(), expected]);
        });
      });
      const intro = root.parentElement.querySelector('.story--pistons-intro');
      const continuation = root.parentElement.querySelector('.story--pistons-continuation');
      const style = getComputedStyle(root);
      return {
        busy: root.getAttribute('aria-busy'),
        rows: chart.rows.length,
        plotted: chart.plottedRows.length,
        panels: root.querySelectorAll('.duren-comparison__panel').length,
        svgs: root.querySelectorAll('svg').length,
        connectors: root.querySelectorAll('.duren-comparison__connector').length,
        marks: root.querySelectorAll('.duren-comparison__mark').length,
        labels: root.querySelectorAll('.duren-comparison__value').length,
        hits: root.querySelectorAll('.duren-comparison__hit').length,
        tableRows: root.querySelectorAll('.duren-comparison__table-row').length,
        sampleText: root.querySelector('.duren-comparison__samples').textContent.replace(/\\s+/g, ' ').trim(),
        noteText: root.querySelector('.duren-comparison__notes').textContent.replace(/\\s+/g, ' ').trim(),
        domains: chart.panelStates.map((state) => state.x.domain()),
        coordinateErrors,
        labelErrors,
        tableErrors,
        identity: style.getPropertyValue('--team-identity').trim(),
        secondary: style.getPropertyValue('--team-secondary').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
        story: {
          introCount: intro?.querySelectorAll(':scope > p').length,
          continuationCount: continuation?.querySelectorAll(':scope > p').length,
          chartFollowsIntro: intro?.nextElementSibling === root,
          continuationFollowsChart: root.nextElementSibling === continuation,
          leadIn: intro?.lastElementChild?.textContent.startsWith('But much of the goodwill') || false,
          leadOut: continuation?.firstElementChild?.textContent.startsWith('The agreement settles') || false,
        },
      };
    })()`);
    assert(desktop.busy === "false" && desktop.rows === 6 && desktop.plotted === 4, "Normalized or plotted row counts were incorrect.");
    assert(desktop.panels === 4 && desktop.svgs === 4, "The 2x2 chart did not render four panels.");
    assert(desktop.connectors === 8 && desktop.marks === 16 && desktop.labels === 16 && desktop.hits === 16, "Paired marks, connectors, labels, or interaction targets were incomplete.");
    assert(desktop.tableRows === 4 && desktop.tableErrors.length === 0, `Rendered table cells disagreed with normalized values: ${JSON.stringify(desktop.tableErrors)}`);
    assert(desktop.coordinateErrors.length === 0, `Plotted coordinates disagreed with normalized values: ${JSON.stringify(desktop.coordinateErrors)}`);
    assert(desktop.labelErrors.length === 0, `Direct labels disagreed with normalized values: ${JSON.stringify(desktop.labelErrors)}`);
    assert(JSON.stringify(desktop.domains) === JSON.stringify([[0, 36], [0.5, 0.74], [15, 23], [10, 21]]), "Metric domains changed unexpectedly.");
    ["78 games", "6 games", "70 games", "14 games"].forEach((value) => assert(desktop.sampleText.includes(value), `Visible samples omitted ${value}.`));
    ["per 100 individual scoring possessions", "whole-postseason totals", "2024–25 playoff TS% held up"].forEach((value) => assert(desktop.noteText.includes(value), `Methodology omitted ${value}.`));
    assert(desktop.identity.toLowerCase() === "#c8102e" && desktop.secondary.toLowerCase() === "#1d42ba" && desktop.surface.toLowerCase() === "#f8e2e6", "Detroit theme tokens were not inherited.");
    assert(desktop.story.introCount === 5 && desktop.story.continuationCount === 5, "Detroit story did not contain the requested 10 paragraphs.");
    assert(desktop.story.chartFollowsIntro && desktop.story.continuationFollowsChart && desktop.story.leadIn && desktop.story.leadOut, "Chart placement did not follow the requested Duren paragraph.");
    await captureElement(client, "duren-season-comparison-desktop.png");

    const interaction = await evaluate(client, `(async () => {
      const root = document.querySelector('[data-duren-season-comparison]');
      const regular = root.querySelector('.duren-comparison__hit[data-key="2024-25|regular_season"]');
      regular.focus();
      regular.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const keyboardTitle = root.querySelector('.duren-comparison__inspection-title').textContent;
      const playoffs = root.querySelector('.duren-comparison__hit[data-key="2025-26|playoffs"]');
      playoffs.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      const touchTitle = root.querySelector('.duren-comparison__inspection-title').textContent;
      const inspection = root.querySelector('.duren-comparison__inspection-values').textContent.replace(/\\s+/g, ' ').trim();
      const card = root.closest('details');
      card.open = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
      card.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        keyboardTitle,
        touchTitle,
        inspection,
        svgsAfterReopen: root.querySelectorAll('svg').length,
        rootsAfterReopen: document.querySelectorAll('[data-duren-season-comparison]').length,
        initialized: root.dataset.durenInitialized,
      };
    })()`);
    assert(interaction.keyboardTitle === "2024–25 · Regular season", "Keyboard selection did not update inspection.");
    assert(interaction.touchTitle === "2025–26 · Playoffs", "Touch selection did not update inspection.");
    ["14 G · 422 MP", "30.1", "16.7%", "17.3", "55.3%", "16.1%", "19.8%"].forEach((value) => assert(interaction.inspection.includes(value), `Inspection omitted ${value}.`));
    assert(interaction.svgsAfterReopen === 4 && interaction.rootsAfterReopen === 1 && interaction.initialized === "true", "Reopening duplicated chart elements or handlers.");

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(client, `new Promise((resolve) => {
      window.dispatchEvent(new Event('resize'));
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 160);
    })`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-duren-season-comparison]');
      const plot = root.querySelector('.duren-comparison__plot');
      const panel = root.querySelector('.duren-comparison__panel');
      const firstHit = root.querySelector('.duren-comparison__hit');
      firstHit.focus();
      return {
        columns: getComputedStyle(plot).gridTemplateColumns,
        panelWidth: panel.getBoundingClientRect().width,
        plotWidth: plot.getBoundingClientRect().width,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        tableRows: root.querySelectorAll('.duren-comparison__table-row').length,
        samplesVisible: root.querySelector('.duren-comparison__samples').getBoundingClientRect().height > 0,
        hitFocused: document.activeElement === firstHit,
        hitRole: firstHit.getAttribute('role'),
        hitTabIndex: firstHit.tabIndex,
      };
    })()`);
    assert(!mobile.columns.includes(" ") && mobile.panelWidth <= mobile.plotWidth, "Panels did not stack at 390px.");
    assert(mobile.pageWidth <= mobile.viewportWidth, `Mobile page overflowed horizontally (${mobile.pageWidth} > ${mobile.viewportWidth}).`);
    assert(mobile.tableRows === 4 && mobile.samplesVisible, "Mobile table or visible sample information was missing.");
    assert(mobile.hitFocused && mobile.hitRole === "button" && mobile.hitTabIndex === 0, "Mobile chart target was not keyboard focusable.");
    await captureElement(client, "duren-season-comparison-mobile.png");

    await client.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    assert(await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`), "Reduced-motion mode was not supported.");
    assert(browserErrors.length === 0, `Browser console/runtime errors: ${browserErrors.join(" | ")}`);

    console.log("PASS: six normalized rows and four plotted observations; exact table values and coordinates.");
    console.log("PASS: four paired-dot panels, explicit domains, direct labels, samples, and Detroit theme tokens.");
    console.log("PASS: requested 5-paragraph lead-in, chart placement, and 5-paragraph continuation.");
    console.log("PASS: keyboard/touch inspection, collapse/reopen, resize, 390px stacking, no overflow, and reduced motion.");
    console.log("PASS: no browser console or runtime errors.");
    console.log("Wrote artifacts/duren-season-comparison-desktop.png and artifacts/duren-season-comparison-mobile.png");
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
