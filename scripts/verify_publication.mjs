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
await waitFor(`document.readyState === "complete" && document.querySelectorAll(".team-card").length === 24`);

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

const hawks = await evaluate(`(() => {
  const root = document.querySelector("#team-hawks .hawks-stars");
  const rows = [...root.querySelectorAll(".hawks-stars__table tbody tr")];
  return {
    panels: root.querySelectorAll(".hawks-stars__panel svg").length,
    marks: root.querySelectorAll(".hawks-stars__mark").length,
    latestMarks: root.querySelectorAll(".hawks-stars__mark.is-latest").length,
    players: root.querySelectorAll(".hawks-stars__player").length,
    tableRows: rows.length,
    johnson2024Games: Number(rows[1]?.cells[3]?.textContent),
    nawTeams: rows.slice(3).map((row) => row.cells[2].textContent.trim()),
    points: rows.map((row) => row.cells[5].textContent.trim()),
    assists: rows.slice(0, 3).map((row) => row.cells[6].textContent.trim()),
    trueShooting: rows.slice(3).map((row) => row.cells[7].textContent.trim()),
    sharedPointsDomains: [...root.querySelectorAll(".hawks-stars__player")].map((player) => player.querySelector(".hawks-stars__panel svg")?.getAttribute("viewBox")),
    chartWidth: Math.round(root.getBoundingClientRect().width),
  };
})()`);

const cleveland = await evaluate(`(() => {
  const root = document.querySelector("#team-cavaliers .watson-chart");
  const rows = [...root.querySelectorAll(".watson-chart__table tbody tr")];
  const style = getComputedStyle(root);
  return {
    initialized: root.dataset.watsonInitialized,
    panels: root.querySelectorAll(".watson-chart__panel svg").length,
    marks: root.querySelectorAll(".watson-chart__mark").length,
    latestMarks: root.querySelectorAll(".watson-chart__mark.is-latest").length,
    directValues: [...root.querySelectorAll(".watson-chart__value")].map((node) => node.textContent.trim()),
    tableRows: rows.length,
    games: rows.map((row) => Number(row.cells[1].textContent)),
    minutes: rows.map((row) => Number(row.cells[2].textContent.replace(/,/g, ""))),
    points: rows.map((row) => row.cells[4].textContent.trim()),
    usage: rows.map((row) => row.cells[5].textContent.trim()),
    trueShooting: rows.map((row) => row.cells[6].textContent.trim()),
    chartWidth: Math.round(root.getBoundingClientRect().width),
    identity: style.getPropertyValue("--team-identity").trim(),
    surface: style.getPropertyValue("--team-surface").trim(),
    introParagraphs: root.previousElementSibling?.querySelectorAll(":scope > p").length,
    continuationParagraphs: root.nextElementSibling?.querySelectorAll(":scope > p").length,
    hasHistoricalPlaceholder: /historical comparison|chart pending/i.test(root.closest(".team-body")?.innerText || ""),
  };
})()`);

const jazz = await evaluate(`(() => {
  const card = document.querySelector("#team-jazz");
  const george = card.querySelector("[data-jazz-george-chart]");
  const rebounds = card.querySelector("[data-jazz-rebounding-chart]");
  const georgeRows = [...george.querySelectorAll("tbody tr")];
  const reboundRows = [...rebounds.querySelectorAll("tbody tr")];
  const storyArticles = [...card.querySelectorAll(".story--jazz")];
  const storyText = storyArticles.flatMap((article) => [...article.querySelectorAll(":scope > p")].map((p) => p.textContent));
  const style = getComputedStyle(george);
  return {
    georgePanels: george.querySelectorAll(".jazz-chart__panel svg").length,
    georgeMarks: george.querySelectorAll(".jazz-chart__mark").length,
    georgeLatest: george.querySelectorAll(".jazz-chart__mark.is-latest").length,
    georgeValues: georgeRows.map((row) => [row.cells[5].textContent.trim(), row.cells[6].textContent.trim(), row.cells[7].textContent.trim()]),
    reboundPanels: rebounds.querySelectorAll(".jazz-chart__panel svg").length,
    reboundMarks: rebounds.querySelectorAll(".jazz-chart__mark").length,
    reboundSeriesLabels: [...rebounds.querySelectorAll(".jazz-chart__series-label")].map((node) => node.textContent.trim()),
    reboundValues: reboundRows.map((row) => [row.cells[5].textContent.trim(), row.cells[6].textContent.trim()]),
    combinedLabel: reboundRows.at(-1).cells[2].textContent.trim(),
    storyParagraphs: storyText.length,
    storyGroups: storyArticles.map((article) => article.querySelectorAll(":scope > p").length),
    georgePlacement: storyArticles[0].nextElementSibling === george && george.nextElementSibling === storyArticles[1],
    reboundPlacement: storyArticles[1].nextElementSibling === rebounds && rebounds.nextElementSibling === storyArticles[2],
    correctedTypos: storyText.some((text) => text.includes("fadeaway after fadeaway, then tell me you don’t see")) && !storyText.some((text) => /fadeway|then tell you don.t see/.test(text)),
    identity: style.getPropertyValue("--team-identity").trim(),
    surface: style.getPropertyValue("--team-surface").trim(),
    georgeWidth: Math.round(george.getBoundingClientRect().width),
    reboundWidth: Math.round(rebounds.getBoundingClientRect().width),
  };
})()`);

