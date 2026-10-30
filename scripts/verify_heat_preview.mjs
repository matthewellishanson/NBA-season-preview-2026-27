import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html?preview=heat#team-heat";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9342;
const ARTIFACTS = path.join(ROOT, "artifacts", "heat-preview");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

class Client {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async connect() { this.ws = new WebSocket(this.url); await new Promise((resolve, reject) => { this.ws.addEventListener("open", resolve, { once: true }); this.ws.addEventListener("error", reject, { once: true }); }); this.ws.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.id && this.pending.has(message.id)) { const item = this.pending.get(message.id); this.pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); } else (this.listeners.get(message.method) || []).forEach((listener) => listener(message.params)); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) || []), listener]); }
  close() { this.ws.close(); }
}

async function target() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json()); const page = list.find((item) => item.type === "page"); if (page) return page; } catch {}
    await delay(100);
  }
  throw new Error("Chrome target unavailable.");
}

async function navigate(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
  const url = new globalThis.URL(URL); url.searchParams.set("_heat_verify", String(width));
  await client.send("Page.navigate", { url: url.href }); await loaded;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await client.send("Runtime.evaluate", { expression: `[...document.querySelectorAll('#team-heat .heat-chart')].length === 3 && [...document.querySelectorAll('#team-heat .heat-chart')].every((node) => node.getAttribute('aria-busy') === 'false')`, returnByValue: true });
    if (ready.result.value) return;
    await delay(100);
  }
  throw new Error("Heat graphics did not become render-ready.");
}

async function inspect(client) {
  const result = await client.send("Runtime.evaluate", { expression: `(() => {
    const card = document.querySelector('#team-heat'); const charts = [...card.querySelectorAll('.heat-chart')];
    return {
      open: card.open, charts: charts.length, storyParagraphs: card.querySelectorAll('.story--heat > p').length,
      klayPanels: card.querySelectorAll('.heat-klay .heat-chart__panel').length,
      klayPoints: card.querySelectorAll('.heat-klay .heat-chart__point').length,
      absenceBands: card.querySelectorAll('.heat-klay .heat-chart__absence-band').length,
      absenceLabels: [...card.querySelectorAll('.heat-klay .heat-chart__absence-label')].map((node) => node.textContent),
      returnLabels: [...card.querySelectorAll('.heat-klay .heat-chart__return-label')].map((node) => node.textContent),
      klayPanelHeights: [...card.querySelectorAll('.heat-klay svg')].map((node) => Math.round(node.getBoundingClientRect().height)),
      fitSvgs: card.querySelectorAll('.heat-fit svg').length,
      fitPercentTicks: [...card.querySelectorAll('[data-heat-bam-role] .heat-chart__axis-label')].map((node) => node.textContent).filter((text) => /^\\d+%$/.test(text)),
      fitHeadings: [...card.querySelectorAll('.heat-fit__part-title')].map((node) => node.textContent.trim()),
      matrixPlayers: card.querySelectorAll('.heat-matrix [data-player-id]').length,
      matrixLayout: card.querySelector('.heat-matrix-chart').dataset.matrixLayout,
      matrixClass: card.querySelector('.heat-matrix-chart').className,
      matrixRowDisplay: getComputedStyle(card.querySelector('.heat-matrix [data-player-id]')).display,
      matrixRowColumns: getComputedStyle(card.querySelector('.heat-matrix [data-player-id]')).gridTemplateColumns,
      matrixClientWidth: Math.round(card.querySelector('.heat-matrix').getBoundingClientRect().width),
      matrixScrollWidth: card.querySelector('.heat-matrix__wrap').scrollWidth,
      matrixDots: card.querySelectorAll('.heat-matrix__metric--dot').length,
      matrixHeaderColumns: card.querySelectorAll('.heat-matrix thead th').length,
      tableRows: card.querySelectorAll('.heat-chart__table tbody tr').length,
      errors: card.querySelectorAll('.heat-chart__status--error').length,
      identity: getComputedStyle(charts[0]).getPropertyValue('--team-identity').trim(),
      surface: getComputedStyle(charts[0]).backgroundColor,
      widths: charts.map((node) => Math.round(node.getBoundingClientRect().width)),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      heatInJump: [...document.querySelectorAll('#jump option')].some((node) => node.textContent.includes('Miami Heat')),
      heatUpcoming: [...document.querySelectorAll('#upcoming-list li')].some((node) => node.textContent.includes('Miami Heat')),
      titleTexts: [...card.querySelectorAll('.heat-chart__title')].map((node) => node.textContent.trim()),
      matrixValues: [...card.querySelectorAll('.heat-matrix__value')].map((node) => node.textContent.trim()),
      forbiddenCopy: /One scale per metric|In-cell rules|zero-based|kept outside|supplied files|Verified arrivals/.test(card.innerText),
    };
  })()`, returnByValue: true });
  return result.result.value;
}

