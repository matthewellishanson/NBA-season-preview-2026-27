import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/dist/2026-27-team-previews/#team-nets";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACTS = path.join(ROOT, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", async (event) => {
      const payload = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(payload);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      (this.listeners.get(message.method) || []).forEach((callback) => callback(message.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const callback = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== callback));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), callback]);
    });
  }
  close() { this.socket.close(); }
}

async function waitForFile(file, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForCharts(client) {
  await evaluate(client, `new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const rookie = document.querySelector('[data-nets-rookie-chart]');
      const mpj = document.querySelector('[data-mpj-brooklyn-chart]');
      if (rookie?.netsRookieComparison?.players.length === 5 && mpj?.mpjComparison?.rows.length === 2 && rookie.getAttribute('aria-busy') === 'false' && mpj.getAttribute('aria-busy') === 'false') resolve(true);
      else if (performance.now() - started > 12000) reject(new Error('Brooklyn charts did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}

async function captureElement(client, selector, output) {
  const clip = await evaluate(client, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip });
  await writeFile(path.join(ARTIFACTS, output), Buffer.from(result.data, "base64"));
}

async function run() {
  const source = await readFile(path.join(ROOT, "2026-27-team-previews.html"), "utf8");
  const deployable = await readFile(path.join(ROOT, "dist", "2026-27-team-previews", "index.html"), "utf8");
  assert(source === deployable, "Deployable index.html is not synchronized with the production source.");
  assert(/name: "Brooklyn Nets",[\s\S]{0,240}?status: "published"[\s\S]{0,100}?logo: "assets\/img\/teamlogos\/nets\.png"/.test(source), "Brooklyn publication state or logo changed.");
  assert(source.includes("data-mpj-brooklyn-chart") && source.includes("data-nets-rookie-chart"), "Production source is missing a Brooklyn chart.");

  await mkdir(ARTIFACTS, { recursive: true });
  const profile = await mkdtemp(path.join(os.tmpdir(), "nets-preview-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--in-process-gpu", "--use-angle=swiftshader", "--use-gl=angle", "--disable-gpu-sandbox",
    "--disable-gpu-shader-disk-cache", "--disable-features=Vulkan,SkiaGraphite", "--no-first-run", "--no-default-browser-check",
    "--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let client;
  const browserErrors = [];

  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(portFile);
    const [port] = (await readFile(portFile, "utf8")).trim().split(/\s+/);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    assert(page, "No browser page target was available.");
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    client.listeners.set("Runtime.consoleAPICalled", [(params) => {
      if (params.type === "error") browserErrors.push(params.args.map((arg) => arg.value || arg.description || "").join(" "));
    }]);
    client.listeners.set("Network.loadingFailed", [(params) => browserErrors.push(`Network: ${params.errorText}`)]);
    await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Network.enable")]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: URL });
    await loaded;
    await waitForCharts(client);

    const desktop = await evaluate(client, `(() => {
      const card = document.querySelector('#team-nets');
      const rookie = card.querySelector('[data-nets-rookie-chart]');
      const mpj = card.querySelector('[data-mpj-brooklyn-chart]');
      const children = [...card.querySelector('.story-layout').children];
      const rookieData = rookie.netsRookieComparison;
      const rookiePositionErrors = [];
      rookie.querySelectorAll('.nets-rookies__row').forEach((rowElement, rowIndex) => {
        rowElement.querySelectorAll('.nets-rookies__metric').forEach((metricElement, metricIndex) => {
          const row = rookieData.players[rowIndex];
          const metric = rookieData.metrics[metricIndex];
          const expected = Math.max(0, Math.min(100, ((row[metric.key] - metric.min) / (metric.max - metric.min)) * 100));
          const actual = parseFloat(metricElement.querySelector('.nets-rookies__track').style.getPropertyValue('--nets-value'));
          if (Math.abs(actual - expected) > 0.001) rookiePositionErrors.push([row.playerId, metric.key, actual, expected]);
        });
      });
      const mpjData = mpj.mpjComparison;
      const mpjPositionErrors = [];
      [...mpj.querySelectorAll('.mpj-shift__metric')].forEach((element, index) => {
        const metric = [...mpjData.roleMetrics, ...mpjData.assistedMetrics][index];
        const track = element.querySelector('.mpj-shift__track');
        [mpjData.rows[0], mpjData.rows[1]].forEach((row, rowIndex) => {
          const expected = Math.max(0, Math.min(100, ((row[metric.key] - metric.min) / (metric.max - metric.min)) * 100));
          const property = rowIndex ? '--mpj-brooklyn' : '--mpj-denver';
          const actual = parseFloat(track.style.getPropertyValue(property));
          if (Math.abs(actual - expected) > 0.001) mpjPositionErrors.push([row.season, metric.key, actual, expected]);
        });
      });
      return {
        open: card.open,
        childClasses: children.map((node) => node.className),
        storyGroups: [...card.querySelectorAll('.story--nets')].map((article) => article.querySelectorAll(':scope > p').length),
        rookie: {
          rows: rookie.querySelectorAll('.nets-rookies__row').length,
          metrics: rookie.querySelectorAll('.nets-rookies__metric').length,
          bars: rookie.querySelectorAll('.nets-rookies__bar').length,
          dots: rookie.querySelectorAll('.nets-rookies__dot').length,
          tableRows: rookie.querySelectorAll('tbody tr').length,
          playerContext: [...rookie.querySelectorAll('.nets-rookies__player span')].map((node) => node.textContent.trim()),
          positionErrors: rookiePositionErrors,
        },
        mpj: {
          metrics: mpj.querySelectorAll('.mpj-shift__metric').length,
          marks: mpj.querySelectorAll('.mpj-shift__mark').length,
          tableRows: mpj.querySelectorAll('tbody tr').length,
          context: mpj.querySelector('.mpj-shift__season-context').textContent.replace(/\\s+/g, ' ').trim(),
          text: mpj.textContent.replace(/\\s+/g, ' ').trim(),
          positionErrors: mpjPositionErrors,
        },
        theme: getComputedStyle(rookie).getPropertyValue('--team-identity').trim(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    assert(desktop.open, "Brooklyn did not expand at the active preview URL.");
    assert(JSON.stringify(desktop.storyGroups) === JSON.stringify([6, 2, 6]), "Approved 14-paragraph story split changed.");
    assert(desktop.childClasses[0].includes("story--nets-intro") && desktop.childClasses[1].includes("mpj-shift") && desktop.childClasses[2].includes("story--nets-prospects") && desktop.childClasses[3].includes("nets-rookies") && desktop.childClasses[4].includes("story--nets-continuation"), "Brooklyn charts are not at the intended story breaks.");
    assert(desktop.rookie.rows === 5 && desktop.rookie.metrics === 20 && desktop.rookie.bars === 15 && desktop.rookie.dots === 5 && desktop.rookie.tableRows === 6, "Revised rookie matrix mark counts are incorrect.");
    assert(desktop.rookie.playerContext.every((value) => /^\d+ games$/.test(value)), "Rookie name cells duplicate MPG or lack games labels.");
    assert(desktop.rookie.positionErrors.length === 0, `Rookie positions disagree with data: ${JSON.stringify(desktop.rookie.positionErrors)}`);
    assert(desktop.mpj.metrics === 7 && desktop.mpj.marks === 14 && desktop.mpj.tableRows === 2, "MPJ graphic mark/table counts are incorrect.");
    ["25.9", "36.9", "20.2%", "30.5%", "3.1", "4.6", "1.9", "3.6", "61.7%", "59.5%", "74.0%", "65.3%", "92.2%", "85.8%"].forEach((value) => assert(desktop.mpj.text.includes(value), `MPJ graphic is missing ${value}.`));
    assert(desktop.mpj.context.includes("77 games") && desktop.mpj.context.includes("52 games"), `MPJ games context is incomplete: ${desktop.mpj.context}`);
    assert(desktop.mpj.positionErrors.length === 0, `MPJ positions disagree with data: ${JSON.stringify(desktop.mpj.positionErrors)}`);
    assert(desktop.theme.toLowerCase() === "#444444" && desktop.overflow <= 1, "Desktop theme or page overflow check failed.");
    assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
    await captureElement(client, "[data-mpj-brooklyn-chart]", "nets-mpj-desktop.png");
    await captureElement(client, "[data-nets-rookie-chart]", "nets-rookies-desktop.png");

    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const mobile = await evaluate(client, `(() => {
      const card = document.querySelector('#team-nets');
      const rookie = card.querySelector('[data-nets-rookie-chart]');
      const mpj = card.querySelector('[data-mpj-brooklyn-chart]');
      const toggles = [rookie.querySelector('summary'), mpj.querySelector('summary')];
      toggles.forEach((toggle) => { toggle.focus(); toggle.click(); });
      const result = {
        rookieColumns: getComputedStyle(rookie.querySelector('.nets-rookies__rows')).gridTemplateColumns.split(' ').length,
        mpjRoleColumns: getComputedStyle(mpj.querySelector('.mpj-shift__role-grid')).gridTemplateColumns.split(' ').length,
        mpjAssistedColumns: getComputedStyle(mpj.querySelector('.mpj-shift__assisted-grid')).gridTemplateColumns.split(' ').length,
        tablesOpen: toggles.every((toggle) => toggle.parentElement.open),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        chartsFit: [rookie, mpj].every((root) => root.getBoundingClientRect().right <= document.documentElement.clientWidth + 1),
      };
      toggles.forEach((toggle) => toggle.click());
      card.open = false;
      card.open = true;
      result.reopenReady = rookie.netsRookieComparison.players.length === 5 && mpj.mpjComparison.rows.length === 2;
      return result;
    })()`);
    assert(mobile.rookieColumns === 1 && mobile.mpjRoleColumns === 1 && mobile.mpjAssistedColumns === 1, "Mobile chart grids did not stack.");
    assert(mobile.tablesOpen && mobile.chartsFit && mobile.reopenReady && mobile.overflow <= 1, "Mobile accessibility, fit, reopen or overflow check failed.");
    await captureElement(client, "[data-mpj-brooklyn-chart]", "nets-mpj-mobile.png");
    await captureElement(client, "[data-nets-rookie-chart]", "nets-rookies-mobile.png");

    console.log(`Verified active deployable preview: ${URL}`);
    console.log("Verified Brooklyn publication state, story preservation, both charts, direct values, metric scales, keyboard tables, reopen behavior, and 1280px/390px layouts.");
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }
}

const keepAlive = setInterval(() => {}, 1000);
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => clearInterval(keepAlive));
