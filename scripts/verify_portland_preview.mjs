import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html?preview=trail-blazers#team-trail-blazers";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9347;
const ARTIFACTS = path.join(ROOT, "artifacts", "portland-preview");
const PROFILE = path.join(os.tmpdir(), `portland-preview-chrome-${process.pid}`);
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json()); const page = list.find((item) => item.type === "page"); if (page) return page; } catch {}
    await delay(100);
  }
  throw new Error("Chrome target unavailable.");
}

async function navigate(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
  const url = new globalThis.URL(URL); url.searchParams.set("_portland_verify", String(width));
  await client.send("Page.navigate", { url: url.href }); await loaded;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await client.send("Runtime.evaluate", { expression: `(() => { const card = document.querySelector('#team-trail-blazers'); const charts = [...card?.querySelectorAll('.portland-chart') || []]; return card?.open && charts.length === 2 && charts.every((node) => node.getAttribute('aria-busy') === 'false'); })()`, returnByValue: true });
    if (ready.result.value) return;
    await delay(100);
  }
  throw new Error("Portland graphics did not become render-ready.");
}

async function resize(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await client.send("Runtime.evaluate", { expression: `new Promise((resolve)=>{dispatchEvent(new Event('resize'));setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),400)})`, awaitPromise: true });
}

async function inspect(client) {
  const result = await client.send("Runtime.evaluate", { expression: `(() => {
    const card = document.querySelector('#team-trail-blazers');
    const charts = [...card.querySelectorAll('.portland-chart')];
    const deni = card.querySelector('[data-deni-offense-chart]');
    const clingan = card.querySelector('[data-clingan-centers-chart]');
    return {
      open: card.open, charts: charts.length,
      proseParagraphs: card.querySelectorAll('.story--trail-blazers > p').length,
      dataNotes: card.querySelectorAll('.portland-story__data-note').length,
      dataNoteText: card.querySelector('.portland-story__data-note')?.textContent.trim(),
      deniPanels: deni.querySelectorAll('.deni-offense__panel').length,
      deniPoints: deni.querySelectorAll('.deni-offense__point').length,
      deniValues: [...deni.querySelectorAll('.deni-offense__value')].map((node) => node.textContent),
      deniSupport: [...deni.querySelectorAll('.deni-offense__support-values')].map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
      deniSupportTitle: deni.querySelector('.deni-offense__support-title')?.textContent.trim(),
      deniRows: deni.querySelectorAll('tbody tr').length,
      deniColumns: getComputedStyle(deni.querySelector('.deni-offense__panels')).gridTemplateColumns,
      deniSvgHeights: [...deni.querySelectorAll('.deni-offense__panel svg')].map((node) => Math.round(node.getBoundingClientRect().height)),
      deniViewBoxHeights: [...deni.querySelectorAll('.deni-offense__panel svg')].map((node) => node.viewBox.baseVal.height),
      deniMetricNotes: [...deni.querySelectorAll('.deni-offense__metric-note')].map((node) => node.textContent.trim()),
      transitionStroke: getComputedStyle(deni.querySelector('.deni-offense__transition')).stroke,
      clinganPanels: clingan.querySelectorAll('.clingan-centers__panel').length,
      peerMarks: clingan.querySelectorAll('.clingan-centers__peer').length,
      focusMarks: clingan.querySelectorAll('.clingan-centers__focus').length,
      clinganLabels: [...clingan.querySelectorAll('.clingan-centers__label')].map((node) => node.textContent),
      peerLabels: [...clingan.querySelectorAll('.clingan-centers__peer-label')].map((node) => node.textContent),
      clinganMetricNotes: [...clingan.querySelectorAll('.clingan-centers__metric-note')].map((node) => node.textContent.trim()),
      clinganPanelBackgrounds: [...clingan.querySelectorAll('.clingan-centers__panel')].map((node) => getComputedStyle(node).backgroundColor),
      clinganTableRanks: [...clingan.querySelectorAll('tbody tr td:last-child')].map((node) => node.textContent.trim()),
      clinganTableDefinitions: [...clingan.querySelectorAll('.portland-chart__table-definition')].map((node) => node.textContent.trim()),
      clinganRows: clingan.querySelectorAll('tbody tr').length,
      initialized: charts.map((node) => node.dataset.portlandInitialized),
      errors: card.querySelectorAll('.portland-chart__status--error').length,
      identity: getComputedStyle(charts[0]).getPropertyValue('--team-identity').trim().toLowerCase(),
      surfaces: charts.map((node) => getComputedStyle(node).backgroundColor),
      widths: charts.map((node) => Math.round(node.getBoundingClientRect().width)),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      inJump: [...document.querySelectorAll('#jump option')].some((node) => node.textContent.includes('Portland Trail Blazers')),
      upcoming: [...document.querySelectorAll('#upcoming-list li')].some((node) => node.textContent.includes('Portland Trail Blazers')),
      currentSeasonInCharts: /2026[–-]27|four games|(?:^|\s)4 games/i.test(charts.map((node) => node.innerText).join(' ')),
      chartTitles: charts.map((node) => node.querySelector('.portland-chart__title').textContent.trim()),
      annotationOverlaps: (() => {
        const nodes = [...clingan.querySelectorAll('.clingan-centers__label,.clingan-centers__peer-label')];
        let count = 0;
        nodes.forEach((a, index) => nodes.slice(index + 1).forEach((b) => {
          if (a.ownerSVGElement !== b.ownerSVGElement) return;
          const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
          if (Math.min(ar.right, br.right) - Math.max(ar.left, br.left) > 1 && Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top) > 1) count += 1;
        }));
        return count;
      })(),
      clippedLabels: [...card.querySelectorAll('.deni-offense__value,.deni-offense__season,.deni-offense__team,.clingan-centers__label,.clingan-centers__peer-label')].filter((node) => {
        const r = node.getBoundingClientRect(), s = node.ownerSVGElement.getBoundingClientRect();
        return r.left < s.left - 2 || r.right > s.right + 2 || r.top < s.top - 2 || r.bottom > s.bottom + 2;
      }).map((node) => node.textContent),
    };
  })()`, returnByValue: true });
  return result.result.value;
}