async function screenshot(client, selector, name) {
  await client.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})` }); await delay(400);
  const bounds = await client.send("Runtime.evaluate", { expression: `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}; })()`, returnByValue: true });
  const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip: bounds.result.value });
  await writeFile(path.join(ARTIFACTS, name), Buffer.from(shot.data, "base64"));
}

const source = await readFile(path.join(ROOT, "2026-27-team-previews.html"), "utf8");
const deployable = await readFile(path.join(ROOT, "dist", "2026-27-team-previews", "index.html"), "utf8");
assert(source === deployable, "Production source and deployable index differ.");
assert(/name: "Miami Heat",[\s\S]{0,180}?status: "published",[\s\S]{0,100}?logo: "assets\/img\/teamlogos\/heatlogo\.png",[\s\S]{0,220}?thesis: "Miami finally landed their white whale in trading for Giannis Antetokounmpo this summer, but perhaps at the cost of a roster worthy of his talent\."/.test(source), "Miami publication state or dropdown summary changed.");

await mkdir(ARTIFACTS, { recursive: true });
const chrome = spawn(CHROME, ["--headless", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ARTIFACTS, `profile-${process.pid}`)}`, "about:blank"], { stdio: "ignore", windowsHide: true });
let client;
try {
  client = new Client((await target()).webSocketDebuggerUrl); await client.connect(); await client.send("Page.enable"); await client.send("Runtime.enable");
  const browserErrors = []; client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => browserErrors.push(exceptionDetails.text));
  await navigate(client, 1280, 1200); const desktop = await inspect(client);
  await screenshot(client, ".heat-matrix-chart", "offseason-desktop.png"); await screenshot(client, ".heat-klay", "klay-desktop.png"); await screenshot(client, ".heat-fit", "fit-desktop.png");
  console.log("Desktop inspection:", JSON.stringify(desktop));
  assert(desktop.open && desktop.charts === 3 && desktop.storyParagraphs === 19, "Heat article or figure structure is incomplete.");
  assert(desktop.klayPanels === 3 && desktop.klayPoints === 30 && desktop.absenceBands === 3, "Klay panels, played seasons or absence bands are incomplete.");
  assert(desktop.absenceLabels.join("|") === "Missed both seasons" && desktop.returnLabels.join("|") === "32 games", "Klay absence or return-sample annotation is incomplete.");
  assert(Math.max(...desktop.klayPanelHeights) <= 190, "Klay desktop panels retain excess height.");
  assert(desktop.fitSvgs === 2 && desktop.fitPercentTicks.join("|") === "25%|30%|35%|40%", "Fit graphic or three-point percentage ticks are incomplete.");
  assert(desktop.fitHeadings.join("|") === "Bam’s expanding three-point role|Established 2025–26 shot profiles", "Fit panel headings changed.");
  assert(desktop.matrixPlayers === 7 && desktop.matrixDots === 14 && desktop.matrixHeaderColumns === 6 && desktop.matrixLayout === "matrix" && desktop.tableRows === 17, "Desktop matrix or accessible tables are incomplete.");
  assert(desktop.identity.toLowerCase() === "#98002e" && desktop.surface !== "rgb(255, 255, 255)", "Miami theme roles are not applied.");
  assert(!desktop.pageOverflow && desktop.errors === 0 && desktop.heatInJump && !desktop.heatUpcoming, "Desktop overflow, errors or publication state regression detected.");
  assert(desktop.titleTexts.join("|") === "A superstar addition, a reshaped supporting cast|Klay’s offense has narrowed|Can Bam give Giannis more room?", "Chart titles changed.");
  assert(desktop.matrixValues.includes("65.8%") && desktop.matrixValues.includes("16.6") && desktop.matrixValues.includes("42.3%") && !desktop.forbiddenCopy, "Essential matrix values are missing or process copy remains visible.");

  await client.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send("Runtime.evaluate", { expression: `new Promise((resolve)=>{dispatchEvent(new Event('resize'));setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),350)})`, awaitPromise: true });
  const intermediate = await inspect(client);
  await screenshot(client, ".heat-matrix-chart", "offseason-intermediate.png"); await screenshot(client, ".heat-klay", "klay-intermediate.png"); await screenshot(client, ".heat-fit", "fit-intermediate.png");
  assert(!intermediate.pageOverflow && intermediate.errors === 0 && intermediate.matrixLayout === "matrix" && intermediate.matrixRowDisplay === "table-row" && intermediate.matrixScrollWidth <= intermediate.matrixClientWidth + 1, "Intermediate-width matrix did not remain aligned and contained.");

  await client.send("Emulation.setDeviceMetricsOverride", { width: 650, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send("Runtime.evaluate", { expression: `new Promise((resolve)=>{dispatchEvent(new Event('resize'));setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),350)})`, awaitPromise: true });
  const narrow = await inspect(client);
  await screenshot(client, ".heat-matrix-chart", "offseason-narrow.png");
  assert(!narrow.pageOverflow && narrow.errors === 0 && narrow.matrixLayout === "compact" && narrow.matrixRowDisplay === "grid" && narrow.matrixRowColumns.split(" ").length === 3 && narrow.matrixScrollWidth <= narrow.matrixClientWidth + 1, "Narrow container layout did not switch cleanly.");

  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await client.send("Runtime.evaluate", { expression: `new Promise((resolve)=>{dispatchEvent(new Event('resize'));setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),350)})`, awaitPromise: true });
  const mobile = await inspect(client);
  await screenshot(client, ".heat-matrix-chart", "offseason-mobile.png"); await screenshot(client, ".heat-klay", "klay-mobile.png"); await screenshot(client, ".heat-fit", "fit-mobile.png");
  assert(!mobile.pageOverflow && mobile.errors === 0 && Math.max(...mobile.widths) <= 358, "Mobile graphics overflow or entered an error state.");
  assert(mobile.klayPanels === 3 && mobile.klayPoints === 30 && mobile.absenceBands === 3 && mobile.fitSvgs === 2 && mobile.matrixPlayers === 7 && mobile.matrixLayout === "compact" && mobile.matrixRowDisplay === "grid" && mobile.matrixRowColumns.split(" ").length === 2, "Mobile rendering lost chart content.");
  assert(browserErrors.length === 0, `Browser exceptions: ${browserErrors.join(" | ")}`);
  console.log("PASS: Heat data, publication state, themes, accessibility structure, desktop and mobile rendering verified.");
  console.log(JSON.stringify({ desktop, intermediate, narrow, mobile }, null, 2));
} finally {
  if (client) { await client.send("Browser.close").catch(() => {}); client.close(); }
  chrome.kill();
}
