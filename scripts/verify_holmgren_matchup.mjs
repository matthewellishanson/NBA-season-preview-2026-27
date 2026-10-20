import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-thunder";
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
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${this.url}`)), 10000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", async (event) => {
      const payload = typeof event.data === "string"
        ? event.data
        : typeof event.data?.text === "function"
          ? await event.data.text()
          : Buffer.from(event.data).toString("utf8");
      const message = JSON.parse(payload);
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
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
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
      const root = document.querySelector('[data-holmgren-shared-games-chart]');
      if (root?.holmgrenSharedGamesChart?.rows.length === 3 && root.querySelectorAll('svg').length === 3) resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('Holmgren chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}


async function captureElement(client, filename) {
  const clip = await evaluate(client, `(() => {
    const rect = document.querySelector('[data-holmgren-shared-games-chart]').getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip });
  await mkdir(ARTIFACTS, { recursive: true });
  await writeFile(path.join(ARTIFACTS, filename), Buffer.from(result.data, "base64"));
}


async function run() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "holmgren-chart-chrome-"));
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
      client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }),
    ]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: URL });
    await loaded;
    await waitForChart(client);

    const desktop = await evaluate(client, `(() => {
      const root = document.querySelector('[data-holmgren-shared-games-chart]');
      const card = root.closest('details');
      const intro = root.previousElementSibling;
      const continuation = root.nextElementSibling;
      const style = getComputedStyle(root);
      return {
        busy: root.getAttribute('aria-busy'),
        rows: root.holmgrenSharedGamesChart.rows.length,
        panels: root.querySelectorAll('.holmgren-chart__panel').length,
        svgs: root.querySelectorAll('svg').length,
        values: [...root.querySelectorAll('.holmgren-chart__value')].map((node) => node.textContent),
        marks: root.querySelectorAll('.holmgren-chart__mark').length,
        focusRows: [...root.querySelectorAll('.holmgren-chart__row')].map((node) => ({ tab: node.getAttribute('tabindex'), role: node.getAttribute('role'), label: node.getAttribute('aria-label') })),
        samples: [...root.querySelectorAll('.holmgren-chart__sample')].map((node) => node.textContent.replace(/\\s+/g, ' ').trim()),
        limits: root.querySelector('.holmgren-chart__limits').textContent.replace(/\\s+/g, ' ').trim(),
        takeaway: root.querySelector('.holmgren-chart__takeaway').textContent.replace(/\\s+/g, ' ').trim(),
        table: [...root.querySelectorAll('.holmgren-chart__table-row')].map((row) => [...row.children].map((cell) => cell.textContent.trim())),
        story: {
          paragraphs: [...intro.querySelectorAll(':scope > p'), ...continuation.querySelectorAll(':scope > p')].map((node) => node.textContent),
          introClass: intro.className,
          continuationClass: continuation.className,
          chartBetween: intro.nextElementSibling === root && root.nextElementSibling === continuation,
          placeholderCount: card.querySelectorAll('.graphic, .watch').length,
          placeholders: [...card.querySelectorAll('.graphic, .watch')].map((node) => node.className),
          articleLink: intro.querySelector('a')?.textContent,
        },
        columns: getComputedStyle(root.querySelector('.holmgren-chart__plot')).gridTemplateColumns,
        identity: style.getPropertyValue('--team-identity').trim(),
        secondary: style.getPropertyValue('--team-secondary').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
      };
    })()`);

    assert(desktop.busy === "false" && desktop.rows === 3, "Normalized row count or loading state was incorrect.");
    assert(desktop.panels === 3 && desktop.svgs === 3 && desktop.marks === 9, "Metric panels or marks were incomplete.");
    assert(JSON.stringify(desktop.values) === JSON.stringify(["21.3", "17.0", "12.9", "11.1", "9.2", "8.6", "65.3%", "61.0%", "59.9%"]), `Direct labels disagreed: ${JSON.stringify(desktop.values)}`);
    assert(desktop.focusRows.length === 9 && desktop.focusRows.every((row) => row.tab === "0" && row.role === "img" && row.label.includes("games") && row.label.includes("minutes per game")), "Keyboard-accessible mark descriptions were incomplete.");
    assert(desktop.samples[0].includes("69 games · ≈1,994 minutes · 28.9 MPG"), `Full-season sample label was incomplete: ${desktop.samples[0]}`);
    assert(desktop.samples[1].includes("8 games · ≈234 minutes · 29.3 MPG") && desktop.samples[1].includes("seasons unspecified"), `Shared regular-season sample label was incomplete: ${desktop.samples[1]}`);
    assert(desktop.samples[2].includes("7 games · ≈209 minutes · 29.9 MPG") && desktop.samples[2].includes("no other-opponents baseline"), `Postseason sample label was incomplete: ${desktop.samples[2]}`);
    assert(desktop.limits.includes("same-season test is unavailable") && desktop.limits.includes("unspecified seasons"), "The persistent coverage limitation was incomplete.");
    assert(desktop.takeaway.includes("do not establish that his production declined against Wembanyama during 2025–26"), "The evidence-qualified takeaway was missing.");
    const expectedTable = [
      ["2025–26 full regular season", "2025-26", "69", "≈1994.1", "28.9", "21.3", "11.1", "65.3%"],
      ["Shared regular-season games", "Career aggregate; seasons unspecified", "8", "≈234.4", "29.3", "17.0", "9.2", "61.0%"],
      ["Shared postseason games", "Supplied aggregate; season unspecified", "7", "≈209.3", "29.9", "12.9", "8.6", "59.9%"],
    ];
    assert(JSON.stringify(desktop.table) === JSON.stringify(expectedTable), `Accessible table disagreed: ${JSON.stringify(desktop.table)}`);
    assert(desktop.story.paragraphs.length === 7 && desktop.story.introClass.includes("story--thunder-intro") && desktop.story.continuationClass.includes("story--thunder-continuation") && desktop.story.chartBetween, "Thunder story paragraph count or chart placement was incorrect.");
    assert(desktop.story.paragraphs[0].startsWith("What is there to say about this Thunder team") && desktop.story.paragraphs[6].startsWith("If this Thunder team is going to get back to the Finals"), "The supplied Thunder story endpoints were not preserved.");
    assert(desktop.story.articleLink === "flirted with historic levels of dominance" && desktop.story.placeholderCount === 0, `Thunder link text or placeholder removal was incorrect: ${JSON.stringify(desktop.story)}`);
    assert(desktop.columns.split(" ").length === 3, "Desktop metric panels did not form three columns.");
    assert(desktop.identity.toLowerCase() === "#007ac1" && desktop.secondary.toLowerCase() === "#ef3b24" && desktop.surface.toLowerCase() === "#e0eff8", "Thunder theme tokens were not inherited.");
    await captureElement(client, "holmgren-shared-games-desktop.png");

    const reopen = await evaluate(client, `(async () => {
      const root = document.querySelector('[data-holmgren-shared-games-chart]');
      const card = root.closest('details');
      card.open = false;
      await new Promise((resolve) => setTimeout(resolve, 80));
      card.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { svgs: root.querySelectorAll('svg').length, roots: document.querySelectorAll('[data-holmgren-shared-games-chart]').length, initialized: root.dataset.holmgrenInitialized };
    })()`);
    assert(reopen.svgs === 3 && reopen.roots === 1 && reopen.initialized === "true", "Collapse/reopen duplicated the chart or initialization.");

    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(client, `new Promise((resolve) => { window.dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 220); })`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-holmgren-shared-games-chart]');
      const firstRow = root.querySelector('.holmgren-chart__row');
      firstRow.focus();
      return {
        plotColumns: getComputedStyle(root.querySelector('.holmgren-chart__plot')).gridTemplateColumns,
        sampleColumns: getComputedStyle(root.querySelector('.holmgren-chart__samples')).gridTemplateColumns,
        panelWidth: root.querySelector('.holmgren-chart__panel').getBoundingClientRect().width,
        plotWidth: root.querySelector('.holmgren-chart__plot').getBoundingClientRect().width,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        tableRows: root.querySelectorAll('.holmgren-chart__table-row').length,
        labels: root.querySelectorAll('.holmgren-chart__value').length,
        focused: document.activeElement === firstRow,
      };
    })()`);
    assert(!mobile.plotColumns.includes(" ") && !mobile.sampleColumns.includes(" "), "Mobile panels or sample cards did not stack.");
    assert(mobile.panelWidth <= mobile.plotWidth && mobile.pageWidth <= mobile.viewportWidth, `Mobile layout overflowed (${mobile.pageWidth} > ${mobile.viewportWidth}).`);
    assert(mobile.tableRows === 3 && mobile.labels === 9 && mobile.focused, "Mobile values, table or keyboard target were incomplete.");
    await captureElement(client, "holmgren-shared-games-mobile.png");

    await client.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert(await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`), "Reduced-motion mode was not recognized.");
    assert(browserErrors.length === 0, `Browser console/runtime errors: ${browserErrors.join(" | ")}`);

    console.log("PASS: three validated samples, reconstructed denominators and nine direct metric labels.");
    console.log("PASS: explicit incompatible-window limitation, accessible table and non-causal shared-game language.");
    console.log("PASS: supplied seven-paragraph Thunder story and chart placement beside the Holmgren discussion.");
    console.log("PASS: Thunder palette, collapse/reopen, keyboard access, 390px stacking and no overflow.");
    console.log("Wrote artifacts/holmgren-shared-games-desktop.png and artifacts/holmgren-shared-games-mobile.png");
  } finally {
    if (client) client.close();
    chrome.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await rm(profile, { recursive: true, force: true });
  }
}


await run().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