async function screenshot(client, selector, name) {
  await client.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})` }); await delay(300);
  const bounds = await client.send("Runtime.evaluate", { expression: `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}; })()`, returnByValue: true });
  const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip: bounds.result.value });
  await writeFile(path.join(ARTIFACTS, name), Buffer.from(shot.data, "base64"));
}

const source = await readFile(path.join(ROOT, "2026-27-team-previews.html"), "utf8");
const deployable = await readFile(path.join(ROOT, "dist", "2026-27-team-previews", "index.html"), "utf8");
assert(source === deployable, "Production source and deployable index differ.");
assert(/name: "Portland Trail Blazers",[\s\S]{0,180}?slug: "trail-blazers",[\s\S]{0,80}?powerRank: 23,[\s\S]{0,80}?status: "published",[\s\S]{0,100}?logo: "assets\/img\/teamlogos\/Portland-Trail-Blazers-Symbol\.png",[\s\S]{0,260}?thesis: "The return of franchise icon Damian Lillard and the arrival of yet another superstar guard in Ja Morant have rejuvenated the contending hopes and chances of this young and ascendant Trail Blazers team\."/.test(source), "Portland rank, publication state, logo or dropdown summary changed.");

await mkdir(ARTIFACTS, { recursive: true });
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "about:blank"], { stdio: "ignore", windowsHide: true });
let client;
try {
  client = new Client((await target()).webSocketDebuggerUrl); await client.connect(); await client.send("Page.enable"); await client.send("Runtime.enable");
  const browserErrors = []; client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => browserErrors.push(exceptionDetails.text));
  await navigate(client, 1280, 1200); const desktop = await inspect(client);
  await screenshot(client, "[data-deni-offense-chart]", "deni-desktop.png"); await screenshot(client, "[data-clingan-centers-chart]", "clingan-desktop.png");
  console.log("Desktop inspection:", JSON.stringify(desktop));
  assert(desktop.open && desktop.charts === 2 && desktop.proseParagraphs === 21 && desktop.dataNotes === 1, "Portland article, cutoff note or figure structure is incomplete.");
  assert(desktop.dataNoteText.includes("through Portland’s first four games") && desktop.dataNoteText.includes("Oct. 31 win over Utah") && desktop.dataNoteText.includes("completed regular seasons"), "Statistical cutoff note changed.");
  assert(desktop.deniPanels === 3 && desktop.deniPoints === 9 && desktop.deniRows === 3 && desktop.deniSupport.length === 3, "Deni panels, marks, support row or table are incomplete.");
  for (const label of ["20.2%", "23.2%", "29.3%", "5.9", "6.3", "9.6", "34.0", "44.1", "57.3"]) assert(desktop.deniValues.includes(label), `Missing Deni label ${label}.`);
  assert(desktop.deniSupportTitle === "True shooting stayed near 60%" && desktop.deniSupport.join("|").includes("59.7% TS") && desktop.deniSupport.join("|").includes("60.5% TS") && desktop.deniSupport.join("|").includes("60.0% TS"), "Deni true-shooting support values are incomplete.");
  assert(desktop.deniViewBoxHeights.every((value) => value === 190) && Math.max(...desktop.deniSvgHeights) <= 205, "Deni panels retain excess height.");
  assert(desktop.deniMetricNotes.join("|") === "Estimated share of team plays used while on court|FTr × 100; not free throws per 100 possessions", "Deni panel descriptions are redundant or changed.");
  assert(desktop.clinganPanels === 3 && desktop.peerMarks === 213 && desktop.focusMarks === 3 && desktop.clinganRows === 3, "Clingan distributions, marks or table are incomplete.");
  assert(desktop.clinganLabels.join("|") === "17.6% · 3rd of 72|27.6% · 14th of 72|6.3% · Tied 7th of 72", "Clingan values or ranks changed.");
  assert(desktop.clinganTableRanks.join("|") === "3rd of 72|14th of 72|Tied 7th of 72", "Accessible Clingan rank wording is inconsistent.");
  assert(desktop.clinganMetricNotes.join("|") === desktop.clinganTableDefinitions.join("|"), "Clingan metric descriptions and accessible table definitions disagree.");
  assert(desktop.peerLabels.join("|") === "Mitchell Robinson 23.3%|Steven Adams 22.1%", "Desktop offensive-rebounding leader labels are missing or incorrect.");
  assert(new Set(desktop.clinganPanelBackgrounds).size === 1, "Clingan panels do not share a consistent default background.");
  assert(desktop.annotationOverlaps === 0 && desktop.clippedLabels.length === 0, "Desktop annotations overlap or clip.");
  assert(desktop.identity === "#e03a3e" && desktop.surfaces.every((value) => value !== "rgb(255, 255, 255)"), "Portland theme roles are not applied to both graphics.");
  assert(!desktop.pageOverflow && desktop.errors === 0 && desktop.inJump && !desktop.upcoming && !desktop.currentSeasonInCharts, "Desktop overflow, chart error, current-season leakage or publication-state regression detected.");
  assert(desktop.chartTitles.join("|") === "Deni’s expanding offensive role|Clingan’s place among NBA centers", "Chart titles changed.");
  assert(desktop.deniColumns.split(" ").length === 3, "Deni desktop panels are not aligned in three columns.");

  await resize(client, 700, 950); const intermediate = await inspect(client);
  await screenshot(client, "[data-deni-offense-chart]", "deni-intermediate.png"); await screenshot(client, "[data-clingan-centers-chart]", "clingan-intermediate.png");
  assert(!intermediate.pageOverflow && intermediate.errors === 0 && intermediate.deniColumns.split(" ").length === 1, "Intermediate-width rendering did not reflow or remain contained.");
  assert(intermediate.peerLabels.length === 0 && intermediate.annotationOverlaps === 0 && intermediate.clippedLabels.length === 0, "Optional peer labels did not adapt cleanly at intermediate width.");

  await resize(client, 390, 844); const mobile = await inspect(client);
  await screenshot(client, "[data-deni-offense-chart]", "deni-mobile.png"); await screenshot(client, "[data-clingan-centers-chart]", "clingan-mobile.png");
  console.log("Mobile inspection:", JSON.stringify(mobile));
  assert(!mobile.pageOverflow && mobile.errors === 0 && Math.max(...mobile.widths) <= 378, "Mobile graphics overflow or entered an error state.");
  assert(mobile.deniPanels === 3 && mobile.deniPoints === 9 && mobile.clinganPanels === 3 && mobile.peerMarks === 213 && mobile.deniColumns.split(" ").length === 1, "Mobile rendering lost chart content.");
  assert(mobile.peerLabels.length === 0 && mobile.annotationOverlaps === 0 && mobile.clippedLabels.length === 0, "Mobile annotations overlap, clip or retain optional peer labels.");

  const reopened = await client.send("Runtime.evaluate", { expression: `(async () => { const card=document.querySelector('#team-trail-blazers'); card.open=false; await new Promise(r=>setTimeout(r,80)); card.open=true; await new Promise(r=>setTimeout(r,180)); return {charts:card.querySelectorAll('.portland-chart').length,svgs:card.querySelectorAll('.portland-chart svg').length,initialized:[...card.querySelectorAll('.portland-chart')].map(n=>n.dataset.portlandInitialized)}; })()`, awaitPromise: true, returnByValue: true });
  assert(reopened.result.value.charts === 2 && reopened.result.value.svgs === 6 && reopened.result.value.initialized.every((value) => value === "true"), "Reopening duplicated or failed to preserve Portland charts.");
  assert(browserErrors.length === 0, `Browser exceptions: ${browserErrors.join(" | ")}`);
  console.log("PASS: Portland data, status, theme, accessibility structure, reopening and responsive rendering verified.");
  console.log(JSON.stringify({ desktop, intermediate, mobile }, null, 2));
} finally {
  if (client) { await client.send("Browser.close").catch(() => {}); client.close(); }
  chrome.kill();
}
