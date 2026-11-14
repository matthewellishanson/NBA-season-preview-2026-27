import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html?preview=pelicans#team-pelicans";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9343;
const ARTIFACTS = path.join(ROOT, "artifacts", "pelicans-preview");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

class Client {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const item = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
      } else (this.listeners.get(message.method) || []).forEach((listener) => listener(message.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) || []), listener]); }
  close() { this.ws.close(); }
}

async function target() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json());
      const page = list.find((item) => item.type === "page");
      if (page) return page;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome target unavailable.");
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function navigate(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
  const loaded = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
  const url = new globalThis.URL(URL);
  url.searchParams.set("_pelicans_verify", String(width));
  await client.send("Page.navigate", { url: url.href });
  await loaded;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await evaluate(client, `(() => {
      const roots = [...document.querySelectorAll('#team-pelicans .pelicans-chart')];
      return roots.length === 3 && roots.every((root) => root.dataset.chartReady === 'true' && root.getAttribute('aria-busy') === 'false');
    })()`);
    if (ready) return;
    await delay(100);
  }
  throw new Error("Pelicans graphics did not become render-ready.");
}

async function inspect(client) {
  return evaluate(client, `(() => {
    const card = document.querySelector('#team-pelicans');
    const charts = [...card.querySelectorAll('.pelicans-chart')];
    const details = [...card.querySelectorAll('.pelicans-chart__table-details')];
    details.forEach((node) => { const summary = node.querySelector('summary'); summary.focus(); summary.click(); });
    const summariesOperable = details.every((node) => node.open) && document.activeElement?.matches('.pelicans-chart__table-toggle');
    const rookieSvgs = [...card.querySelectorAll('.pelicans-rookies__svg')];
    const rookieHits = [...card.querySelectorAll('.pelicans-rookies__hit')];
    const rookieGeometry = rookieSvgs.map((svg) => {
      const [left, right, top, bottom] = svg.dataset.plotBounds.split(',').map(Number);
      const [xMin, xMax] = svg.dataset.xDomain.split(',').map(Number);
      const [yMin, yMax] = svg.dataset.yDomain.split(',').map(Number);
      const marks = [...svg.querySelectorAll('[data-x][data-y]')];
      const svgRect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const plotRect = {
        left: svgRect.left + (left - viewBox.x) * svgRect.width / viewBox.width,
        right: svgRect.left + (right - viewBox.x) * svgRect.width / viewBox.width,
        top: svgRect.top + (top - viewBox.y) * svgRect.height / viewBox.height,
        bottom: svgRect.top + (bottom - viewBox.y) * svgRect.height / viewBox.height,
      };
      return {
        xMin, xMax, yMin, yMax, marks: marks.length,
        inside: marks.every((mark) => {
          const x = Number(mark.dataset.x); const y = Number(mark.dataset.y);
          return x >= left - .01 && x <= right + .01 && y >= top - .01 && y <= bottom + .01;
        }),
        entireInside: marks.every((mark) => {
          const rect = mark.getBoundingClientRect();
          return rect.left >= plotRect.left - .5 && rect.right <= plotRect.right + .5 && rect.top >= plotRect.top - .5 && rect.bottom <= plotRect.bottom + .5;
        }),
      };
    });
    const hit = rookieHits[0];
    hit.focus();
    const rookieAriaBefore = hit.getAttribute('aria-label');
    hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const rookieAriaAfter = hit.getAttribute('aria-label');
    const hitRect = hit.getBoundingClientRect();
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: hitRect.left + hitRect.width / 2, clientY: hitRect.top + hitRect.height / 2 }));
    const rookieTapInspection = hit.closest('.pelicans-rookies__panel').querySelector('.pelicans-rookies__inspection').classList.contains('is-visible');
    hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    hit.blur();
    const onoffLine = card.querySelector('.pelicans-zion__onoff-connector');
    const onoffEndpoints = [...card.querySelectorAll('.pelicans-zion__onoff-endpoint')].map((node) => ({ x: Number(node.dataset.x), y: Number(node.dataset.y) }));
    const careerPlotRect = card.querySelector('.pelicans-zion__career-plot').getBoundingClientRect();
    const currentSummaryRect = card.querySelector('.pelicans-zion__current-summary').getBoundingClientRect();
    const careerSvgText = card.querySelector('.pelicans-zion__career-svg').textContent;
    const rankTrackRects = [...card.querySelectorAll('.pelicans-team__rank-row .pelicans-team__track')].map((track) => track.getBoundingClientRect());
    const styleGeometry = [...card.querySelectorAll('.pelicans-team__style-row')].map((row) => {
      const tracks = [...row.querySelectorAll('.pelicans-team__style-track')];
      const trackRects = tracks.map((track) => track.getBoundingClientRect());
      const points = tracks.map((track) => {
        const marker = track.querySelector('i');
        return { value: Number(marker.dataset.value), x: marker.getBoundingClientRect().left };
      });
      return {
        tracks: tracks.length,
        aligned: trackRects.length === 2 && Math.abs(trackRects[0].left - trackRects[1].left) < .5 && Math.abs(trackRects[0].right - trackRects[1].right) < .5,
        increasing: points.length === 2 && ((points[0].value > points[1].value) === (points[0].x > points[1].x)),
      };
    });
    const result = {
      open: card.open,
      charts: charts.length,
      ready: charts.every((node) => node.dataset.chartReady === 'true'),
      storyParagraphs: card.querySelectorAll('.story--pelicans > p').length,
      packageOrder: [...card.querySelector('.pelicans-preview-package').children].map((node) => node.matches('.story--pelicans-intro') ? 'intro' : node.matches('.pelicans-zion') ? 'zion' : node.matches('.story--pelicans-team-context') ? 'team-context' : node.matches('.pelicans-team') ? 'team' : node.matches('.story--pelicans-rookie-context') ? 'rookie-context' : node.matches('.pelicans-rookies') ? 'rookies' : node.matches('.story--pelicans-conclusion') ? 'conclusion' : node.matches('.story--pelicans-final') ? 'final' : 'unknown'),
      conditioningLink: card.querySelector('.story--pelicans a[href*="zion-williamsons-conditioning"]')?.href || '',
      storyOpening: card.querySelector('.story--pelicans-intro p')?.textContent.trim() || '',
      storyClosing: card.querySelector('.story--pelicans-final p:last-child')?.textContent.trim() || '',
      rookiePanels: card.querySelectorAll('.pelicans-rookies__panel svg').length,
      rookiePeers: card.querySelectorAll('.pelicans-rookies__peer').length,
      rookieFeatured: card.querySelectorAll('.pelicans-rookies__featured').length,
      rookieLabels: card.querySelectorAll('.pelicans-rookies__direct-label').length,
      rookieClipPaths: card.querySelectorAll('.pelicans-rookies clipPath').length,
      rookieInspectionTargets: rookieHits.length,
      rookieInspectionMoved: rookieAriaBefore !== rookieAriaAfter,
      rookieTapInspection,
      rookieGeometry,
      rookieTableRows: card.querySelectorAll('.pelicans-rookies tbody tr').length,
      zionSvgs: card.querySelectorAll('.pelicans-zion svg').length,
      zionPoints: card.querySelectorAll('.pelicans-zion__career-point').length,
      zionAbsenceBands: card.querySelectorAll('.pelicans-zion__absence-band').length,
      zionCurrentBands: card.querySelectorAll('.pelicans-zion__current-band').length,
      zionSeasonTicks: card.querySelectorAll('.pelicans-zion__season-axis .tick').length,
      zionRenderedMissedYear: /2021|21.22/.test(careerSvgText),
      zionRenderedCurrentYear: careerSvgText.includes('2026') || careerSvgText.includes('26–27'),
      zionGameLabels: card.querySelectorAll('.pelicans-zion__games-label').length,
      zionThirtyGameLabel: [...card.querySelectorAll('.pelicans-zion__season-axis .tick')].some((tick) => /(?:2024|24).25/.test(tick.textContent) && /30 G/.test(tick.textContent)),
      zionCompletedLines: card.querySelectorAll('.pelicans-zion__career-line--completed').length,
      zionCurrentLines: card.querySelectorAll('.pelicans-zion__career-line--current').length,
      zionLegendEntries: card.querySelectorAll('.pelicans-zion__legend > span').length,
      zionCurrentPoints: card.querySelectorAll('.pelicans-zion__career-point.is-current').length,
      zionCurrentSummaryValues: card.querySelectorAll('.pelicans-zion__current-values p').length,
      zionCurrentSummaryText: card.querySelector('.pelicans-zion__current-summary').innerText,
      zionCurrentSummaryPlacement: innerWidth <= 760 ? currentSummaryRect.top >= careerPlotRect.bottom - 1 : currentSummaryRect.left >= careerPlotRect.right - 1,
      zionPlayedAxisTitle: /Played seasons/.test(careerSvgText),
      zionOnOffMarks: card.querySelectorAll('.pelicans-zion__onoff-mark').length,
      zionOnOffAligned: onoffEndpoints.length === 2 && onoffEndpoints.every((point) => Math.abs(point.y - Number(onoffLine.getAttribute('y1'))) < .01) && Math.abs(Number(onoffLine.getAttribute('y1')) - Number(onoffLine.getAttribute('y2'))) < .01 && Math.abs(Number(onoffLine.getAttribute('x1')) - onoffEndpoints[0].x) < .01 && Math.abs(Number(onoffLine.getAttribute('x2')) - onoffEndpoints[1].x) < .01,
      zionDifferenceLabel: /15\.0-point offensive-rating difference/.test(card.querySelector('.pelicans-zion__onoff-svg').textContent),
      zionOnOffLabels: [...card.querySelectorAll('.pelicans-zion__onoff-label')].map((node) => node.textContent),
      zionOnOffDefinition: /team points per 100 possessions/.test(card.querySelector('.pelicans-zion__onoff-section').innerText),
      zionTableRows: card.querySelectorAll('.pelicans-zion tbody tr').length,
      teamRankRows: card.querySelectorAll('.pelicans-team__rank-row').length,
      teamRankTracks: card.querySelectorAll('.pelicans-team__rank-row > .pelicans-team__rank-geometry .pelicans-team__track').length,
      teamRankMarkers: card.querySelectorAll('.pelicans-team__rank-marker').length,
      teamRankTracksAligned: rankTrackRects.length === 4 && rankTrackRects.every((rect) => Math.abs(rect.left - rankTrackRects[0].left) < .5 && Math.abs(rect.right - rankTrackRects[0].right) < .5),
      teamStyleRows: card.querySelectorAll('.pelicans-team__style-row').length,
      teamStyleSeasons: card.querySelectorAll('.pelicans-team__style-season').length,
      styleGeometry,
      teamRankNote: /better rank does not necessarily mean a better raw result/.test(card.innerText),
      oldVolumeRankText: /26th-most|5th-fewest/.test(card.querySelector('.pelicans-team__style-rows').innerText),
      styleUnits: [...card.querySelectorAll('.pelicans-team__style-row > header p')].map((node) => node.textContent.trim()),
      teamTableRows: card.querySelectorAll('.pelicans-team tbody tr').length,
      tablesOpen: details.every((node) => node.open),
      focusedSummary: summariesOperable || false,
      identity: getComputedStyle(charts[0]).getPropertyValue('--team-identity').trim(),
      surface: getComputedStyle(charts[0]).backgroundColor,
      widths: charts.map((node) => Math.round(node.getBoundingClientRect().width)),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      cardOverflow: charts.some((node) => node.scrollWidth > node.clientWidth + 1),
      errors: card.querySelectorAll('.pelicans-chart__status--error').length,
      currentInText: /119\.2/.test(card.innerText) && /104\.2/.test(card.innerText) && /60\.6%/.test(card.innerText) && card.innerText.includes('36.7 FTA'),
      pelicansInJump: [...document.querySelectorAll('#jump option')].some((node) => node.textContent.includes('New Orleans Pelicans')),
      pelicansUpcoming: [...document.querySelectorAll('#upcoming-list li')].some((node) => node.textContent.includes('New Orleans Pelicans')),
      titleTexts: [...card.querySelectorAll('.pelicans-chart__title')].map((node) => node.textContent.trim()),
      assetPaths: [...document.querySelectorAll('link[href*="pelicans-preview-charts"],script[src*="pelicans-preview-charts"]')].map((node) => new URL(node.href || node.src, location.href).pathname),
    };
    details.forEach((node) => node.open = false);
    return result;
  })()`);
}

