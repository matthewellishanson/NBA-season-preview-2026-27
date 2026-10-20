import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const URL = process.argv[2] || "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-lakers";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACTS = path.join(ROOT, "artifacts");

const STORY = [
  "This is a different sort of Los Angeles Lakers team than many of us have become accustomed to seeing. For one, there’s no LeBron James here. There’s still a premier MVP-level superstar at the center of the Laker universe in Luka Dončić, and a capable co-star in undrafted breakout Austin Reaves alongside him in the backcourt. Even so, something feels substantively and stylistically different about this version of the Lakers compared with many of the franchise’s celebrated contenders.",
  "Let’s get the obvious out of the way: This is a conspicuously white Lakers roster, talented enough to give the internet’s “Snowtime Lakers” nickname a chance to stick. But that’s not what feels most unusual about this team.",
  "What feels different, with the possible exception of some of the Kobe-dominated teams of the mid-2000s, is the apparent lack of a cohesive identity beyond Dončić’s heliocentric offensive brilliance and the defensive liabilities that come with it. What is this team built for? What will these Lakers build around, apart from Luka’s heavy offensive usage and frequently costly defensive shortcomings?",
  "The obvious model is the 2024 Western Conference champion Dallas Mavericks, with Reaves replacing Kyrie Irving as Dončić’s backcourt running mate and newly acquired center Walker Kessler anchoring the frontcourt. But those Mavericks surrounded Luka with multiple productive big men and dependable perimeter defenders who could cover for his weaknesses throughout their run through the West. These Lakers have, at best, one proven interior mistake eraser in Kessler and considerably less defensive insurance on the wings. Quentin Grimes helps, but his solid perimeter defense alone won’t cover adequately for both Dončić and Reaves.",
  "Without that supporting structure, I can’t expect much from this team this season unless some big midseason acquisitions are coming. There’s just not enough talent and defensive insurance surrounding its two stars to inspire much confidence in the Lakers’ title chances as things stand.",
  "Moreover, Kessler isn’t a guaranteed long-term answer. He played just five games last season before a shoulder injury ended his campaign, and he arrives after four seasons with Utah teams that never reached the playoffs. His ability to hold up through a meaningful postseason run remains untested.",
  "He could be an ideal frontcourt partner for Dončić and Reaves if he stays healthy and provides enough offensively to complement his defensive strengths. But the combination of injury risk and an unproven playoff fit still leaves me hesitant to bet on him as the Lakers’ long-term solution at center.",
  "There are some appealing new faces besides Kessler. I like Collin Sexton as another backcourt scoring option after Luke Kennard’s departure to Phoenix, and love the additions of former Sixers guard Grimes and Raptors reserve Sandro Mamukelashvili.",
  "Mamu, in particular, feels like an ideal fit alongside Kessler, Reaves and Dončić as a bench scorer and occasional closing frontcourt option, although I’ve always liked him more than most.",
  "But those additions don’t do enough to resolve my biggest concern: whether this rotation can defend well enough around its two franchise stars to survive a playoff series against the West’s best teams. Too much seems to depend on Kessler staying healthy and cleaning up whatever gets past the perimeter.",
  "That’s why I struggle to imagine these Lakers getting beyond the first round without some savvy moves between now and the postseason. Dončić may even play his way to his first MVP award — long overdue, in my opinion — and that still might not be enough to take his team deep into the playoffs.",
];

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
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${this.url}`)), 10000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(error);
      }, { once: true });
    });
    this.socket.addEventListener("message", async (event) => {
      const payload = typeof event.data === "string"
        ? event.data
        : typeof event.data?.text === "function"
          ? await event.data.text()
          : Buffer.from(event.data).toString("utf8");
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
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) || [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }

  once(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const callback = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== callback));
        resolve(params);
      };
      this.on(method, callback);
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForFile(file, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
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

async function waitForChart(client) {
  await evaluate(client, `new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const root = document.querySelector('[data-kessler-lakers-chart]');
      if (root?.kesslerChart?.rows.length === 4 && root.querySelectorAll('svg').length === 3) resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('Kessler chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}

async function captureElement(client, filename) {
  const clip = await evaluate(client, `(() => {
    const rect = document.querySelector('[data-kessler-lakers-chart]').getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip });
  await writeFile(path.join(ARTIFACTS, filename), Buffer.from(result.data, "base64"));
}

async function run() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "kessler-lakers-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--use-angle=swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let client;
  const browserErrors = [];

  try {
    const activePortFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(activePortFile);
    const [port] = (await readFile(activePortFile, "utf8")).trim().split(/\s+/);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    assert(page, "No browser page target was available.");
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    client.on("Runtime.exceptionThrown", (params) => browserErrors.push(params.exceptionDetails.text));
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") browserErrors.push(params.args.map((arg) => arg.value || arg.description).join(" "));
    });
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }),
    ]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: URL });
    await loaded;
    await waitForChart(client);

    const desktop = await evaluate(client, `(() => {
      const root = document.querySelector('[data-kessler-lakers-chart]');
      const chart = root.kesslerChart;
      const coordinateErrors = [];
      chart.panelStates.forEach((state, panelIndex) => {
        const panel = root.querySelectorAll('.kessler-chart__panel')[panelIndex];
        if (state.metric.kind === 'bar') {
          panel.querySelectorAll('.kessler-chart__bar').forEach((mark) => {
            const row = chart.bySeason.get(mark.dataset.season);
            const expectedY = state.y(row.games);
            const expectedHeight = state.bottom - expectedY;
            if (Math.abs(Number(mark.getAttribute('y')) - expectedY) > .01 || Math.abs(Number(mark.getAttribute('height')) - expectedHeight) > .01) coordinateErrors.push([state.metric.key, row.season]);
          });
        } else {
          panel.querySelectorAll('.kessler-chart__point').forEach((mark) => {
            const row = chart.bySeason.get(mark.dataset.season);
            if (Math.abs(Number(mark.getAttribute('cx')) - state.x(row.season)) > .01 || Math.abs(Number(mark.getAttribute('cy')) - state.y(row[state.metric.key])) > .01) coordinateErrors.push([state.metric.key, row.season]);
          });
        }
      });
      const intro = root.parentElement.querySelector('.story--lakers-intro');
      const continuation = root.parentElement.querySelector('.story--lakers-continuation');
      const paragraphs = [...intro.querySelectorAll(':scope > p'), ...continuation.querySelectorAll(':scope > p')].map((p) => p.textContent);
      const table = [...root.querySelectorAll('.kessler-chart__table-row')].map((row) => [...row.children].map((cell) => cell.textContent.trim()));
      const style = getComputedStyle(root);
      return {
        busy: root.getAttribute('aria-busy'),
        rows: chart.rows.length,
        panels: root.querySelectorAll('.kessler-chart__panel').length,
        svgs: root.querySelectorAll('svg').length,
        bars: root.querySelectorAll('.kessler-chart__bar').length,
        points: root.querySelectorAll('.kessler-chart__point').length,
        rings: root.querySelectorAll('.kessler-chart__sample-ring').length,
        domains: chart.panelStates.map((state) => state.y.domain()),
        coordinateErrors,
        labels: [...root.querySelectorAll('.kessler-chart__direct-value')].map((node) => node.textContent),
        selected: chart.selectedSeason,
        inspectionTitle: root.querySelector('.kessler-chart__inspection-title').textContent,
        inspection: root.querySelector('.kessler-chart__inspection-values').textContent.replace(/\\s+/g, ' ').trim(),
        warning: root.querySelector('.kessler-chart__sample-warning').textContent.replace(/\\s+/g, ' ').trim(),
        table,
        story: { paragraphs, introCount: intro.querySelectorAll(':scope > p').length, continuationCount: continuation.querySelectorAll(':scope > p').length, chartFollowsIntro: intro.nextElementSibling === root, continuationFollowsChart: root.nextElementSibling === continuation },
        identity: style.getPropertyValue('--team-identity').trim(),
        secondary: style.getPropertyValue('--team-secondary').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
      };
    })()`);
    assert(desktop.busy === "false" && desktop.rows === 4, "Normalized row count or loading state was incorrect.");
    assert(desktop.panels === 3 && desktop.svgs === 3 && desktop.bars === 4 && desktop.points === 8, "Panels or marks were incomplete.");
    assert(desktop.rings === 2, "The latest rate markers did not retain their non-color sample cue.");
    assert(JSON.stringify(desktop.domains) === JSON.stringify([[0, 82], [0, 20], [0, 10]]), "Panel domains changed unexpectedly.");
    assert(desktop.coordinateErrors.length === 0, `Plotted coordinates disagreed with normalized values: ${JSON.stringify(desktop.coordinateErrors)}`);
    ["5", "15.7%", "5.6%"].forEach((label) => assert(desktop.labels.includes(label), `Latest direct label omitted ${label}.`));
    assert(desktop.selected === "2024-25" && desktop.inspectionTitle === "2024–25", "The chart did not default to the most recent substantial season.");
    ["58", "1,740", "30.0", "23", "16.6%", "7.4%", "12.2", "2.4", "66.0%"].forEach((value) => assert(desktop.inspection.includes(value), `Default inspection omitted ${value}.`));
    assert(desktop.warning.includes("2025–26 limited sample: 5 games · 154 minutes") && desktop.warning.includes("do not establish a durable trend"), "The persistent five-game warning was incomplete.");
    const expectedTable = [
      ["2022–23", "UTA", "74", "1,703", "23.0", "21", "14.9%", "8.6%", "8.4", "2.3", "70.2%"],
      ["2023–24", "UTA", "64", "1,493", "23.3", "22", "12.3%", "9.2%", "7.5", "2.4", "66.3%"],
      ["2024–25", "UTA", "58", "1,740", "30.0", "23", "16.6%", "7.4%", "12.2", "2.4", "66.0%"],
      ["2025–26", "UTA", "5", "154", "30.8", "24", "15.7%", "5.6%", "10.8", "1.8", "78.6%"],
    ];
    assert(JSON.stringify(desktop.table) === JSON.stringify(expectedTable), `Accessible table disagreed: ${JSON.stringify(desktop.table)}`);
    assert(desktop.story.introCount === 7 && desktop.story.continuationCount === 4 && desktop.story.chartFollowsIntro && desktop.story.continuationFollowsChart, "Story paragraph count or chart placement was incorrect.");
    assert(JSON.stringify(desktop.story.paragraphs) === JSON.stringify(STORY), "Rendered Lakers story does not match the supplied 11 paragraphs exactly.");
    assert(desktop.identity.toLowerCase() === "#552583" && desktop.secondary.toLowerCase() === "#fdb927" && desktop.surface.toLowerCase() === "#ebe5f0", "Lakers theme tokens were not inherited.");
    await captureElement(client, "kessler-lakers-desktop.png");

    const interaction = await evaluate(client, `(async () => {
      const root = document.querySelector('[data-kessler-lakers-chart]');
      const hit = root.querySelector('.kessler-chart__season-hit[data-season="2023-24"]');
      hit.focus();
      hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const keyboardTitle = root.querySelector('.kessler-chart__inspection-title').textContent;
      const latest = root.querySelector('.kessler-chart__season-hit[data-season="2025-26"]');
      latest.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      const touchTitle = root.querySelector('.kessler-chart__inspection-title').textContent;
      const touchInspection = root.querySelector('.kessler-chart__inspection-values').textContent.replace(/\\s+/g, ' ').trim();
      const warning = root.querySelector('.kessler-chart__sample-warning').textContent.replace(/\\s+/g, ' ').trim();
      const card = root.closest('details');
      card.open = false;
      await new Promise((resolve) => setTimeout(resolve, 60));
      card.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { keyboardTitle, touchTitle, touchInspection, warning, svgs: root.querySelectorAll('svg').length, roots: document.querySelectorAll('[data-kessler-lakers-chart]').length, initialized: root.dataset.kesslerInitialized };
    })()`);
    assert(interaction.keyboardTitle === "2023–24", "Keyboard selection did not update all-panels inspection.");
    assert(interaction.touchTitle === "2025–26" && interaction.touchInspection.includes("5 Games") && interaction.touchInspection.includes("154 Total minutes") && interaction.touchInspection.includes("15.7% ORB%") && interaction.touchInspection.includes("5.6% BLK%"), "Touch selection did not expose the five-game row.");
    assert(interaction.warning.includes("5 games · 154 minutes"), "The five-game warning disappeared after selection.");
    assert(interaction.svgs === 3 && interaction.roots === 1 && interaction.initialized === "true", "Reopening duplicated chart elements or initialization.");

    await evaluate(client, `document.querySelector('[data-kessler-lakers-chart]').kesslerChart.selectSeason('2024-25', false)`);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(client, `new Promise((resolve) => { window.dispatchEvent(new Event('resize')); setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 180); })`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-kessler-lakers-chart]');
      const panels = root.querySelector('.kessler-chart__panels');
      const firstPanel = root.querySelector('.kessler-chart__panel');
      const firstHit = root.querySelector('.kessler-chart__season-hit');
      firstHit.focus();
      return {
        columns: getComputedStyle(panels).gridTemplateColumns,
        panelWidth: firstPanel.getBoundingClientRect().width,
        plotWidth: root.querySelector('.kessler-chart__plot').getBoundingClientRect().width,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        seasonTicks: root.querySelectorAll('.kessler-chart__axis--x .tick').length,
        tableRows: root.querySelectorAll('.kessler-chart__table-row').length,
        warning: root.querySelector('.kessler-chart__sample-warning').textContent.replace(/\\s+/g, ' ').trim(),
        focused: document.activeElement === firstHit,
        role: firstHit.getAttribute('role'),
      };
    })()`);
    assert(!mobile.columns.includes(" ") && mobile.panelWidth <= mobile.plotWidth, "Panels did not stack at 390px.");
    assert(mobile.pageWidth <= mobile.viewportWidth, `Mobile page overflowed (${mobile.pageWidth} > ${mobile.viewportWidth}).`);
    assert(mobile.seasonTicks === 12 && mobile.tableRows === 4, "Mobile season labels or accessible table were incomplete.");
    assert(mobile.warning.includes("5 games · 154 minutes") && mobile.focused && mobile.role === "button", "Mobile warning or keyboard target was incomplete.");
    await captureElement(client, "kessler-lakers-mobile.png");

    await client.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert(await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`), "Reduced-motion mode was not recognized.");
    assert(browserErrors.length === 0, `Browser console/runtime errors: ${browserErrors.join(" | ")}`);

    console.log("PASS: four normalized UTA rows, source values, domains, coordinates and direct latest labels.");
    console.log("PASS: exact 11-paragraph story and chart placement after paragraph 7.");
    console.log("PASS: default 2024-25 inspection, persistent five-game warning and complete four-row table.");
    console.log("PASS: keyboard/touch inspection, collapse/reopen, resizing, 390px stacking and no overflow.");
    console.log("PASS: Lakers palette, reduced motion and no browser console/runtime errors.");
    console.log("Wrote artifacts/kessler-lakers-desktop.png and artifacts/kessler-lakers-mobile.png");
  } finally {
    if (client) client.close();
    chrome.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await rm(profile, { recursive: true, force: true });
  }
}

await run().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
