import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-celtics";
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
      const callbacks = this.listeners.get(message.method) || [];
      callbacks.forEach((callback) => callback(message.params));
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
        const callbacks = this.listeners.get(method) || [];
        this.listeners.set(method, callbacks.filter((item) => item !== callback));
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
      const root = document.querySelector('[data-celtics-wing-chart]');
      if (root?.celticsWingChart?.rows.length === 15 && root.querySelectorAll('svg').length === 3) resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('Celtics chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}


async function captureElement(client, output) {
  const clip = await evaluate(client, `(() => {
    const element = document.querySelector('[data-celtics-wing-chart]');
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
  const profile = await mkdtemp(path.join(os.tmpdir(), "celtics-chart-chrome-"));
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

    const initial = await evaluate(client, `(() => {
      const root = document.querySelector('[data-celtics-wing-chart]');
      const chart = root.celticsWingChart;
      const pointCoordinateErrors = [];
      chart.panelStates.forEach((state) => state.allPoints.forEach((selection) => selection.each(function(row) {
        const match = this.getAttribute('transform').match(/translate\\(([-0-9.]+),([-0-9.]+)\\)/);
        const actual = match ? [Number(match[1]), Number(match[2])] : [NaN, NaN];
        const expected = [state.x(row.season), state.y(row[state.metric.key])];
        if (!actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) < 0.01)) {
          pointCoordinateErrors.push([row.playerId, row.season, state.metric.key, actual, expected]);
        }
      })));
      const domains = Object.fromEntries(chart.panelStates.map((state) => [state.metric.key, state.y.domain()]));
      const tableFormatters = [
        (row) => row.season, (row) => row.team, (row) => String(row.age), (row) => String(row.games),
        (row) => String(row.starts), (row) => row.minutesPerGame.toFixed(1), (row) => row.totalMinutes.toLocaleString('en-US'),
        (row) => row.pointsPerGame.toFixed(1), (row) => row.reboundsPerGame.toFixed(1), (row) => row.assistsPerGame.toFixed(1),
        (row) => row.pointsPer100.toFixed(1), (row) => row.reboundsPer100.toFixed(1), (row) => row.assistsPer100.toFixed(1),
        (row) => row.turnoversPer100.toFixed(1), (row) => (row.trueShooting * 100).toFixed(1) + '%',
        (row) => (row.effectiveFieldGoalPct * 100).toFixed(1) + '%', (row) => row.usage.toFixed(1) + '%',
        (row) => row.assistPct.toFixed(1) + '%', (row) => row.turnoverPct.toFixed(1) + '%',
      ];
      const tableValueErrors = [];
      [...root.querySelectorAll('.celtics-wings__table-data-row')].forEach((tableRow, rowIndex) => {
        const row = chart.rows[rowIndex];
        [...tableRow.children].forEach((cell, columnIndex) => {
          const expected = tableFormatters[columnIndex](row);
          if (cell.textContent.trim() !== expected) tableValueErrors.push([row.playerId, row.season, columnIndex, cell.textContent.trim(), expected]);
        });
      });
      const lineCoordinateErrors = [];
      chart.panelStates.forEach((state, panelIndex) => {
        const lineNodes = root.querySelectorAll('.celtics-wings__panel')[panelIndex].querySelectorAll('.celtics-wings__line');
        lineNodes.forEach((lineNode, playerIndex) => {
          const numbers = (lineNode.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number);
          const expected = chart.rowsByPlayer.get(['jaylen_brown', 'jayson_tatum', 'paul_george'][playerIndex]).flatMap((row) => [state.x(row.season), state.y(row[state.metric.key])]);
          if (numbers.length !== expected.length || numbers.some((value, index) => Math.abs(value - expected[index]) >= 0.01)) {
            lineCoordinateErrors.push([state.metric.key, playerIndex, numbers, expected]);
          }
        });
      });
      const context = root.querySelector('.celtics-wings__context').textContent.replace(/\\s+/g, ' ').trim();
      const inspection = root.querySelector('.celtics-wings__inspection-values').textContent.replace(/\\s+/g, ' ').trim();
      const intro = root.parentElement.querySelector('.story--celtics-intro');
      const continuation = root.parentElement.querySelector('.story--celtics-continuation');
      const introParagraphs = [...(intro?.querySelectorAll(':scope > p') || [])];
      const continuationParagraphs = [...(continuation?.querySelectorAll(':scope > p') || [])];
      const style = getComputedStyle(root);
      return {
        busy: root.getAttribute('aria-busy'),
        view: root.dataset.activeView,
        panels: root.querySelectorAll('.celtics-wings__panel').length,
        svgs: root.querySelectorAll('svg').length,
        lines: root.querySelectorAll('.celtics-wings__line').length,
        points: root.querySelectorAll('.celtics-wings__point').length,
        shortSamples: root.querySelectorAll('.celtics-wings__short-sample').length,
        tableRows: root.querySelectorAll('.celtics-wings__table-data-row').length,
        inspectionTitle: root.querySelector('.celtics-wings__inspection-heading h4').textContent,
        inspection,
        context,
        pointCoordinateErrors,
        lineCoordinateErrors,
        tableValueErrors,
        domains,
        identity: style.getPropertyValue('--team-identity').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
        selectedButtons: root.querySelectorAll('[data-celtics-view][aria-pressed="true"]').length,
        storyPlacement: {
          introParagraphs: introParagraphs.length,
          continuationParagraphs: continuationParagraphs.length,
          chartFollowsIntro: intro?.nextElementSibling === root,
          continuationFollowsChart: root.nextElementSibling === continuation,
          paulGeorgeLeadIn: introParagraphs.at(-1)?.textContent.includes('Paul George, the veteran star wing') || false,
          responsibilityLeadOut: continuationParagraphs[0]?.textContent.startsWith('That responsibility will fall') || false,
        },
      };
    })()`);
    assert(initial.busy === "false", "Chart remained aria-busy after load.");
    assert(initial.view === "availability" && initial.panels === 3 && initial.svgs === 3, "Default availability view was not three panels.");
    assert(initial.lines === 9 && initial.points === 45 && initial.shortSamples === 3, "Availability mark counts were incorrect.");
    assert(initial.tableRows === 15, "Accessible table did not contain 15 data rows.");
    assert(initial.inspectionTitle === "2025–26", "Inspection did not default to 2025-26.");
    ["71 games", "34.4 MPG", "16 games", "522 minutes", "37 games", "30.7 MPG"].forEach((value) => assert(initial.inspection.includes(value), `Inspection was missing ${value}.`));
    ["16 games · 522 minutes", "last full season before the Achilles injury", "PHI beginning in 2024–25", "7.3-percentage-point"].forEach((value) => assert(initial.context.includes(value), `Context was missing ${value}.`));
    assert(initial.pointCoordinateErrors.length === 0, `Plotted point coordinates disagreed with the normalized values: ${JSON.stringify(initial.pointCoordinateErrors)}`);
    assert(initial.lineCoordinateErrors.length === 0, `Plotted line coordinates disagreed with the normalized values: ${JSON.stringify(initial.lineCoordinateErrors)}`);
    assert(initial.tableValueErrors.length === 0, `Rendered table cells disagreed with the normalized values: ${JSON.stringify(initial.tableValueErrors)}`);
    assert(initial.domains.games[0] === 0 && initial.domains.games[1] === 82, "Games domain was not exactly 0-82.");
    assert(initial.identity.toLowerCase() === "#007a33" && initial.surface.toLowerCase() === "#e0efe7", "Celtics theme tokens were not inherited.");
    assert(initial.selectedButtons === 1, "View controls did not expose exactly one selected state.");
    assert(initial.storyPlacement.introParagraphs === 6 && initial.storyPlacement.continuationParagraphs === 5, "Celtics story did not contain the expected 11 paragraphs.");
    assert(initial.storyPlacement.chartFollowsIntro && initial.storyPlacement.continuationFollowsChart, "Celtics chart was not placed between the intended story paragraphs.");
    assert(initial.storyPlacement.paulGeorgeLeadIn && initial.storyPlacement.responsibilityLeadOut, "Celtics chart did not follow the Paul George paragraph at the intended narrative break.");
    await captureElement(client, "celtics-wings-desktop.png");

    const interaction = await evaluate(client, `(async () => {
      const root = document.querySelector('[data-celtics-wing-chart]');
      root.querySelector('[data-celtics-view="offense"]').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const offense = {
        view: root.dataset.activeView,
        panels: root.querySelectorAll('.celtics-wings__panel').length,
        lines: root.querySelectorAll('.celtics-wings__line').length,
        points: root.querySelectorAll('.celtics-wings__point').length,
        shortSamples: root.querySelectorAll('.celtics-wings__short-sample').length,
        domains: Object.fromEntries(root.celticsWingChart.panelStates.map((state) => [state.metric.key, state.y.domain()])),
        inspection: root.querySelector('.celtics-wings__inspection-values').textContent.replace(/\\s+/g, ' ').trim(),
        coordinateErrors: root.celticsWingChart.panelStates.flatMap((state) => state.allPoints.flatMap((selection) => {
          const errors = [];
          selection.each(function(row) {
            const match = this.getAttribute('transform').match(/translate\\(([-0-9.]+),([-0-9.]+)\\)/);
            const actual = match ? [Number(match[1]), Number(match[2])] : [NaN, NaN];
            const expected = [state.x(row.season), state.y(row[state.metric.key])];
            if (!actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) < 0.01)) errors.push([row.playerId, row.season, state.metric.key, actual, expected]);
          });
          return errors;
        })),
        lineCoordinateErrors: root.celticsWingChart.panelStates.flatMap((state, panelIndex) => {
          const errors = [];
          const lineNodes = root.querySelectorAll('.celtics-wings__panel')[panelIndex].querySelectorAll('.celtics-wings__line');
          lineNodes.forEach((lineNode, playerIndex) => {
            const numbers = (lineNode.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number);
            const expected = root.celticsWingChart.rowsByPlayer.get(['jaylen_brown', 'jayson_tatum', 'paul_george'][playerIndex]).flatMap((row) => [state.x(row.season), state.y(row[state.metric.key])]);
            if (numbers.length !== expected.length || numbers.some((value, index) => Math.abs(value - expected[index]) >= 0.01)) errors.push([state.metric.key, playerIndex, numbers, expected]);
          });
          return errors;
        }),
      };
      const latestHit = root.querySelector('.celtics-wings__panel .celtics-wings__season-hit[data-season="2025-26"]');
      latestHit.focus();
      latestHit.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const keyboardSeason = root.querySelector('.celtics-wings__inspection-heading h4').textContent;
      const touchHit = root.querySelector('.celtics-wings__panel .celtics-wings__season-hit[data-season="2023-24"]');
      touchHit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      const touchSeason = root.querySelector('.celtics-wings__inspection-heading h4').textContent;
      const card = root.closest('details');
      card.open = false;
      await new Promise((resolve) => setTimeout(resolve, 40));
      card.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        ...offense,
        keyboardSeason,
        touchSeason,
        svgAfterReopen: root.querySelectorAll('svg').length,
        rootsAfterReopen: document.querySelectorAll('[data-celtics-wing-chart]').length,
      };
    })()`);
    assert(interaction.view === "offense" && interaction.panels === 4, "Offensive view was not four panels.");
    assert(interaction.lines === 12 && interaction.points === 60 && interaction.shortSamples === 4, "Offensive mark counts were incorrect.");
    assert(interaction.coordinateErrors.length === 0, `Offensive point coordinates disagreed with the normalized values: ${JSON.stringify(interaction.coordinateErrors)}`);
    assert(interaction.lineCoordinateErrors.length === 0, `Offensive line coordinates disagreed with the normalized values: ${JSON.stringify(interaction.lineCoordinateErrors)}`);
    assert(interaction.domains.pointsPer100[0] === 0 && interaction.domains.assistsPer100[0] === 0, "Per-100 domains were not zero-based.");
    ["42.2 PTS/100", "7.5 AST/100", "57.3% TS", "36.2% USG", "33.7 PTS/100", "8.2 AST/100", "54.1% TS", "30.0% USG", "27.3 PTS/100", "5.7 AST/100", "57.0% TS", "23.3% USG"].forEach((value) => assert(interaction.inspection.includes(value), `Offensive inspection was missing ${value}.`));
    assert(interaction.keyboardSeason === "2024–25", "Keyboard arrow selection did not update the linked inspection.");
    assert(interaction.touchSeason === "2023–24", "Touch pointer selection did not update the linked inspection.");
    assert(interaction.svgAfterReopen === 4 && interaction.rootsAfterReopen === 1, "Card reopening duplicated chart SVGs or roots.");

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(client, `(async () => {
      const root = document.querySelector('[data-celtics-wing-chart]');
      root.querySelector('[data-celtics-view="availability"]').click();
      root.celticsWingChart.selectSeason('2025-26');
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 120));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-celtics-wing-chart]');
      const panelWidth = root.querySelector('.celtics-wings__panel').getBoundingClientRect().width;
      const panelContainerWidth = root.querySelector('.celtics-wings__panels').getBoundingClientRect().width;
      return {
        panels: root.querySelectorAll('.celtics-wings__panel').length,
        gridColumns: getComputedStyle(root.querySelector('.celtics-wings__panels')).gridTemplateColumns,
        panelWidth,
        panelContainerWidth,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        title: root.querySelector('.celtics-wings__inspection-heading h4').textContent,
        shortSampleVisible: root.querySelector('.celtics-wings__sample-callout').getBoundingClientRect().height > 0,
        shortMarkers: root.querySelectorAll('.celtics-wings__short-sample').length,
      };
    })()`);
    assert(mobile.panels === 3 && Math.abs(mobile.panelWidth - mobile.panelContainerWidth) < 2, "Mobile panels did not stack to one column.");
    assert(mobile.pageWidth <= mobile.viewportWidth, `Mobile page overflowed horizontally (${mobile.pageWidth} > ${mobile.viewportWidth}).`);
    assert(mobile.title === "2025–26" && mobile.shortSampleVisible && mobile.shortMarkers === 3, "Tatum's mobile short-sample treatment was not persistently visible.");
    await captureElement(client, "celtics-wings-mobile.png");
    const expandedMobileTable = await evaluate(client, `(() => {
      const root = document.querySelector('[data-celtics-wing-chart]');
      root.querySelector('.celtics-wings__table-details').open = true;
      const firstHit = root.querySelector('.celtics-wings__season-hit');
      firstHit.focus();
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        tableRows: root.querySelectorAll('.celtics-wings__table-data-row').length,
        hitIsFocused: document.activeElement === firstHit,
        hitTabIndex: firstHit.tabIndex,
        hitRole: firstHit.getAttribute('role'),
      };
    })()`);
    assert(expandedMobileTable.pageWidth <= expandedMobileTable.viewportWidth, "Expanded mobile table caused horizontal page overflow.");
    assert(expandedMobileTable.tableRows === 15 && expandedMobileTable.hitIsFocused && expandedMobileTable.hitTabIndex === 0 && expandedMobileTable.hitRole === "button", "Expanded table or chart keyboard target failed its mobile check.");

    await client.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const reducedMotion = await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`);
    assert(reducedMotion, "Reduced-motion media mode was not supported.");
    assert(browserErrors.length === 0, `Browser console/runtime errors: ${browserErrors.join(" | ")}`);

    console.log("PASS: 15 table rows; 3 availability panels; 4 offensive panels; all plotted coordinates matched normalized data.");
    console.log("PASS: supplied annotations/inspection values, 0-82 games domain, zero-based per-100 domains, and Celtics theme tokens.");
    console.log("PASS: Celtics story is 6 paragraphs, then the chart after the Paul George paragraph, then 5 paragraphs.");
    console.log("PASS: keyboard and touch selection, view switching, collapse/reopen, resize, 390px stacking, no page overflow, and reduced motion.");
    console.log("PASS: no browser console or runtime errors.");
    console.log("Wrote artifacts/celtics-wings-desktop.png and artifacts/celtics-wings-mobile.png");
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
