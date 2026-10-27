import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/artifacts/nets-rookie-fixture.html";
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
    this.socket.addEventListener("message", async (event) => {
      const payload = typeof event.data === "string" ? event.data : await event.data.text();
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
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const callback = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== callback));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), callback]);
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
      const root = document.querySelector('[data-nets-rookie-chart]');
      if (root?.netsRookieComparison?.players.length === 5 && root.getAttribute('aria-busy') === 'false') resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('Nets chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}


async function captureElement(client, output) {
  const clip = await evaluate(client, `(() => {
    const element = document.querySelector('[data-nets-rookie-chart]');
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
  const production = await readFile(path.join(ROOT, "2026-27-team-previews.html"), "utf8");
  assert(/name: "Brooklyn Nets",[\s\S]{0,220}?status: "outline"/.test(production), "Brooklyn publication status changed.");
  assert(production.includes("story--nets-intro") && production.includes("story--nets-continuation"), "Production template is missing the Nets story split.");
  assert(production.includes("median of 138 qualified rookie player-seasons") && production.includes("48 of those seasons"), "Integrated benchmark labels are incomplete.");

  await mkdir(ARTIFACTS, { recursive: true });
  const intro = production.match(/<article class="story story--nets story--nets-intro">[\s\S]*?<\/article>/)?.[0];
  const figure = production.match(/<figure\s+class="team-graphic nets-rookies"[\s\S]*?<\/figure>/)?.[0];
  const continuation = production.match(/<article class="story story--nets story--nets-continuation">[\s\S]*?<\/article>/)?.[0];
  assert(intro && figure && continuation, "Could not extract the integrated Nets story and chart markup.");
  const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="../assets/css/team-color-policy.css"><link rel="stylesheet" href="../assets/css/nets-rookie-comparison.css">
    <style>*{box-sizing:border-box}body{margin:0;background:#f7f7fa;color:#20212b;font:16px/1.6 system-ui,sans-serif}.team-card{display:block;max-width:1120px;margin:20px auto}.story-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:22px}.story p{max-width:760px;margin:0 auto 1em}@media(max-width:560px){.team-card{margin:0;padding:6px}.story p{font-size:15px}}</style>
    </head><body><details class="team-card" data-team-theme="BKN" open><div class="story-layout story-layout--nets">${intro}${figure.replaceAll('assets/', '../assets/')}${continuation}</div></details>
    <script src="../assets/vendor/d3/d3.v7.9.0.min.js"></script><script src="../assets/js/nets-rookie-comparison.js"></script></body></html>`;
  await writeFile(path.join(ARTIFACTS, "nets-rookie-fixture.html"), fixture, "utf8");
  const profile = await mkdtemp(path.join(os.tmpdir(), "nets-rookies-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--in-process-gpu",
    "--use-angle=swiftshader",
    "--use-gl=angle",
    "--disable-gpu-sandbox",
    "--disable-gpu-shader-disk-cache",
    "--disable-features=Vulkan,SkiaGraphite",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let client;
  const chartErrors = [];

  try {
    const activePortFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(activePortFile);
    console.log("Chrome debugging port is ready.");
    const [port] = (await readFile(activePortFile, "utf8")).trim().split(/\s+/);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    assert(page, "No browser page target was available.");
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    console.log("Connected to the browser.");
    client.listeners.set("Runtime.consoleAPICalled", [(params) => {
      const message = params.args.map((arg) => arg.value || arg.description || "").join(" ");
      if (params.type === "error" && message.includes("Nets rookie")) chartErrors.push(message);
    }]);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: URL });
    await loaded;
    console.log("Prototype page loaded.");
    await waitForChart(client);
    console.log("Nets chart is ready.");

    const desktop = await evaluate(client, `(() => {
      const root = document.querySelector('[data-nets-rookie-chart]');
      const card = root.closest('details');
      const intro = root.previousElementSibling;
      const continuation = root.nextElementSibling;
      const style = getComputedStyle(root);
      const comparison = root.netsRookieComparison;
      const positionErrors = [];
      root.querySelectorAll('.nets-rookies__row').forEach((rowElement, rowIndex) => {
        rowElement.querySelectorAll('.nets-rookies__metric').forEach((metricElement, metricIndex) => {
          const row = comparison.players[rowIndex];
          const metric = comparison.metrics[metricIndex];
          const expectedValue = Math.max(0, Math.min(100, ((row[metric.key] - metric.min) / (metric.max - metric.min)) * 100));
          const expectedMedian = Math.max(0, Math.min(100, ((comparison.benchmark[metric.key] - metric.min) / (metric.max - metric.min)) * 100));
          const actualValue = parseFloat(metricElement.querySelector('.nets-rookies__track').style.getPropertyValue('--nets-value'));
          const actualMedian = parseFloat(metricElement.querySelector('.nets-rookies__track').style.getPropertyValue('--nets-median'));
          if (Math.abs(actualValue - expectedValue) > 0.001 || Math.abs(actualMedian - expectedMedian) > 0.001) {
            positionErrors.push([row.playerId, metric.key, actualValue, expectedValue, actualMedian, expectedMedian]);
          }
        });
      });
      const text = root.textContent.replace(/\s+/g, ' ').trim();
      const tableText = root.querySelector('.nets-rookies__table').textContent.replace(/\s+/g, ' ').trim();
      return {
        cardOpen: card.open,
        busy: root.getAttribute('aria-busy'),
        rows: root.querySelectorAll('.nets-rookies__row').length,
        metrics: root.querySelectorAll('.nets-rookies__metric').length,
        tableRows: root.querySelectorAll('.nets-rookies__table tbody tr').length,
        introParagraphs: intro?.querySelectorAll(':scope > p').length,
        continuationParagraphs: continuation?.querySelectorAll(':scope > p').length,
        placement: intro?.classList.contains('story--nets-intro') && continuation?.classList.contains('story--nets-continuation'),
        identity: style.getPropertyValue('--team-identity').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
        text,
        tableText,
        positionErrors,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    assert(desktop.cardOpen && desktop.busy === "false", "Nets card or chart was not ready.");
    assert(desktop.rows === 5 && desktop.metrics === 20 && desktop.tableRows === 6, "Rendered chart/table counts were incorrect.");
    assert(desktop.introParagraphs === 8 && desktop.continuationParagraphs === 6 && desktop.placement, "Chart was not placed at the intended story break.");
    assert(desktop.identity.toLowerCase() === "#444444" && desktop.surface.toLowerCase() === "#e9e9e9", "Nets theme tokens were not inherited.");
    ["Danny Wolf", "Egor Demin", "Nolan Traore", "Ben Saraf", "Drake Powell"].forEach((value) => assert(desktop.text.includes(value), `Chart was missing ${value}.`));
    ["57", "20.8", "21.2", "5.3", "52", "25.2", "20.3", "6.5", "56.1%", "47.9%", "48.6%", "54.8%"].forEach((value) => assert(desktop.tableText.includes(value) || desktop.text.includes(value), `Rendered values were missing ${value}.`));
    assert(desktop.positionErrors.length === 0, `Bar or benchmark positions were incorrect: ${JSON.stringify(desktop.positionErrors)}`);
    assert(desktop.pageOverflow <= 1, `Desktop page overflowed by ${desktop.pageOverflow}px.`);
    await captureElement(client, "nets-rookies-desktop.png");

    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-nets-rookie-chart]');
      const rows = root.querySelector('.nets-rookies__rows');
      const firstRow = root.querySelector('.nets-rookies__row');
      const details = root.querySelector('.nets-rookies__table-details');
      const summary = root.querySelector('.nets-rookies__table-toggle');
      summary.focus();
      summary.click();
      return {
        columns: getComputedStyle(rows).gridTemplateColumns.split(' ').filter(Boolean).length,
        rowFits: firstRow.getBoundingClientRect().right <= root.getBoundingClientRect().right + 1,
        detailsOpen: details.open,
        focusVisible: document.activeElement === summary,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    assert(mobile.columns === 1 && mobile.rowFits, "Mobile player cards did not stack into one readable column.");
    assert(mobile.detailsOpen && mobile.focusVisible, "Accessible table toggle was not keyboard-focusable and operable.");
    assert(mobile.pageOverflow <= 1, `Mobile page overflowed by ${mobile.pageOverflow}px.`);
    await evaluate(client, `document.querySelector('.nets-rookies__table-details').open = false`);
    await captureElement(client, "nets-rookies-mobile.png");
    assert(chartErrors.length === 0, `Browser reported Nets chart errors: ${chartErrors.join(" | ")}`);

    console.log("Verified Nets rookie chart data, placement, theme, labels, benchmark positions, table, and publication status.");
    console.log("Verified 1280px desktop and 390px mobile layouts without page overflow.");
    console.log("Wrote artifacts/nets-rookies-desktop.png and artifacts/nets-rookies-mobile.png.");
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }
}


// Node 24 does not keep the experimental WebSocket connection alive while the
// CDP handshake promise is pending, so retain one timer for the verifier run.
const keepAlive = setInterval(() => {}, 1000);
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
