import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE_URL = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html?preview=hornets#team-hornets";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9337;
const ARTIFACTS = path.join(ROOT, "artifacts");

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
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
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      } else (this.listeners.get(message.method) || []).forEach((listener) => listener(message.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) || []), listener]); }
  close() { this.socket.close(); }
}

async function browserTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome DevTools target did not become available.");
}

async function navigate(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
  const targetUrl = new URL(PAGE_URL);
  targetUrl.searchParams.set("_verify", String(width));
  await client.send("Page.navigate", { url: targetUrl.href });
  await loaded;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ready = await client.send("Runtime.evaluate", { expression: `document.querySelector('[data-miller-hornets-chart]')?.getAttribute('aria-busy') === 'false'`, returnByValue: true });
    if (ready.result.value) return;
    await delay(100);
  }
  throw new Error("Miller chart did not finish loading.");
}

async function inspect(client) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const root = document.querySelector('[data-miller-hornets-chart]');
      root.scrollIntoView({block: 'start'});
      const text = [...root.querySelectorAll('.miller-chart__value')].map((node) => node.textContent);
      const samples = [...root.querySelectorAll('.miller-chart__sample')].map((node) => node.textContent);
      const tsPlus = [...root.querySelectorAll('.miller-chart__ts-plus')].map((node) => node.textContent);
      const card = document.querySelector('#team-hornets');
      return {
        panels: root.querySelectorAll('.miller-chart__panel').length,
        svgs: root.querySelectorAll('svg').length,
        latestSquares: root.querySelectorAll('.miller-chart__mark.is-latest rect').length,
        smallSamples: root.querySelectorAll('.miller-chart__mark.is-small-sample').length,
        tableRows: root.querySelectorAll('tbody tr').length,
        errorStates: root.querySelectorAll('.miller-chart__status--error:not(noscript *)').length,
        statusText: root.querySelector('.miller-chart__status')?.textContent || '',
        values: text,
        samples,
        tsPlus,
        cardOpen: card.open,
        completion: document.querySelector('#completion-count').textContent,
        charlotteUpcoming: [...document.querySelectorAll('#upcoming-list li')].some((node) => node.textContent.includes('Charlotte Hornets')),
        chartWidth: Math.round(root.getBoundingClientRect().width),
        panelColumns: getComputedStyle(root.querySelector('.miller-chart__panels')).gridTemplateColumns.split(' ').length,
        bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        identity: getComputedStyle(root).getPropertyValue('--team-identity').trim(),
        surface: getComputedStyle(root).backgroundColor,
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function screenshot(client, filename) {
  await delay(250);
  const bounds = await client.send("Runtime.evaluate", {
    expression: `(() => { const rect = document.querySelector('[data-miller-hornets-chart]').getBoundingClientRect(); return {x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1}; })()`,
    returnByValue: true,
  });
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip: bounds.result.value });
  await writeFile(path.join(ARTIFACTS, filename), Buffer.from(result.data, "base64"));
}

await mkdir(ARTIFACTS, { recursive: true });
const chrome = spawn(CHROME, [
  "--headless", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(ARTIFACTS, `miller-verify-profile-${process.pid}`)}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

let client;
try {
  const target = await browserTarget();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  const consoleMessages = [];
  client.on("Runtime.consoleAPICalled", (event) => consoleMessages.push(...event.args.map((argument) => argument.value || argument.description || "")));

  await navigate(client, 1280, 1400);
  const desktop = await inspect(client);
  await screenshot(client, "miller-hornets-desktop.png");
  if (consoleMessages.length) console.log("Browser console:", consoleMessages.join(" | "));
  assert(desktop.cardOpen && desktop.panels === 3 && desktop.svgs === 3 && desktop.tableRows === 3, "Desktop chart structure is incomplete.");
  assert(desktop.latestSquares === 3 && desktop.smallSamples === 3, "Shape-based latest-season or small-sample encoding is incomplete.");
  assert(desktop.values.join("|") === "26.5|30.2|33.0|23.9%|27.7%|28.1%|55.2%|54.0%|57.4%", "Direct values differ from source data.");
  assert(desktop.tsPlus.join("|") === "TS+ 95|TS+ 94|TS+ 99", "TS+ labels are incomplete.");
  assert(desktop.samples.filter((value) => value.includes("27 G · smaller sample")).length === 3, "The 27-game sample warning is incomplete.");
  assert(desktop.completion.trim() === "22 of 30" && desktop.charlotteUpcoming, "Charlotte publication state changed.");
  assert(desktop.identity.toLowerCase() === "#00788c" && desktop.surface !== "rgb(255, 255, 255)", "Charlotte theme roles are not applied.");
  assert(!desktop.bodyOverflow && desktop.errorStates === 0 && desktop.panelColumns === 3, "Desktop layout overflowed or entered an error state.");

  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await client.send("Runtime.evaluate", { expression: `new Promise((resolve) => { window.dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 300); })`, awaitPromise: true });
  const mobile = await inspect(client);
  await screenshot(client, "miller-hornets-mobile.png");
  assert(!mobile.bodyOverflow && mobile.errorStates === 0, "Mobile chart overflows or entered an error state.");
  assert(mobile.panels === 3 && mobile.panelColumns === 1 && mobile.chartWidth <= 358, "Mobile panels did not stack within the viewport.");
  assert(mobile.values.join("|") === desktop.values.join("|") && mobile.tsPlus.join("|") === desktop.tsPlus.join("|"), "Mobile labels differ from desktop.");

  console.log("PASS: Miller chart values, joins, units, sample warning, publication state, theme and responsive layout verified.");
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
} finally {
  if (client) {
    await client.send("Browser.close").catch(() => {});
    client.close();
  }
  chrome.kill();
}
