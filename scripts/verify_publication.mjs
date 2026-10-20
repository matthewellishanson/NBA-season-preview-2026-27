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
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: pageUrl });
await waitFor(`document.readyState === "complete" && document.querySelectorAll(".team-card").length === 14`);

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
  charts: document.querySelectorAll(".team-graphic svg, .team-history-chart svg, .jokic-on-off svg, .wemby-unicorn svg, .celtics-wings svg, .duren-comparison svg, .edey-package svg, .kawhi-production svg, .kessler-chart svg, .holmgren-chart svg, .garland-chart svg").length,
  chartErrors: [...document.querySelectorAll("[class*='status--error']")].filter((node) => !node.closest("noscript")).map((node) => node.textContent.trim()),
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))()`);

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

await evaluate(`document.querySelectorAll(".team-card").forEach((card) => { card.open = false; }); location.hash = "#team-wizards"`);
await waitFor(`document.querySelector("#team-wizards")?.open === true`);
await new Promise((resolve) => setTimeout(resolve, 800));
const hashNavigation = await evaluate(`(() => {
  const target = document.querySelector("#team-wizards");
  return { hash: location.hash, open: target.open, distanceFromTop: Math.round(Math.abs(target.getBoundingClientRect().top)) };
})()`);

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await evaluate(`document.querySelector(".team-card").open = false; document.querySelector(".team-card > summary").focus()`);
const keyboardControl = await evaluate(`(() => {
  const summary = document.querySelector(".team-card > summary");
  return { tag: summary.tagName, focused: document.activeElement === summary, tabIndex: summary.tabIndex };
})()`);

const report = { pageUrl, initial, expanded, mobile, hashNavigation, keyboardControl, failures };
console.log(JSON.stringify(report, null, 2));

const expectedRanks = Array.from({ length: 30 }, (_, index) => index + 1);
const passed = initial.cards === 14
  && initial.rankings === 30
  && initial.completedLinks === 14
  && initial.upcoming === 16
  && initial.logos.every((logo) => logo.loaded)
  && JSON.stringify(initial.ranks) === JSON.stringify(expectedRanks)
  && !initial.draftLanguage
  && !initial.horizontalOverflow
  && expanded.openCards === 14
  && expanded.charts >= 14
  && expanded.chartErrors.length === 0
  && !expanded.horizontalOverflow
  && !mobile.horizontalOverflow
  && mobile.mobileRankingsVisible
  && hashNavigation.hash === "#team-wizards"
  && hashNavigation.open
  && hashNavigation.distanceFromTop < 160
  && keyboardControl.tag === "SUMMARY"
  && keyboardControl.focused
  && keyboardControl.tabIndex === 0
  && failures.length === 0;

socket.close();
if (!passed) process.exitCode = 1;