const warriors = await evaluate(`(() => {
  const card = document.querySelector("#team-warriors");
  const root = card.querySelector("[data-curry-warriors-chart]");
  const rows = [...root.querySelectorAll(".curry-chart__table tbody tr")];
  const omittedRow = root.querySelector(".curry-chart__table tr.is-ratings-omitted");
  const panels = [...root.querySelectorAll(".curry-chart__panel")];
  const style = getComputedStyle(root);
  const storyArticles = [...card.querySelectorAll(".story--warriors")];
  return {
    mounted: root.dataset.chartMounted,
    svgs: root.querySelectorAll("svg").length,
    linePaths: root.querySelectorAll(".curry-chart__line").length,
    marks: root.querySelectorAll(".curry-chart__season-mark").length,
    bars: root.querySelectorAll(".curry-chart__minutes-bar").length,
    panelBars: panels.map((panel) => panel.querySelectorAll(".curry-chart__minutes-bar").length),
    panelSeasons: panels.map((panel) => [...panel.querySelectorAll(".curry-chart__season")].map((node) => node.textContent.trim())),
    panelSpacing: panels.map((panel) => {
      const positions = [...panel.querySelectorAll(".curry-chart__season")].map((node) => Number(node.getAttribute("x")));
      return positions.length > 1 ? positions[1] - positions[0] : 0;
    }),
    panelWidths: panels.map((panel) => Math.round(panel.getBoundingClientRect().width)),
    zeroLines: panels.map((panel) => Number(panel.querySelector(".curry-chart__zero")?.getAttribute("y1"))),
    rows: rows.length,
    seasons: rows.map((row) => row.cells[0].textContent.trim()),
    relative: rows.filter((row) => row.classList.contains("is-ratings-observed")).map((row) => [row.cells[4].textContent.trim(), row.cells[5].textContent.trim(), row.cells[6].textContent.trim()]),
    onMinutes: rows.map((row) => Number(row.cells[7].textContent.replace(/,/g, ""))),
    omittedCells: omittedRow ? [...omittedRow.cells].map((cell) => cell.textContent.trim()) : [],
    sampleNote: root.querySelector(".curry-chart__sample-note")?.textContent.trim(),
    interpretation: root.querySelector(".curry-chart__reading")?.textContent.trim(),
    methodology: root.querySelector(".curry-chart__methodology")?.textContent.trim(),
    storyGroups: storyArticles.map((article) => article.querySelectorAll(":scope > p").length),
    placement: storyArticles[0].nextElementSibling === root && root.nextElementSibling === storyArticles[1],
    identity: style.getPropertyValue("--team-identity").trim(),
    secondary: style.getPropertyValue("--team-secondary").trim(),
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
  hawksChartWidth: Math.round(document.querySelector("#team-hawks .hawks-stars").getBoundingClientRect().width),
  hawksPanelColumns: getComputedStyle(document.querySelector("#team-hawks .hawks-stars__panel-grid")).gridTemplateColumns.split(" ").length,
  clevelandChartWidth: Math.round(document.querySelector("#team-cavaliers .watson-chart").getBoundingClientRect().width),
  clevelandPanelColumns: getComputedStyle(document.querySelector("#team-cavaliers .watson-chart__panels")).gridTemplateColumns.split(" ").length,
  clevelandTableContained: document.querySelector("#team-cavaliers .watson-chart__table-wrap").scrollWidth > document.querySelector("#team-cavaliers .watson-chart__table-wrap").clientWidth,
  jazzGeorgeWidth: Math.round(document.querySelector("#team-jazz [data-jazz-george-chart]").getBoundingClientRect().width),
  jazzGeorgeColumns: getComputedStyle(document.querySelector("#team-jazz .jazz-chart__panels--three")).gridTemplateColumns.split(" ").length,
  jazzReboundWidth: Math.round(document.querySelector("#team-jazz [data-jazz-rebounding-chart]").getBoundingClientRect().width),
  jazzReboundColumns: getComputedStyle(document.querySelector("#team-jazz .jazz-chart__panels--two")).gridTemplateColumns.split(" ").length,
  jazzTableContained: [...document.querySelectorAll("#team-jazz .jazz-chart__table-wrap")].every((wrap) => wrap.scrollWidth > wrap.clientWidth),
  warriorsChartWidth: Math.round(document.querySelector("#team-warriors .curry-chart").getBoundingClientRect().width),
  warriorsTableContained: document.querySelector("#team-warriors .curry-chart__table-wrap").scrollWidth > document.querySelector("#team-warriors .curry-chart__table-wrap").clientWidth,
  warriorsPanelColumns: getComputedStyle(document.querySelector("#team-warriors .curry-chart__panels")).gridTemplateColumns.split(" ").length,
  warriorsPanelSeasons: [...document.querySelectorAll("#team-warriors .curry-chart__panel")].map((panel) => panel.querySelectorAll(".curry-chart__season").length),
}))()`);
const mobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-mobile.png`, Buffer.from(mobileShot.data, "base64"));

await evaluate(`document.querySelectorAll(".team-card").forEach((card) => { card.open = false; }); location.hash = "#team-magic"`);
await waitFor(`document.querySelector("#team-magic")?.open === true`);
await new Promise((resolve) => setTimeout(resolve, 1800));
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
await evaluate(`document.querySelector("#team-hawks").open = true; document.querySelector("#team-hawks .hawks-stars")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 350));
const hawksMobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-hawks-mobile.png`, Buffer.from(hawksMobileShot.data, "base64"));
await evaluate(`document.querySelector("#team-cavaliers").open = true; document.querySelector("#team-cavaliers .watson-chart")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 350));
const clevelandMobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-cleveland-mobile.png`, Buffer.from(clevelandMobileShot.data, "base64"));
await evaluate(`document.querySelector("#team-jazz").open = true; document.querySelector("#team-jazz [data-jazz-george-chart]")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 350));
const jazzGeorgeMobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-jazz-george-mobile.png`, Buffer.from(jazzGeorgeMobileShot.data, "base64"));
await evaluate(`document.querySelector("#team-jazz [data-jazz-rebounding-chart]")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 350));
const jazzReboundMobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-jazz-rebounding-mobile.png`, Buffer.from(jazzReboundMobileShot.data, "base64"));
await evaluate(`document.querySelector("#team-warriors").open = true; document.querySelector("#team-warriors .curry-chart")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const warriorsMobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-warriors-mobile.png`, Buffer.from(warriorsMobileShot.data, "base64"));

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await evaluate(`document.querySelector("#team-magic .magic-on-off")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const magicDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-magic-desktop.png`, Buffer.from(magicDesktopShot.data, "base64"));
await evaluate(`document.querySelector("#team-pacers").open = true; document.querySelector("#team-pacers .siakam-chart")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const pacersDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-pacers-desktop.png`, Buffer.from(pacersDesktopShot.data, "base64"));
await evaluate(`document.querySelector("#team-hawks").open = true; document.querySelector("#team-hawks .hawks-stars")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const hawksDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-hawks-desktop.png`, Buffer.from(hawksDesktopShot.data, "base64"));
await evaluate(`document.querySelector("#team-cavaliers").open = true; document.querySelector("#team-cavaliers .watson-chart")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const clevelandDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-cleveland-desktop.png`, Buffer.from(clevelandDesktopShot.data, "base64"));
await evaluate(`document.querySelector("#team-jazz").open = true; document.querySelector("#team-jazz [data-jazz-george-chart]")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const jazzGeorgeDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-jazz-george-desktop.png`, Buffer.from(jazzGeorgeDesktopShot.data, "base64"));
await evaluate(`document.querySelector("#team-jazz [data-jazz-rebounding-chart]")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const jazzReboundDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-jazz-rebounding-desktop.png`, Buffer.from(jazzReboundDesktopShot.data, "base64"));
await evaluate(`document.querySelector("#team-warriors").open = true; document.querySelector("#team-warriors .curry-chart")?.scrollIntoView({ block: "start" })`);
await new Promise((resolve) => setTimeout(resolve, 500));
const warriorsDesktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-warriors-desktop.png`, Buffer.from(warriorsDesktopShot.data, "base64"));
const clevelandReopen = await evaluate(`(async () => {
  const card = document.querySelector("#team-cavaliers");
  card.open = false;
  await new Promise((resolve) => setTimeout(resolve, 50));
  card.open = true;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    initialized: card.querySelector(".watson-chart").dataset.watsonInitialized,
    panels: card.querySelectorAll(".watson-chart__panel svg").length,
  };
})()`);
await evaluate(`document.querySelector(".team-card").open = false; document.querySelector(".team-card > summary").focus()`);
const keyboardControl = await evaluate(`(() => {
  const summary = document.querySelector(".team-card > summary");
  return { tag: summary.tagName, focused: document.activeElement === summary, tabIndex: summary.tabIndex };
})()`);

