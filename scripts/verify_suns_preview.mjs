import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE_URL = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html?preview=suns#team-suns";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9345;
const ARTIFACTS = path.join(ROOT, "artifacts", "suns-preview");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

class Client {
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
        const item = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
        return;
      }
      (this.listeners.get(message.method) || []).forEach((listener) => listener(message.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  close() { this.socket?.close(); }
}

async function target() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json());
      if (tabs[0]) return tabs[0];
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome debugging target did not start.");
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function navigate(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  const pageUrl = new URL(PAGE_URL);
  pageUrl.searchParams.set("_suns_verify", String(width));
  await client.send("Page.navigate", { url: pageUrl.href });
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const ready = await evaluate(client, `(() => {
      const card = document.querySelector('#team-suns');
      const charts = [...document.querySelectorAll('#team-suns .suns-chart')];
      return !!card && card.open && charts.length === 3 && charts.every((chart) => chart.dataset.chartReady === 'true');
    })()`);
    if (ready) return;
    await delay(100);
  }
  const diagnostic = await evaluate(client, `(() => ({
    card: !!document.querySelector('#team-suns'),
    open: document.querySelector('#team-suns')?.open,
    charts: [...document.querySelectorAll('#team-suns .suns-chart')].map((chart) => ({ ready: chart.dataset.chartReady || '', busy: chart.getAttribute('aria-busy'), status: chart.querySelector('.suns-chart__status')?.textContent || '' })),
    page: location.href,
  }))()`);
  throw new Error(`Phoenix charts did not become ready: ${JSON.stringify(diagnostic)}`);
}

