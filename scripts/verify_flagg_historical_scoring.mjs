import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE_URL = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html?preview=mavericks#team-mavericks";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9341;
const ARTIFACTS = path.join(ROOT, "artifacts", "flagg-historical-scoring");

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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) || []), listener]); }
  close() { this.socket.close(); }
}

async function browserTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await client.send("Runtime.evaluate", {
      expression: `document.querySelector('[data-flagg-history-chart]')?.getAttribute('aria-busy') === 'false'`,
      returnByValue: true,
    });
    if (ready.result.value) return;
    await delay(100);
  }
  throw new Error("Flagg chart did not finish loading.");
}

async function inspect(client, openTable = false) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const root = document.querySelector('[data-flagg-history-chart]');
      const card = document.querySelector('#team-mavericks');
      const tableDetails = root.querySelector('.flagg-history__table-details');
      tableDetails.open = ${openTable};
      root.scrollIntoView({block: 'start'});
      const bars = [...root.querySelectorAll('.flagg-history__bar')];
      const tableRows = [...root.querySelectorAll('tbody tr')].map((row) => [...row.cells].map((cell) => cell.textContent.trim()));
      const plot = root.querySelector('.flagg-history__plot');
      const svg = root.querySelector('svg');
      const tableWrap = root.querySelector('.flagg-history__table-wrap');
      const svgRect = svg.getBoundingClientRect();
      const firstBarRect = bars[0].getBoundingClientRect();
      const labelNodes = [...root.querySelectorAll('.flagg-history__name, .flagg-history__context')];
      const pointNodes = [...root.querySelectorAll('.flagg-history__points')];
      const gameNodes = [...root.querySelectorAll('.flagg-history__games')];
      return {
        cardOpen: card.open,
        completion: document.querySelector('#completion-count').textContent.trim(),
        dallasUpcoming: [...document.querySelectorAll('#upcoming-list li')].some((node) => node.textContent.includes('Dallas Mavericks')),
        dallasPublishedLink: Boolean(document.querySelector('#team-links a[href="#team-mavericks"]')),
        dallasSummary: card.querySelector('.subhead').textContent.trim(),
        title: root.querySelector('#flagg-history-title').textContent.trim(),
        subtitle: root.querySelector('.flagg-history__subtitle').textContent.trim(),
        takeaway: root.querySelector('.flagg-history__takeaway').textContent.trim(),
        implementationCopyAbsent: !root.textContent.includes('A zero-based horizontal bar chart ranks'),
        bars: bars.length,
        barStarts: bars.map((bar) => Number(bar.getAttribute('x'))),
        barWidths: bars.map((bar) => Number(bar.getAttribute('width'))),
        points: [...root.querySelectorAll('.flagg-history__points')].map((node) => node.textContent),
        games: [...root.querySelectorAll('.flagg-history__games')].map((node) => node.textContent),
        names: [...root.querySelectorAll('.flagg-history__name')].map((node) => node.textContent),
        contexts: [...root.querySelectorAll('.flagg-history__context')].map((node) => node.textContent),
        flagMarkers: root.querySelectorAll('.flagg-history__flag-marker').length,
        labelMetrics: labelNodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { text: node.textContent, leftInset: rect.left - svgRect.left, barGap: firstBarRect.left - rect.right };
        }),
        valueGaps: pointNodes.map((node, index) => gameNodes[index].getBoundingClientRect().left - node.getBoundingClientRect().right),
        labelsContained: labelNodes.every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= svgRect.left - 0.5 && rect.right <= firstBarRect.left - 3;
        }),
        valuesContained: [...pointNodes, ...gameNodes].every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= svgRect.left - 0.5 && rect.right <= svgRect.right + 0.5;
        }),
        valuesSeparated: pointNodes.every((node, index) => node.getBoundingClientRect().right <= gameNodes[index].getBoundingClientRect().left - 3),
        tableRows,
        tableOpen: tableDetails.open,
        tableContained: !tableDetails.open || tableWrap.scrollWidth >= tableWrap.clientWidth,
        chartWidth: Math.round(root.getBoundingClientRect().width),
        plotWidth: Math.round(plot.getBoundingClientRect().width),
        svgWidth: Math.round(svg.getBoundingClientRect().width),
        bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        errorStates: root.querySelectorAll('.flagg-history__status--error:not(noscript *)').length,
        identity: getComputedStyle(root).getPropertyValue('--team-identity').trim(),
        surface: getComputedStyle(root).backgroundColor,
        plotSurface: getComputedStyle(plot).backgroundColor,
        storyHasCutoff: document.querySelector('.story--mavericks-continuation').textContent.includes('first five games, before Dallas’ sixth result'),
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function screenshot(client, filename) {
  await delay(250);
  const bounds = await client.send("Runtime.evaluate", {
    expression: `(() => { const rect = document.querySelector('[data-flagg-history-chart]').getBoundingClientRect(); return {x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1}; })()`,
    returnByValue: true,
  });
  const result = await client.send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true, fromSurface: true, clip: bounds.result.value,
  });
  await writeFile(path.join(ARTIFACTS, filename), Buffer.from(result.data, "base64"));
}

