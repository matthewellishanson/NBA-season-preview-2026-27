import fs from "node:fs/promises";

const pageUrl = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html";
const outputPrefix = process.argv[3] || "artifacts/publication";
const debugPort = process.env.CHROME_DEBUG_PORT || "9222";

const target = await fetch(`http://localhost:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const failures = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Network.loadingFailed") failures.push(message.params.errorText);
  if (message.method === "Runtime.exceptionThrown") failures.push(message.params.exceptionDetails.text);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

const waitFor = async (expression, timeout = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
};

await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Network.enable")]);
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: pageUrl });
await waitFor(`document.readyState === "complete" && document.querySelectorAll(".team-card").length === 16`);

const initial = await evaluate(`(() => ({
  title: document.title,
  completion: document.querySelector("#completion-count")?.textContent,
  cards: document.querySelectorAll(".team-card").length,
  rankings: document.querySelectorAll("#team-links > li").length,
  completedLinks: document.querySelectorAll("#team-links a[href^='#team-']").length,
  upcoming: document.querySelectorAll("#upcoming-list > li").length,
  logos: [...document.querySelectorAll(".team-logo")].map((img) => ({ src: img.getAttribute("src"), loaded: img.complete && img.naturalWidth > 0 })),
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  draftLanguage: /design prototype|prototype for editorial review|dataset and chart pending|this space will hold/i.test(document.body.innerText),
  ranks: [...document.querySelectorAll("#team-links .num")].map((node) => Number(node.textContent)),
}))()`);

await evaluate(`document.querySelectorAll(".team-card").forEach((card) => { card.open = true; })`);
await new Promise((resolve) => setTimeout(resolve, 3500));
const expanded = await evaluate(`(() => ({
  openCards: document.querySelectorAll(".team-card[open]").length,
  charts: document.querySelectorAll(".team-graphic svg, .team-history-chart svg, .jokic-on-off svg, .wemby-unicorn svg, .celtics-wings svg, .duren-comparison svg, .edey-package svg, .kawhi-production svg, .kessler-chart svg, .holmgren-chart svg, .garland-chart svg, .magic-on-off[data-chart-mounted='true']").length,
  chartErrors: [...document.querySelectorAll("[class*='status--error']")].filter((node) => !node.closest("noscript")).map((node) => node.textContent.trim()),
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))()`);

const magic = await evaluate(`(() => {
  const root = document.querySelector("#team-magic .magic-on-off");
  const rows = [...root.querySelectorAll(".magic-on-off__row")];
  return {
    mounted: root.dataset.chartMounted,
    groups: rows.map((row) => row.querySelector(".magic-on-off__group")?.textContent.trim()),
    minutes: rows.map((row) => Number(row.querySelector(".magic-on-off__minutes")?.textContent.replace(/,/g, ""))),
    nets: rows.map((row) => row.querySelector(".magic-on-off__net")?.textContent.trim()),
    tableRows: root.querySelectorAll(".magic-on-off__table tbody tr").length,
    sourceColumns: root.querySelectorAll(".magic-on-off__table thead th").length,
    layoutColumns: getComputedStyle(root.closest(".story-layout")).gridTemplateColumns,
    chartWidth: Math.round(root.getBoundingClientRect().width),
  };
})()`);

const pacers = await evaluate(`(() => {
  const root = document.querySelector("#team-pacers .siakam-chart");
  const tableRows = [...root.querySelectorAll(".siakam-chart__table tbody tr")];
  return {
    mounted: root.dataset.chartMounted,
    panels: root.querySelectorAll(".siakam-chart__panel svg").length,
    seasons: tableRows.map((row) => row.cells[0].textContent.trim()),
    teams: tableRows.map((row) => row.cells[1].textContent.trim()),
    points: tableRows.map((row) => row.cells[2].textContent.trim()),
    trueShooting: tableRows.map((row) => row.cells[3].textContent.trim()),
    games: tableRows.map((row) => Number(row.cells[4].textContent.trim())),
    mpg: tableRows.map((row) => row.cells[5].textContent.trim()),
    chartWidth: Math.round(root.getBoundingClientRect().width),
  };
})()`);

const desktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-desktop.png`, Buffer.from(desktopShot.data, "base64"));

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evaluate(`scrollTo(0, 0)`);
await new Promise((resolve) => setTimeout(resolve, 500));
const mobile = await evaluate(`(() => ({
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  viewport: document.documentElement.clientWidth,
  pageWidth: document.documentElement.scrollWidth,
  mobileRankingsVisible: getComputedStyle(document.querySelector(".mobile-rankings")).display !== "none",
}))()`);
const mobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-mobile.png`, Buffer.from(mobileShot.data, "base64"));

await evaluate(`document.querySelectorAll(".team-card").forEach((card) => { card.open = false; }); location.hash = "#team-magic"`);
await waitFor(`document.querySelector("#team-magic")?.open === true`);
await new Promise((resolve) => setTimeout(resolve, 800));
const hashNavigation = await evaluate(`(() => {
  const target = document.querySelector("#team-magic");
  return { hash: location.hash, open: target.open, distanceFromTop: Math.round(Math.abs(target.getBoundingClientRect().top)) };
})()`);

await evaluate(`document.documentElement.style.scrollBehavior = "auto"; document.querySelector("#team-magic .magic-on-off")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 350));
const magicMobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-magic-mobile.png`, Buffer.from(magicMobileShot.data, "base64"));

await evaluate(`document.querySelector("#team-pacers").open = true; document.querySelector("#team-pacers .siakam-chart")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 350));
const pacersMobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-pacers-mobile.png`, Buffer.from(pacersMobileShot.data, "base64"));

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await evaluate(`document.querySelector("#team-magic .magic-on-off")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const magicDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-magic-desktop.png`, Buffer.from(magicDesktopShot.data, "base64"));
await evaluate(`document.querySelector("#team-pacers").open = true; document.querySelector("#team-pacers .siakam-chart")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const pacersDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-pacers-desktop.png`, Buffer.from(pacersDesktopShot.data, "base64"));
await evaluate(`document.querySelector(".team-card").open = false; document.querySelector(".team-card > summary").focus()`);
const keyboardControl = await evaluate(`(() => {
  const summary = document.querySelector(".team-card > summary");
  return { tag: summary.tagName, focused: document.activeElement === summary, tabIndex: summary.tabIndex };
})()`);

const report = { pageUrl, initial, expanded, magic, pacers, mobile, hashNavigation, keyboardControl, failures };
console.log(JSON.stringify(report, null, 2));

const expectedRanks = Array.from({ length: 30 }, (_, index) => index + 1);
const passed = initial.cards === 16
  && initial.rankings === 30
  && initial.completedLinks === 16
  && initial.upcoming === 14
  && initial.logos.every((logo) => logo.loaded)
  && JSON.stringify(initial.ranks) === JSON.stringify(expectedRanks)
  && !initial.draftLanguage
  && !initial.horizontalOverflow
  && expanded.openCards === 16
  && expanded.charts >= 18
  && expanded.chartErrors.length === 0
  && !expanded.horizontalOverflow
  && magic.mounted === "true"
  && JSON.stringify(magic.groups) === JSON.stringify(["Both playing", "Banchero only", "Wagner only", "Neither playing"])
  && magic.minutes.reduce((total, value) => total + value, 0) === 10797
  && JSON.stringify(magic.nets) === JSON.stringify(["+1.95", "−6.45", "+7.06", "+0.50"])
  && magic.tableRows === 4
  && magic.sourceColumns === 9
  && magic.chartWidth >= 700
  && pacers.mounted === "true"
  && pacers.panels === 3
  && JSON.stringify(pacers.seasons) === JSON.stringify(["2023-24", "2024-25", "2025-26"])
  && JSON.stringify(pacers.teams) === JSON.stringify(["TOR/IND", "IND", "IND"])
  && JSON.stringify(pacers.points) === JSON.stringify(["31.2", "29.8", "34.3"])
  && JSON.stringify(pacers.trueShooting) === JSON.stringify(["60.1%", "59.9%", "56.2%"])
  && JSON.stringify(pacers.games) === JSON.stringify([80, 78, 62])
  && JSON.stringify(pacers.mpg) === JSON.stringify(["33.2", "32.7", "33.2"])
  && pacers.chartWidth >= 700
  && !mobile.horizontalOverflow
  && mobile.mobileRankingsVisible
  && hashNavigation.hash === "#team-magic"
  && hashNavigation.open
  && hashNavigation.distanceFromTop < 160
  && keyboardControl.tag === "SUMMARY"
  && keyboardControl.focused
  && keyboardControl.tabIndex === 0
  && failures.length === 0;

socket.close();
if (!passed) process.exitCode = 1;