async function inspect(client) {
  return evaluate(client, `(async () => {
    const card = document.querySelector('#team-suns');
    const charts = [...card.querySelectorAll('.suns-chart')];
    const details = [...card.querySelectorAll('.suns-chart__table-details')];
    details.forEach((node) => node.open = true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const greenSvg = card.querySelector('.suns-green__change-svg');
    const greenMarks = [...greenSvg.querySelectorAll('.suns-green__peer, .suns-green__highlight')];
    const bounds = {
      layout: greenSvg.dataset.layout,
      left: Number(greenSvg.dataset.plotLeft),
      right: Number(greenSvg.dataset.plotRight),
      top: Number(greenSvg.dataset.plotTop),
      bottom: Number(greenSvg.dataset.plotBottom),
    };
    const greenGeometry = {
      marks: greenMarks.length,
      uniquePlayers: new Set(greenMarks.map((mark) => mark.dataset.player)).size,
      inside: greenMarks.every((mark) => {
        const x = Number(mark.dataset.x); const y = Number(mark.dataset.y);
        return x >= bounds.left - .01 && x <= bounds.right + .01 && y >= bounds.top - .01 && y <= bounds.bottom + .01;
      }),
      entireInside: greenMarks.every((mark) => {
        const rect = mark.getBoundingClientRect(); const svgRect = greenSvg.getBoundingClientRect();
        return rect.left >= svgRect.left - .5 && rect.right <= svgRect.right + .5 && rect.top >= svgRect.top - .5 && rect.bottom <= svgRect.bottom + .5;
      }),
      clipPaths: greenSvg.querySelectorAll('clipPath').length,
      greenX: Number(greenSvg.querySelector('.suns-green__highlight').dataset.xValue),
      greenY: Number(greenSvg.querySelector('.suns-green__highlight').dataset.yValue),
    };
    const tooltip = card.querySelector('.suns-green .suns-chart__tooltip');
    const tooltipHiddenInitially = tooltip.hidden;
    greenSvg.focus();
    const inspectionBefore = tooltip.textContent;
    greenSvg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const keyboardInspection = !tooltip.hidden && tooltip.textContent !== inspectionBefore;
    const peer = greenSvg.querySelector('.suns-green__peer');
    const peerRect = peer.getBoundingClientRect();
    greenSvg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: peerRect.left + peerRect.width / 2, clientY: peerRect.top + peerRect.height / 2 }));
    const tapInspection = !tooltip.hidden && tooltip.textContent.includes('rookie:') && tooltip.textContent.includes('Change:');
    const greenHighlight = greenSvg.querySelector('.suns-green__highlight');
    const greenRect = greenHighlight.getBoundingClientRect();
    greenSvg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: greenRect.left + greenRect.width / 2, clientY: greenRect.top + greenRect.height / 2 }));
    greenSvg.blur();
    tooltip.hidden = true;
    const labelRoles = [...greenSvg.querySelectorAll('.suns-green__peer-label')].map((node) => node.dataset.labelRole).sort();
    const labelBoundsValid = [...greenSvg.querySelectorAll('.suns-green__peer-label')].every((node) => {
      const rect = node.getBoundingClientRect(); const svgRect = greenSvg.getBoundingClientRect();
      return rect.left >= svgRect.left - .5 && rect.right <= svgRect.right + .5 && rect.top >= svgRect.top - .5 && rect.bottom <= svgRect.bottom + .5;
    });
    const bookerSvg = card.querySelector('.suns-booker__career-svg');
    const seasonRows = [...bookerSvg.querySelectorAll('.suns-booker__season-axis .tick text > tspan:first-child')].map((node) => Math.round(node.getBoundingClientRect().top));
    const gameRows = [...bookerSvg.querySelectorAll('.suns-booker__season-axis .suns-chart__games-label')].map((node) => Math.round(node.getBoundingClientRect().top));
    const teamSvg = card.querySelector('.suns-team__svg');
    const teamAxes = [...teamSvg.querySelectorAll('.suns-chart__axis')];
    const teamHeadings = [...teamSvg.querySelectorAll('.suns-booker__panel-label')];
    const teamBlockGaps = teamAxes.slice(0, -1).map((axis, index) => teamHeadings[index + 1].getBoundingClientRect().top - axis.getBoundingClientRect().bottom);
    const teamTracks = [...card.querySelectorAll('.suns-team__track')].map((line) => ({ x1: Number(line.getAttribute('x1')), x2: Number(line.getAttribute('x2')) }));
    const completedMarks = [...card.querySelectorAll('.suns-team__completed-mark')];
    const currentMarks = [...card.querySelectorAll('.suns-team__current-mark')];
    const teamMappings = completedMarks.map((mark, index) => ({
      completedValue: Number(mark.dataset.value), completedX: Number(mark.dataset.x),
      currentValue: Number(currentMarks[index].dataset.value), currentX: Number(currentMarks[index].dataset.x),
    }));
    const result = {
      open: card.open,
      charts: charts.length,
      ready: charts.every((chart) => chart.dataset.chartReady === 'true'),
      storyParagraphs: card.querySelectorAll('.story--suns > p').length,
      transactionItems: card.querySelectorAll('.suns-transaction-list > li').length,
      packageOrder: [...card.querySelector('.suns-preview-package').children].map((node) => node.matches('.story--suns-intro') ? 'intro' : node.matches('.story--suns-team-context') ? 'team-context' : node.matches('.suns-team') ? 'team' : node.matches('.story--suns-booker-context') ? 'booker-context' : node.matches('.suns-booker') ? 'booker' : node.matches('.story--suns-green-context') ? 'green-context' : node.matches('.suns-green') ? 'green' : node.matches('.story--suns-conclusion') ? 'conclusion' : 'unknown'),
      spotifyLink: card.querySelector('.story--suns-intro a')?.href || '',
      storyOpening: card.querySelector('.story--suns-intro p')?.textContent.trim() || '',
      storyClosing: card.querySelector('.story--suns-conclusion p')?.textContent.trim() || '',
      titleTexts: [...card.querySelectorAll('.suns-chart__title')].map((node) => node.textContent.trim()),
      greenGeometry,
      greenClipExpected: greenGeometry.clipPaths === 1,
      greenTooltipHiddenInitially: tooltipHiddenInitially,
      greenLabelRoles: labelRoles,
      greenLabelBoundsValid: labelBoundsValid,
      greenKeyboardInspection: keyboardInspection,
      greenTapInspection: tapInspection,
      greenCohortRows: card.querySelectorAll('.suns-green__cohort-table tbody tr').length,
      greenCareerRows: card.querySelectorAll('.suns-green__career-table tbody tr').length,
      greenCareerPoints: card.querySelectorAll('.suns-green__career-point').length,
      greenCareerLines: card.querySelectorAll('.suns-green__career-line').length,
      greenCurrentInHistory: /2026|26.27/.test(card.querySelector('.suns-green__career-svg').textContent),
      greenCurrentSummary: card.querySelector('.suns-green .suns-chart__current-summary').innerText,
      bookerPoints: card.querySelectorAll('.suns-booker__point').length,
      bookerLines: card.querySelectorAll('.suns-booker__line').length,
      bookerSeasonTicks: card.querySelectorAll('.suns-booker__season-axis .tick').length,
      bookerGameLabels: card.querySelectorAll('.suns-booker__season-axis .suns-chart__games-label').length,
      bookerSeasonRowsAligned: new Set(seasonRows).size === 1 && new Set(gameRows).size === 1,
      bookerSvgHeight: bookerSvg.viewBox.baseVal.height,
      bookerCurrentInHistory: /2026|26.27/.test(bookerSvg.textContent),
      bookerCurrentSummary: card.querySelector('.suns-booker .suns-chart__current-summary').innerText,
      bookerRows: card.querySelectorAll('.suns-booker__table tbody tr').length,
      teamTracks: teamTracks.length,
      teamTrackEndpointsAligned: teamTracks.length === 3 && teamTracks.every((track) => Math.abs(track.x1 - teamTracks[0].x1) < .01 && Math.abs(track.x2 - teamTracks[0].x2) < .01),
      teamCompletedMarks: completedMarks.length,
      teamCurrentMarks: currentMarks.length,
      teamMappings,
      teamMappingsIncreasing: teamMappings.every((mapping) => (mapping.currentValue > mapping.completedValue) === (mapping.currentX > mapping.completedX)),
      teamBlockGaps,
      teamBlocksSeparated: teamBlockGaps.every((gap) => gap >= 8),
      teamRows: card.querySelectorAll('.suns-team__table tbody tr').length,
      directValues: card.innerText.includes('118.2') && card.innerText.includes('67.8%') && card.innerText.includes('26.5%') && card.innerText.includes('35.3') && card.innerText.includes('21.8'),
      tablesOpen: details.every((node) => node.open),
      tableSummariesOperable: details.every((node) => node.querySelector('summary')?.tabIndex === 0),
      tableSummariesHaveChevron: details.every((node) => getComputedStyle(node.querySelector('summary'), '::before').content !== 'none'),
      sourceLinks: [...card.querySelectorAll('.suns-chart__notes a')].map((node) => new URL(node.href, location.href).pathname),
      identity: getComputedStyle(charts[0]).getPropertyValue('--team-identity').trim(),
      surfaces: charts.map((node) => getComputedStyle(node).backgroundColor),
      widths: charts.map((node) => Math.round(node.getBoundingClientRect().width)),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      cardOverflow: charts.some((node) => node.scrollWidth > node.clientWidth + 1),
      errors: card.querySelectorAll('.suns-chart__status--error').length,
      sunsInJump: [...document.querySelectorAll('#jump option')].some((node) => node.textContent.includes('Phoenix Suns')),
      sunsUpcoming: [...document.querySelectorAll('#upcoming-list li')].some((node) => node.textContent.includes('Phoenix Suns')),
      assetPaths: [...document.querySelectorAll('link[href*="suns-preview-charts"],script[src*="suns-preview-charts"]')].map((node) => new URL(node.href || node.src, location.href).pathname),
    };
    details.forEach((node) => node.open = false);
    return result;
  })()`);
}