const report = { pageUrl, initial, expanded, magic, pacers, hawks, cleveland, jazz, warriors, mobile, clevelandReopen, hashNavigation, keyboardControl, failures };
console.log(JSON.stringify(report, null, 2));

const expectedRanks = Array.from({ length: 30 }, (_, index) => index + 1);
const passed = initial.cards === 24
  && initial.rankings === 30
  && initial.completedLinks === 24
  && initial.upcoming === 6
  && initial.logos.every((logo) => logo.loaded)
  && JSON.stringify(initial.ranks) === JSON.stringify(expectedRanks)
  && !initial.draftLanguage
  && !initial.horizontalOverflow
  && expanded.openCards === 24
  && expanded.charts >= 27
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
  && hawks.panels === 4
  && hawks.marks === 12
  && hawks.latestMarks === 4
  && hawks.players === 2
  && hawks.tableRows === 6
  && hawks.johnson2024Games === 36
  && JSON.stringify(hawks.nawTeams) === JSON.stringify(["MIN", "MIN", "ATL"])
  && JSON.stringify(hawks.points) === JSON.stringify(["22.7", "24.8", "30.2", "16.9", "18.4", "29.5"])
  && JSON.stringify(hawks.assists) === JSON.stringify(["5.2", "6.6", "10.6"])
  && JSON.stringify(hawks.trueShooting) === JSON.stringify(["57.8%", "57.9%", "61.0%"])
  && hawks.chartWidth >= 700
  && cleveland.initialized === "true"
  && cleveland.panels === 3
  && cleveland.marks === 12
  && cleveland.latestMarks === 3
  && cleveland.tableRows === 4
  && JSON.stringify(cleveland.games) === JSON.stringify([23, 80, 68, 54])
  && JSON.stringify(cleveland.minutes) === JSON.stringify([186, 1488, 1656, 1598])
  && JSON.stringify(cleveland.points) === JSON.stringify(["19.7", "17.7", "16.0", "24.1"])
  && JSON.stringify(cleveland.usage) === JSON.stringify(["17.7%", "16.2%", "13.9%", "20.6%"])
  && JSON.stringify(cleveland.trueShooting) === JSON.stringify(["55.3%", "53.9%", "56.4%", "59.4%"])
  && cleveland.directValues.length === 12
  && cleveland.chartWidth >= 700
  && cleveland.identity.toLowerCase() === "#860038"
  && cleveland.surface.toLowerCase() === "#f0e0e7"
  && cleveland.introParagraphs === 8
  && cleveland.continuationParagraphs === 1
  && !cleveland.hasHistoricalPlaceholder
  && jazz.georgePanels === 3
  && jazz.georgeMarks === 9
  && jazz.georgeLatest === 3
  && JSON.stringify(jazz.georgeValues) === JSON.stringify([["23.2", "53.3%", "22.8%"], ["25.6", "53.9%", "24.3%"], ["33.5", "60.9%", "27.9%"]])
  && jazz.reboundPanels === 2
  && jazz.reboundMarks === 16
  && JSON.stringify(jazz.reboundSeriesLabels) === JSON.stringify(["Markkanen", "Jackson", "Markkanen", "Jackson"])
  && JSON.stringify(jazz.reboundValues) === JSON.stringify([["20.7%", "13.6%"], ["19.6%", "13.6%"], ["14.9%", "10.1%"], ["15.7%", "10.8%"], ["18.8%", "12.6%"], ["15.0%", "9.4%"], ["15.5%", "10.0%"], ["17.4%", "10.1%"]])
  && jazz.combinedLabel === "MEM/UTA combined"
  && jazz.storyParagraphs === 16
  && JSON.stringify(jazz.storyGroups) === JSON.stringify([9, 3, 4])
  && jazz.georgePlacement
  && jazz.reboundPlacement
  && jazz.correctedTypos
  && jazz.identity.toLowerCase() === "#6b4c9a"
  && jazz.surface.toLowerCase() === "#edeaf3"
  && jazz.georgeWidth >= 700
  && jazz.reboundWidth >= 700
  && warriors.mounted === "true"
  && warriors.svgs === 2
  && warriors.linePaths === 4
  && warriors.marks === 10
  && warriors.bars === 10
  && JSON.stringify(warriors.panelBars) === JSON.stringify([4, 6])
  && JSON.stringify(warriors.panelSeasons) === JSON.stringify([["15–16", "16–17", "17–18", "18–19"], ["20–21", "21–22", "22–23", "23–24", "24–25", "25–26"]])
  && warriors.panelWidths[1] > warriors.panelWidths[0]
  && Math.abs(warriors.panelSpacing[0] - warriors.panelSpacing[1]) < 2
  && Math.abs(warriors.zeroLines[0] - warriors.zeroLines[1]) < 0.01
  && warriors.rows === 11
  && JSON.stringify(warriors.seasons) === JSON.stringify(["2015-16", "2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"])
  && JSON.stringify(warriors.relative.at(-1)) === JSON.stringify(["+4.1", "\u22122.9", "+7.0"])
  && JSON.stringify(warriors.relative[7]) === JSON.stringify(["+4.0", "+1.7", "+2.3"])
  && warriors.onMinutes[4] === 139
  && warriors.onMinutes.at(-1) === 1328
  && JSON.stringify(warriors.omittedCells) === JSON.stringify(["2019-20", "Omitted — small sample", "Omitted — small sample", "110.6", "Not calculated", "Not calculated", "Not calculated", "139", "Not supplied"])
  && warriors.sampleNote === "2019–20 excluded: Curry played only 139 minutes."
  && warriors.interpretation === "Golden State’s offense remained above NBA average with Curry playing in every season shown. Results without him varied considerably."
  && /not Curry.s isolated effect/i.test(warriors.methodology)
  && JSON.stringify(warriors.storyGroups) === JSON.stringify([3, 5])
  && warriors.placement
  && warriors.identity.toLowerCase() === "#ffc72c"
  && warriors.secondary.toLowerCase() === "#1d428a"
  && warriors.chartWidth >= 700
  && !mobile.horizontalOverflow
  && mobile.mobileRankingsVisible
  && mobile.hawksChartWidth <= mobile.viewport
  && mobile.hawksPanelColumns === 1
  && mobile.clevelandChartWidth <= mobile.viewport
  && mobile.clevelandPanelColumns === 1
  && mobile.clevelandTableContained
  && mobile.jazzGeorgeWidth <= mobile.viewport
  && mobile.jazzGeorgeColumns === 1
  && mobile.jazzReboundWidth <= mobile.viewport
  && mobile.jazzReboundColumns === 1
  && mobile.jazzTableContained
  && mobile.warriorsChartWidth <= mobile.viewport
  && mobile.warriorsTableContained
  && mobile.warriorsPanelColumns === 1
  && JSON.stringify(mobile.warriorsPanelSeasons) === JSON.stringify([4, 6])
  && clevelandReopen.initialized === "true"
  && clevelandReopen.panels === 3
  && hashNavigation.hash === "#team-magic"
  && hashNavigation.open
  && hashNavigation.distanceFromTop <= 165
  && keyboardControl.tag === "SUMMARY"
  && keyboardControl.focused
  && keyboardControl.tabIndex === 0
  && failures.length === 0;

socket.close();
if (!passed) process.exitCode = 1;