function validate(view, expectedMaxWidth) {
  assert(view.cardOpen && view.bars === 10 && view.tableRows.length === 10, "Chart or accessible table structure is incomplete.");
  assert(view.title === "Flagg’s rookie scoring in teenage company", "Chart title changed.");
  assert(view.subtitle === "Total points across seasons listed at age 19 or younger; games played vary.", "Conservative age definition is missing.");
  assert(view.takeaway === "Flagg scored 1,473 points in his rookie season, sixth in this historical comparison.", "Concise takeaway is missing or duplicated.");
  assert(view.implementationCopyAbsent, "Implementation-focused chart copy remains visible.");
  assert(view.barStarts.every((value) => value === 0), "Bars do not share a zero baseline.");
  assert(view.barWidths.every((value, index, values) => index === 0 || values[index - 1] >= value), "Bar ordering is not descending.");
  assert(view.points.join("|") === "1,759|1,725|1,654|1,624|1,526|1,473|1,392|1,387|1,169|1,157", "Direct point labels differ from source values.");
  assert(view.games.join("|") === "150|82|79|80|72|70|72|82|82|67", "Games column differs from source values.");
  assert(view.names.join("|") === "1. Kobe Bryant|2. Carmelo Anthony|3. LeBron James|4. Kevin Durant|5. Luka Dončić|6. Cooper Flagg|7. Anthony Edwards|8. Andrew Wiggins|9. Jeremiah Fears|10. Jalen Green", "Player names or ranks are incomplete.");
  assert(view.flagMarkers === 0 && !view.contexts.some((value) => value.startsWith("FLAGG")), "Redundant Flagg marker or label remains.");
  assert(view.plotWidth < 560 ? view.contexts[0] === "1996-97–1997-98" : view.contexts[0] === "1996-97–1997-98 · age 18-19", "Kobe's season span is incomplete.");
  assert(view.labelsContained && view.valuesContained && view.valuesSeparated, `Chart labels clip or overlap the bars or games column: ${JSON.stringify({ labels: view.labelMetrics, valueGaps: view.valueGaps })}`);
  assert(view.tableRows[5].join("|") === "6|Cooper Flagg|1,473|70|2025–26|19", "Flagg accessible-table row differs from source values.");
  assert(view.completion === "26 of 30" && !view.dallasUpcoming && view.dallasPublishedLink, "Dallas publication state changed.");
  assert(view.dallasSummary === "A second year leap from 2025 Rookie of the Year Cooper Flagg and the return of a healthy Kyrie Irving might bring Dallas back to the Western Conference contender they were two seasons ago, before the infamous trade of Luka Doncic to the Lakers.", "Dallas dropdown summary changed.");
  assert(view.identity.toLowerCase() === "#00538c" && view.surface !== "rgb(255, 255, 255)" && view.plotSurface === "rgb(255, 255, 255)", "Dallas color roles are not applied.");
  assert(view.storyHasCutoff, "The five-game versus six-result data cutoff note is missing.");
  assert(!view.bodyOverflow && view.errorStates === 0 && view.svgWidth <= view.plotWidth + 1 && view.chartWidth <= expectedMaxWidth, "Layout overflowed, clipped, or entered an error state.");
}

await mkdir(ARTIFACTS, { recursive: true });
const chrome = spawn(CHROME, [
  "--headless", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(ARTIFACTS, `chrome-profile-${process.pid}`)}`, "about:blank",
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
  const desktop = await inspect(client, true);
  validate(desktop, 930);
  assert(desktop.tableOpen && desktop.tableContained, "Expanded desktop table is not contained.");
  await inspect(client, false);
  await screenshot(client, "desktop.png");

  await navigate(client, 768, 1100);
  const intermediate = await inspect(client, true);
  validate(intermediate, 720);
  assert(intermediate.tableOpen && intermediate.tableContained, "Expanded intermediate table is not contained.");
  await inspect(client, false);
  await screenshot(client, "intermediate.png");

  await navigate(client, 390, 844);
  const mobile = await inspect(client, true);
  validate(mobile, 370);
  assert(mobile.tableOpen && mobile.tableContained, "Expanded mobile table is not contained.");
  await inspect(client, false);
  await screenshot(client, "mobile.png");

  assert(consoleMessages.length === 0, `Unexpected browser console output: ${consoleMessages.join(" | ")}`);
  console.log("PASS: Flagg source values, zero baseline, age wording, theme, table, publication state and three responsive widths verified.");
  console.log(JSON.stringify({ desktop, intermediate, mobile }, null, 2));
} finally {
  if (client) {
    await client.send("Browser.close").catch(() => {});
    client.close();
  }
  chrome.kill();
}
