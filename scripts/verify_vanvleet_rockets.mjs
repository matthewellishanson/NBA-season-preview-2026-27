import fs from "node:fs/promises";

const pageUrl = process.argv[2] || "http://127.0.0.1:8000/2026-27-team-previews.html#team-rockets";
const outputPrefix = process.argv[3] || "artifacts/vanvleet-rockets";
const debugPort = process.env.CHROME_DEBUG_PORT || "9222";
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page");
if (!target) throw new Error(`No inspectable browser page found on debugging port ${debugPort}.`);
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
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    failures.push(message.params.exceptionDetails.text);
  } else if (message.method === "Network.loadingFailed") {
    failures.push(message.params.errorText);
  }
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
};

await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Network.enable")]);
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: pageUrl });
await waitFor(`document.readyState === "complete" && document.querySelector("#team-rockets")`);
await evaluate(`document.querySelector("#team-rockets").open = true`);
await waitFor(`document.querySelector("#team-rockets [data-vanvleet-rockets-chart]")?.dataset.chartMounted === "true"`);

const inspect = () => evaluate(`(() => {
  const card = document.querySelector("#team-rockets");
  const root = card.querySelector("[data-vanvleet-rockets-chart]");
  const rows = [...root.querySelectorAll("tbody tr")];
  const style = getComputedStyle(root);
  return {
    mounted: root.dataset.chartMounted,
    panels: root.querySelectorAll(".vanvleet-chart__panel svg").length,
    connectors: root.querySelectorAll(".vanvleet-chart__connector").length,
    contextMarks: root.querySelectorAll(".vanvleet-chart__context-mark").length,
    directValues: [...root.querySelectorAll(".vanvleet-chart__value")].map((node) => node.textContent.trim()),
    contextLabels: [...root.querySelectorAll(".vanvleet-chart__context-label")].map((node) => node.textContent.trim()),
    tableRows: rows.length,
    tableValues: rows.map((row) => [...row.cells].map((cell) => cell.textContent.trim())),
    storyGroups: [...card.querySelectorAll(".story--rockets")].map((article) => article.querySelectorAll(":scope > p").length),
    linkedPhrase: card.querySelector('a[href="https://sports.yahoo.com/articles/kevin-durant-breaks-silence-alleged-221458600.html"]')?.textContent.trim(),
    placement: root.previousElementSibling?.classList.contains("story--rockets-intro") && root.nextElementSibling?.classList.contains("story--rockets-continuation"),
    chartWidth: Math.round(root.getBoundingClientRect().width),
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    panelColumns: getComputedStyle(root.querySelector(".vanvleet-chart__panels")).gridTemplateColumns.split(" ").length,
    tableContained: root.querySelector(".vanvleet-chart__table-wrap").scrollWidth >= root.querySelector(".vanvleet-chart__table-wrap").clientWidth,
    identity: style.getPropertyValue("--team-identity").trim(),
    surface: style.getPropertyValue("--team-surface").trim(),
    background: style.backgroundColor,
  };
})()`);

const desktop = await inspect();
await evaluate(`document.documentElement.style.scrollBehavior = "auto"; document.querySelector("#team-rockets [data-vanvleet-rockets-chart]").scrollIntoView({block:"start"})`);
const desktopShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-desktop.png`, Buffer.from(desktopShot.data, "base64"));

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await new Promise((resolve) => setTimeout(resolve, 500));
await evaluate(`document.querySelector("#team-rockets [data-vanvleet-rockets-chart]").scrollIntoView({block:"start"})`);
await new Promise((resolve) => setTimeout(resolve, 250));
const mobile = await inspect();
const mobileShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(`${outputPrefix}-mobile.png`, Buffer.from(mobileShot.data, "base64"));

const expectedValues = [
  "116.4 pts/100", "112.1 pts/100", "116.5 pts/100", "114.9 pts/100", "118.6 pts/100",
  "12.4%", "13.6%", "12.6%", "15.6%", "13.3%",
];
const passed = desktop.mounted === "true"
  && desktop.panels === 2
  && desktop.connectors === 4
  && desktop.contextMarks === 2
  && JSON.stringify(desktop.directValues) === JSON.stringify(expectedValues)
  && desktop.contextLabels.every((label) => label === "Full season — VanVleet did not play")
  && desktop.tableRows === 5
  && desktop.tableValues[0][4] === "2,686"
  && desktop.tableValues[1][4] === "1,288"
  && desktop.tableValues[2][4] === "2,114"
  && desktop.tableValues[3][4] === "1,845"
  && desktop.tableValues[4][4] === "Not supplied"
  && JSON.stringify(desktop.storyGroups) === JSON.stringify([4, 5])
  && desktop.linkedPhrase === "group-chat messages allegedly linked to Durant"
  && desktop.placement
  && desktop.identity.toLowerCase() === "#ce1141"
  && desktop.surface.toLowerCase() === "#f9e2e8"
  && desktop.background === "rgb(249, 226, 232)"
  && desktop.panelColumns === 2
  && desktop.chartWidth >= 700
  && !desktop.pageOverflow
  && mobile.panelColumns === 1
  && mobile.chartWidth <= 390
  && !mobile.pageOverflow
  && mobile.tableContained
  && failures.length === 0;

console.log(JSON.stringify({ pageUrl, desktop, mobile, failures, passed }, null, 2));
socket.close();
if (!passed) process.exitCode = 1;