async function screenshot(client, selector, name) {
  await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);
  await delay(250);
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
assert(/name: "New Orleans Pelicans",[\s\S]{0,180}?slug: "pelicans",[\s\S]{0,80}?powerRank: 26,[\s\S]{0,80}?status: "published",[\s\S]{0,120}?logo: "assets\/img\/teamlogos\/pelicans-logo-transparent\.png",[\s\S]{0,220}?thesis: "Seven years into the Zion Williamson rebuild, the Pelicans remain as adrift as ever and in need of a shakeup\."/.test(source), "Pelicans rank, publication state or dropdown summary changed.");
assert((source.match(/data-pelicans-(?:rookie|zion|team)-chart/g) || []).length === 3, "Production source does not contain all three Pelicans graphics.");

await mkdir(ARTIFACTS, { recursive: true });
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(ARTIFACTS, `profile-${process.pid}`)}`, "about:blank",
], { stdio: "ignore", windowsHide: true });
let client;
try {
  client = new Client((await target()).webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Network.enable")]);
  const browserErrors = [];
  client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => browserErrors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  client.on("Network.loadingFailed", ({ errorText, canceled }) => { if (!canceled) browserErrors.push(`Network: ${errorText}`); });

  await navigate(client, 1280, 1100);
  const desktop = await inspect(client);
  await screenshot(client, ".pelicans-rookies", "rookies-desktop.png");
  await screenshot(client, ".pelicans-zion", "zion-desktop.png");
  await screenshot(client, ".pelicans-team", "team-desktop.png");
  assert(desktop.open && desktop.charts === 3 && desktop.ready && desktop.storyParagraphs === 15, "Pelicans card structure, story count or ready state is incorrect.");
  assert(desktop.packageOrder.join('|') === 'intro|zion|team-context|rookie-context|rookies|conclusion|team|final', "Pelicans story and chart sections are not in their intended editorial order.");
  assert(desktop.conditioningLink.startsWith('https://www.nola.com/') && desktop.storyOpening.startsWith('Like fellow struggling teams Brooklyn and Sacramento') && desktop.storyClosing.endsWith('a painful Zion and/or Murphy trade this season.'), "Pelicans story text or supplied conditioning link is incomplete.");
  assert(desktop.rookiePanels === 2 && desktop.rookiePeers === 272 && desktop.rookieFeatured === 4 && desktop.rookieLabels === 4 && desktop.rookieTableRows === 138, "Rookie scatterplots or full data table are incomplete.");
  assert(desktop.rookieClipPaths === 2 && desktop.rookieInspectionTargets === 2 && desktop.rookieInspectionMoved && desktop.rookieTapInspection, "Rookie plot clipping or keyboard/tap peer inspection is missing.");
  assert(desktop.rookieGeometry.length === 2 && desktop.rookieGeometry.every((panel) => panel.marks === 138 && panel.inside && panel.entireInside), "A rookie mark is outside its valid plotting rectangle.");
  assert(desktop.rookieGeometry[0].xMin < 5.3 && desktop.rookieGeometry[0].xMax > 34.3 && desktop.rookieGeometry[0].yMin < .399 && desktop.rookieGeometry[0].yMax > .762, "Rookie scoring domains do not include the complete cohort with padding.");
  assert(desktop.rookieGeometry[1].xMin < .8 && desktop.rookieGeometry[1].xMax > 12.7 && desktop.rookieGeometry[1].yMin < .8 && desktop.rookieGeometry[1].yMax > 5.9, "Rookie assists/turnovers domains do not include the complete cohort with padding.");
  assert(desktop.zionSvgs === 2 && desktop.zionPoints === 18 && desktop.zionAbsenceBands === 0 && desktop.zionCurrentBands === 0 && desktop.zionOnOffMarks === 2 && desktop.zionTableRows === 8, "Zion career or on/off package is incomplete.");
  assert(desktop.zionSeasonTicks === 6 && !desktop.zionRenderedMissedYear && !desktop.zionRenderedCurrentYear && desktop.zionGameLabels === 6 && desktop.zionThirtyGameLabel && desktop.zionPlayedAxisTitle, "Zion's completed played-season axis or game labels are incorrect.");
  assert(desktop.zionCompletedLines === 3 && desktop.zionCurrentLines === 0 && desktop.zionCurrentPoints === 0 && desktop.zionLegendEntries === 0, "Zion's current snapshot remains encoded inside the historical plot.");
  assert(desktop.zionCurrentSummaryValues === 3 && desktop.zionCurrentSummaryPlacement && /2026.27 · 11 games/.test(desktop.zionCurrentSummaryText) && /22\.8%/.test(desktop.zionCurrentSummaryText) && /3\.8/.test(desktop.zionCurrentSummaryText) && /69\.1%/.test(desktop.zionCurrentSummaryText), "Zion's separate current-season summary is incomplete or misplaced.");
  assert(desktop.zionOnOffAligned && desktop.zionDifferenceLabel && desktop.zionOnOffDefinition && desktop.zionOnOffLabels.includes('Off court: 104.2 · 231 minutes') && desktop.zionOnOffLabels.includes('On court: 119.2 · 360 minutes'), "Zion's self-contained dumbbell encoding is incomplete.");
  assert(desktop.teamRankRows === 4 && desktop.teamRankTracks === 4 && desktop.teamRankMarkers === 8 && desktop.teamRankTracksAligned && desktop.teamStyleRows === 2 && desktop.teamStyleSeasons === 4 && desktop.teamTableRows === 2, "Team comparison structure or shared rank geometry is incomplete.");
  assert(desktop.styleGeometry.length === 2 && desktop.styleGeometry.every((metric) => metric.tracks === 2 && metric.aligned && metric.increasing), "Team style comparisons do not share aligned 0-40 geometry or preserve value order.");
  assert(desktop.teamRankNote && !desktop.oldVolumeRankText && desktop.styleUnits.join('|') === 'Share of field-goal attempts|FTA per 100 FGA', "Team rank caveat, style units or simplified volume labels are incorrect.");
  assert(desktop.tablesOpen && desktop.focusedSummary && desktop.currentInText, "Accessible disclosures, keyboard focus or direct values are incomplete.");
  assert(desktop.identity.toLowerCase() === "#b4975a" && desktop.surface !== "rgb(255, 255, 255)", "Pelicans theme roles are not applied.");
  assert(!desktop.pageOverflow && !desktop.cardOverflow && desktop.errors === 0, "Desktop overflow or chart error detected.");
  assert(desktop.pelicansInJump && !desktop.pelicansUpcoming, "Pelicans publication state changed in navigation.");
  assert(desktop.assetPaths.length === 2 && desktop.assetPaths.every((asset) => asset.endsWith(asset.includes('/css/') ? '/assets/css/pelicans-preview-charts.css' : '/assets/js/pelicans-preview-charts.js')), "The active page did not load the production Pelicans CSS and JavaScript assets.");
  assert(desktop.titleTexts.join("|") === "Zion’s role has shrunk. His efficiency hasn’t.|Two promising rookies, different development questions|Little perimeter volume, little defensive margin", "Reader-facing chart titles changed.");

  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(client, `new Promise((resolve) => { dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 400); })`);
  const mobile = await inspect(client);
  await screenshot(client, ".pelicans-rookies", "rookies-mobile.png");
  await screenshot(client, ".pelicans-zion", "zion-mobile.png");
  await screenshot(client, ".pelicans-team", "team-mobile.png");
  assert(mobile.open && mobile.ready && mobile.storyParagraphs === 15 && mobile.packageOrder.join('|') === 'intro|zion|team-context|rookie-context|rookies|conclusion|team|final' && mobile.rookiePanels === 2 && mobile.zionPoints === 18 && mobile.teamRankRows === 4, "Mobile rendering lost story or chart content.");
  assert(mobile.rookieGeometry.every((panel) => panel.inside && panel.entireInside) && mobile.rookieTapInspection && mobile.styleGeometry.every((metric) => metric.aligned && metric.increasing) && mobile.teamRankTracksAligned && mobile.zionOnOffAligned && mobile.zionCurrentSummaryPlacement, "Mobile chart geometry, summary placement or tap inspection changed or left valid plotting bounds.");
  assert(!mobile.pageOverflow && !mobile.cardOverflow && mobile.errors === 0 && Math.max(...mobile.widths) <= 358, "Mobile charts overflow or entered an error state.");
  assert(mobile.tablesOpen && mobile.focusedSummary, "Mobile table disclosures are not keyboard operable.");

  const reopen = await evaluate(client, `(() => {
    const card = document.querySelector('#team-pelicans');
    card.open = false; card.open = true;
    return {
      charts: card.querySelectorAll('.pelicans-chart').length,
      svgs: card.querySelectorAll('svg').length,
      ready: [...card.querySelectorAll('.pelicans-chart')].every((node) => node.dataset.chartReady === 'true'),
      rookieRows: card.querySelectorAll('.pelicans-rookies tbody tr').length,
    };
  })()`);
  assert(reopen.charts === 3 && reopen.svgs === 4 && reopen.ready && reopen.rookieRows === 138, "Closing and reopening duplicated or cleared a chart.");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log("PASS: Pelicans data, publication state, theme, tables, reopen behavior, desktop and 390px mobile rendering verified.");
  console.log(JSON.stringify({ desktop, mobile, reopen }, null, 2));
} finally {
  if (client) { await client.send("Browser.close").catch(() => {}); client.close(); }
  chrome.kill();
}