async function screenshot(client, selector, name) {
  await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'start' })`);
  await delay(200);
  const clip = await evaluate(client, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip });
  await writeFile(path.join(ARTIFACTS, name), Buffer.from(shot.data, "base64"));
}

const source = await readFile(path.join(ROOT, "2026-27-team-previews.html"), "utf8");
const deployable = await readFile(path.join(ROOT, "dist", "2026-27-team-previews", "index.html"), "utf8");
assert(source === deployable, "Production source and deployable index differ.");
for (const relative of [
  "assets/css/suns-preview-charts.css",
  "assets/js/suns-preview-charts.js",
  "assets/data/processed/suns-green-all-rookie-change.csv",
  "assets/data/processed/suns-green-career.csv",
  "assets/data/processed/suns-booker-career.csv",
  "assets/data/processed/suns-team-defense-rebounding.csv",
  "assets/data/processed/suns-preview-prep.notes.md",
]) {
  const authoringAsset = await readFile(path.join(ROOT, relative), "utf8");
  const deployableAsset = await readFile(path.join(ROOT, "dist", "2026-27-team-previews", relative), "utf8");
  assert(authoringAsset === deployableAsset, `Authoring and deploy-ready assets differ: ${relative}`);
}
assert(/name: "Phoenix Suns",[\s\S]{0,160}?code: "PHX",[\s\S]{0,100}?slug: "suns",[\s\S]{0,80}?powerRank: 21,[\s\S]{0,80}?status: "published",[\s\S]{0,100}?logo: "assets\/img\/teamlogos\/Suns\.png",[\s\S]{0,260}?thesis: "A team that began the decade with a Finals run and a bounty of prospects and picks now faces a bleak decade without much room for growth\. What comes next for the Phoenix Suns\?"/.test(source), "Phoenix ranking, dropdown summary or publication state changed.");
assert((source.match(/data-suns-(?:green|booker|team)-chart/g) || []).length === 3, "Production source does not contain all three Phoenix graphics.");
assert((await readFile(path.join(ROOT, "assets/data/processed/suns-green-all-rookie-change.csv"), "utf8")).trim().split(/\r?\n/).length === 31, "Green cohort CSV does not contain 30 rows.");
assert((await readFile(path.join(ROOT, "assets/data/processed/suns-green-career.csv"), "utf8")).trim().split(/\r?\n/).length === 7, "Green career CSV does not contain 6 rows.");
assert((await readFile(path.join(ROOT, "assets/data/processed/suns-booker-career.csv"), "utf8")).trim().split(/\r?\n/).length === 9, "Booker CSV does not contain 8 rows.");
assert((await readFile(path.join(ROOT, "assets/data/processed/suns-team-defense-rebounding.csv"), "utf8")).trim().split(/\r?\n/).length === 3, "Team CSV does not contain 2 rows.");

await mkdir(ARTIFACTS, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "suns-preview-chrome-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore", windowsHide: true });
let client;
try {
  client = new Client((await target()).webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Network.enable")]);
  const browserErrors = [];
  client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => browserErrors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  client.on("Network.loadingFailed", ({ errorText, canceled }) => { if (!canceled) browserErrors.push(`Network: ${errorText}`); });
  await client.send("Runtime.setAsyncCallStackDepth", { maxDepth: 8 });
  await navigate(client, 1280, 1100);
  const desktop = await inspect(client);
  await screenshot(client, ".suns-team", "team-desktop.png");
  await screenshot(client, ".suns-booker", "booker-desktop.png");
  await screenshot(client, ".suns-green", "green-desktop.png");
  assert(desktop.open && desktop.charts === 3 && desktop.ready && desktop.storyParagraphs === 14 && desktop.transactionItems === 6, "Phoenix card, draft paragraph count or transaction list is incomplete.");
  assert(desktop.packageOrder.join("|") === "intro|team-context|team|booker-context|booker|green-context|green|conclusion", "Phoenix story and chart order is incorrect.");
  assert(desktop.spotifyLink === "https://open.spotify.com/episode/1VjG0TMRI6iCW2YDtBoI1i" && desktop.storyOpening.startsWith("If you wanted to speedrun") && desktop.storyClosing.endsWith("younger, cheaper prospects to rebuild around."), "Phoenix draft text or supplied link is incomplete.");
  assert(desktop.titleTexts.join("|") === "Phoenix’s defensive margin has disappeared|How much of Booker’s peak remains?|Green’s scoring grew. His efficiency didn’t.", "Phoenix reader-facing chart titles changed.");
  assert(desktop.greenGeometry.marks === 30 && desktop.greenGeometry.uniquePlayers === 30 && desktop.greenGeometry.inside && desktop.greenGeometry.entireInside && desktop.greenClipExpected, "Green cohort marks, clipping or plotting bounds are incorrect.");
  assert(desktop.greenGeometry.greenX === 3.7 && desktop.greenGeometry.greenY === -0.3 && desktop.greenTooltipHiddenInitially, "Green coordinates or initial inspection state are incorrect.");
  assert(desktop.greenLabelRoles.join("|") === "green|x-max|x-min|y-max|y-min" && desktop.greenLabelBoundsValid, "Green extrema labels are missing or outside the SVG.");
  assert(desktop.greenKeyboardInspection && desktop.greenTapInspection && desktop.greenCohortRows === 30 && desktop.greenCareerRows === 6, "Green interaction or accessible tables are incomplete.");
  assert(desktop.greenCareerPoints === 5 && desktop.greenCareerLines === 1 && !desktop.greenCurrentInHistory && /87/.test(desktop.greenCurrentSummary) && /49\.9%/.test(desktop.greenCurrentSummary) && /21\.8/.test(desktop.greenCurrentSummary), "Green completed/current separation is incorrect.");
  assert(desktop.bookerPoints === 21 && desktop.bookerLines === 3 && desktop.bookerSeasonTicks === 7 && desktop.bookerGameLabels === 7 && desktop.bookerSeasonRowsAligned && desktop.bookerSvgHeight <= 380 && !desktop.bookerCurrentInHistory && desktop.bookerRows === 8, "Booker career panels, season axis spacing or table are incomplete.");
  assert(/13 games/.test(desktop.bookerCurrentSummary) && /35\.3/.test(desktop.bookerCurrentSummary) && /7\.8/.test(desktop.bookerCurrentSummary) && /105/.test(desktop.bookerCurrentSummary), "Booker current summary is incomplete.");
  assert(desktop.teamTracks === 3 && desktop.teamTrackEndpointsAligned && desktop.teamCompletedMarks === 3 && desktop.teamCurrentMarks === 3 && desktop.teamMappingsIncreasing && desktop.teamBlocksSeparated && desktop.teamRows === 2, "Team paired-dot geometry, panel spacing or table is incomplete.");
  assert(desktop.directValues && desktop.tablesOpen && desktop.tableSummariesOperable && desktop.tableSummariesHaveChevron && desktop.sourceLinks.length === 7, "Direct values, accessible disclosures or source links are incomplete.");
  assert(desktop.identity.toLowerCase() === "#e56020" && desktop.surfaces.every((surface) => surface !== "rgb(255, 255, 255)"), "Phoenix color-policy roles are not applied.");
  assert(!desktop.pageOverflow && !desktop.cardOverflow && desktop.errors === 0, "Desktop overflow or chart error detected.");
  assert(desktop.sunsInJump && !desktop.sunsUpcoming, "Phoenix publication status changed in navigation.");
  assert(desktop.assetPaths.length === 2 && desktop.assetPaths.every((asset) => asset.endsWith(asset.includes("/css/") ? "/assets/css/suns-preview-charts.css" : "/assets/js/suns-preview-charts.js")), "The active page did not load the production Phoenix CSS and JavaScript assets.");

  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(client, `new Promise((resolve) => { dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 450); })`);
  const mobile = await inspect(client);
  await screenshot(client, ".suns-team", "team-mobile.png");
  await screenshot(client, ".suns-booker", "booker-mobile.png");
  await screenshot(client, ".suns-green", "green-mobile.png");
  assert(mobile.open && mobile.ready && mobile.storyParagraphs === 14 && mobile.packageOrder.join("|") === desktop.packageOrder.join("|"), "Mobile rendering lost Phoenix story or chart content.");
  assert(mobile.greenGeometry.marks === 30 && mobile.greenGeometry.uniquePlayers === 30 && mobile.greenGeometry.inside && mobile.greenGeometry.entireInside && mobile.greenGeometry.greenX === 3.7 && mobile.greenGeometry.greenY === -0.3 && mobile.greenTooltipHiddenInitially && mobile.greenLabelBoundsValid && mobile.greenKeyboardInspection && mobile.greenTapInspection, "Mobile Green geometry, labels or interaction failed.");
  assert(mobile.bookerPoints === 21 && mobile.bookerSeasonTicks === 7 && mobile.bookerSeasonRowsAligned && mobile.bookerSvgHeight <= 380 && !mobile.bookerCurrentInHistory && mobile.teamTracks === 3 && mobile.teamTrackEndpointsAligned && mobile.teamMappingsIncreasing && mobile.teamBlocksSeparated, "Mobile Booker or team comparison geometry failed.");
  assert(!mobile.pageOverflow && !mobile.cardOverflow && mobile.errors === 0 && Math.max(...mobile.widths) <= 358, "Mobile charts overflow or entered an error state.");
  assert(mobile.tablesOpen && mobile.tableSummariesOperable && mobile.tableSummariesHaveChevron, "Mobile accessible table disclosures are not operable.");

  const reopen = await evaluate(client, `(async () => {
    const card = document.querySelector('#team-suns');
    card.open = false;
    await new Promise((resolve) => setTimeout(resolve, 80));
    card.open = true;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      charts: card.querySelectorAll('.suns-chart').length,
      svgs: card.querySelectorAll('.suns-chart svg').length,
      ready: [...card.querySelectorAll('.suns-chart')].every((node) => node.dataset.chartReady === 'true'),
      cohortRows: card.querySelectorAll('.suns-green__cohort-table tbody tr').length,
    };
  })()`);
  assert(reopen.charts === 3 && reopen.svgs === 4 && reopen.ready && reopen.cohortRows === 30, "Closing and reopening duplicated or cleared a Phoenix chart.");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log("PASS: Phoenix data, draft, publication state, themes, geometry, tables, reopen behavior, desktop and 390px mobile rendering verified.");
  console.log(JSON.stringify({ desktop, mobile, reopen }, null, 2));
} finally {
  if (client) { await client.send("Browser.close").catch(() => {}); client.close(); }
  chrome.kill();
  await delay(400);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error) => {
    console.warn(`Temporary Chrome profile cleanup deferred: ${error.message}`);
  });
}
