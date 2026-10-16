import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";


const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE_URL = process.argv[2] || "http://127.0.0.1:4173/2026-27-previews-prototype.html#team-timberwolves";
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
    const target = new URL(this.url);
    this.buffer = Buffer.alloc(0);
    this.fragmentBuffers = [];
    this.handshakeComplete = false;
    this.socket = net.createConnection({ host: target.hostname, port: Number(target.port) });
    await new Promise((resolve, reject) => {
      const key = randomBytes(16).toString("base64");
      const onError = (error) => reject(error);
      this.socket.once("error", onError);
      this.socket.once("connect", () => {
        this.socket.write([
          `GET ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${target.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "Origin: http://127.0.0.1",
          "",
          "",
        ].join("\r\n"));
      });
      const onHandshakeData = (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const headers = this.buffer.subarray(0, headerEnd).toString("utf8");
        if (!headers.startsWith("HTTP/1.1 101")) {
          reject(new Error(`WebSocket handshake failed: ${headers.split("\r\n")[0]}`));
          return;
        }
        this.socket.off("error", onError);
        this.socket.off("data", onHandshakeData);
        this.buffer = this.buffer.subarray(headerEnd + 4);
        this.handshakeComplete = true;
        this.socket.on("data", (data) => {
          this.buffer = Buffer.concat([this.buffer, data]);
          this.parseFrames();
        });
        this.socket.on("error", (error) => {
          for (const { reject: rejectPending } of this.pending.values()) rejectPending(error);
          this.pending.clear();
        });
        this.parseFrames();
        resolve();
      };
      this.socket.on("data", onHandshakeData);
    });
  }

  receiveMessage(payload) {
    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch (error) {
      console.error("CDP message parse failed", error);
      return;
    }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      (this.listeners.get(message.method) || []).forEach((callback) => callback(message.params));
  }

  parseFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const wideLength = this.buffer.readBigUInt64BE(2);
        if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame is too large.");
        length = Number(wideLength);
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskLength;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) payload.forEach((value, index) => { payload[index] = value ^ mask[index % 4]; });
      if (opcode === 0x8) {
        this.socket.destroy();
        return;
      }
      if (opcode === 0x9) {
        this.sendFrame(payload, 0xA);
        continue;
      }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x2) this.fragmentBuffers = [payload];
      else if (opcode === 0x0) this.fragmentBuffers.push(payload);
      else continue;
      if (fin) {
        this.receiveMessage(Buffer.concat(this.fragmentBuffers));
        this.fragmentBuffers = [];
      }
    }
  }

  sendFrame(payload, opcode = 0x1) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const mask = randomBytes(4);
    let header;
    if (data.length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | data.length;
    } else if (data.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    header[0] = 0x80 | opcode;
    const masked = Buffer.alloc(data.length);
    data.forEach((value, index) => { masked[index] = value ^ mask[index % 4]; });
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendFrame(JSON.stringify({ id, method, params }));
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
    if (this.socket && !this.socket.destroyed) {
      this.sendFrame(Buffer.alloc(0), 0x8);
      this.socket.destroy();
    }
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}


async function waitForChart(client) {
  await evaluate(client, `new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const root = document.querySelector('[data-mcdaniels-offense-chart]');
      if (root?.mcdanielsOffenseChart?.rows.length === 10 && root.querySelectorAll('svg').length === 3) resolve(true);
      else if (performance.now() - started > 10000) reject(new Error('McDaniels chart did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}


async function captureElement(client, output) {
  const clip = await evaluate(client, `(() => {
    const element = document.querySelector('[data-mcdaniels-offense-chart]');
    const rect = element.getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
    clip,
  });
  await writeFile(path.join(ARTIFACTS, output), Buffer.from(result.data, "base64"));
}


async function run() {
  const keepAlive = setInterval(() => {}, 1000);
  const profile = await mkdtemp(path.join(os.tmpdir(), "mcdaniels-chart-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
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
    client.on("Log.entryAdded", ({ entry }) => {
      if (entry.level === "error") browserErrors.push(entry.text);
    });
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: PAGE_URL });
    await loaded;
    await waitForChart(client);

    const initial = await evaluate(client, `(() => {
      const root = document.querySelector('[data-mcdaniels-offense-chart]');
      const chart = root.mcdanielsOffenseChart;
      const coordinateErrors = [];
      chart.panelStates.forEach((state) => state.allPoints.forEach((selection) => selection.each(function(slot) {
        const match = this.getAttribute('transform').match(/translate\\(([-0-9.]+),([-0-9.]+)\\)/);
        const actual = match ? [Number(match[1]), Number(match[2])] : [NaN, NaN];
        const expected = [state.x(slot.season), state.y(slot.row[state.metric.key])];
        if (!actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) < 0.01)) {
          coordinateErrors.push([slot.season, slot.row.seasonType, state.metric.key, actual, expected]);
        }
      })));
      const playoffPaths = [...root.querySelectorAll('.mcdaniels-offense__line--playoffs')].map((node) => node.getAttribute('d'));
      const tableRows = [...root.querySelectorAll('.mcdaniels-offense__table-row')];
      const tableErrors = [];
      tableRows.forEach((tableRow, index) => {
        const row = chart.rows[index];
        const expected = [
          row.season.replace('-', '–'), row.seasonType, String(row.age), String(row.games), String(row.starts),
          row.minutesPerGame.toFixed(1), row.totalMinutes.toLocaleString('en-US'), row.pointsPerGame.toFixed(1),
          row.reboundsPerGame.toFixed(1), row.assistsPerGame.toFixed(1), row.pointsPer100.toFixed(1),
          (row.trueShooting * 100).toFixed(1) + '%', row.usage.toFixed(1) + '%', row.fgaPer100.toFixed(1),
          row.fg3aPer100.toFixed(1), (row.threePointPct * 100).toFixed(1) + '%', row.assistsPer100.toFixed(1), row.reboundPct.toFixed(1) + '%',
        ];
        [...tableRow.children].forEach((cell, column) => {
          if (cell.textContent.trim() !== expected[column]) tableErrors.push([index, column, cell.textContent.trim(), expected[column]]);
        });
      });
      const intro = root.parentElement.querySelector('.story--timberwolves-intro');
      const continuation = root.parentElement.querySelector('.story--timberwolves-continuation');
      const introParagraphs = [...intro.querySelectorAll(':scope > p')];
      const style = getComputedStyle(root);
      return {
        busy: root.getAttribute('aria-busy'),
        panels: root.querySelectorAll('.mcdaniels-offense__panel').length,
        svgs: root.querySelectorAll('svg').length,
        lines: root.querySelectorAll('.mcdaniels-offense__line').length,
        points: root.querySelectorAll('.mcdaniels-offense__point').length,
        tableRows: tableRows.length,
        coordinateErrors,
        tableErrors,
        gapSegments: playoffPaths.map((path) => (path.match(/M/g) || []).length),
        domains: Object.fromEntries(chart.panelStates.map((state) => [state.metric.key, state.y.domain()])),
        inspection: root.querySelector('.mcdaniels-offense__inspection-values').textContent.replace(/\\s+/g, ' ').trim(),
        season: root.querySelector('.mcdaniels-offense__inspection-season').textContent,
        selectedHits: root.querySelectorAll('.mcdaniels-offense__season-hit[aria-pressed="true"]').length,
        minHitWidth: Math.min(...[...root.querySelectorAll('.mcdaniels-offense__season-hit')].map((node) => Number(node.getAttribute('width')))),
        samples: root.querySelector('.mcdaniels-offense__samples').textContent.replace(/\\s+/g, ' ').trim(),
        identity: style.getPropertyValue('--team-identity').trim(),
        surface: style.getPropertyValue('--team-surface').trim(),
        story: {
          introParagraphs: introParagraphs.length,
          continuationParagraphs: continuation.querySelectorAll(':scope > p').length,
          chartFollowsIntro: intro.nextElementSibling === root,
          continuationFollowsChart: root.nextElementSibling === continuation,
          leadIn: introParagraphs.at(-1).textContent.includes('will be Jaden McDaniels'),
          leadOut: continuation.textContent.trim().startsWith('All in all'),
        },
      };
    })()`);
    assert(initial.busy === "false", "Chart remained aria-busy after load.");
    assert(initial.panels === 3 && initial.svgs === 3 && initial.lines === 6 && initial.points === 27, "Panel or mark counts were wrong.");
    assert(initial.tableRows === 10 && initial.tableErrors.length === 0, `Accessible table values failed: ${JSON.stringify(initial.tableErrors)}`);
    assert(initial.coordinateErrors.length === 0, `Point coordinates failed: ${JSON.stringify(initial.coordinateErrors)}`);
    assert(initial.gapSegments.every((count) => count === 2), `2022-23 playoff gap was bridged: ${initial.gapSegments}`);
    assert(initial.domains.pointsPer100[0] === 0 && initial.domains.pointsPer100[1] === 25, "Points domain was not 0-25.");
    assert(initial.domains.trueShooting.join("|") === "0.45|0.75" && initial.domains.usage.join("|") === "12|24", "Percentage domains changed.");
    ["22.3 PTS/100", "61.1% TS", "18.5% USG", "23.2 PTS/100", "51.2% TS", "21.3% USG", "FGA/100 16.7", "FGA/100 20.8", "3P% 41.2%", "3P% 23.8%"].forEach((value) => assert(initial.inspection.includes(value), `Inspection missed ${value}.`));
    ["6 games · 130 minutes", "16 games · 537 minutes", "15 games · 497 minutes", "12 games · 406 minutes"].forEach((value) => assert(initial.samples.includes(value), `Visible samples missed ${value}.`));
    assert(initial.season === "2025–26" && initial.selectedHits === 3 && initial.minHitWidth >= 44, "Default selection or hit target failed.");
    assert(initial.identity.toLowerCase() === "#236192" && initial.surface.toLowerCase() === "#e5ecf2", "Minnesota theme tokens were not inherited.");
    assert(initial.story.introParagraphs === 17 && initial.story.continuationParagraphs === 1, "Minnesota story paragraph count changed.");
    assert(initial.story.chartFollowsIntro && initial.story.continuationFollowsChart && initial.story.leadIn && initial.story.leadOut, "Chart story placement failed.");
    await captureElement(client, "mcdaniels-offense-desktop.png");

    const interaction = await evaluate(client, `(async () => {
      const root = document.querySelector('[data-mcdaniels-offense-chart]');
      const latestHit = root.querySelector('.mcdaniels-offense__panel .mcdaniels-offense__season-hit[data-season="2025-26"]');
      latestHit.focus();
      latestHit.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const keyboardSeason = root.querySelector('.mcdaniels-offense__inspection-season').textContent;
      const missingHit = root.querySelector('.mcdaniels-offense__panel .mcdaniels-offense__season-hit[data-season="2022-23"]');
      missingHit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      const missingInspection = root.querySelector('.mcdaniels-offense__inspection-values').textContent.replace(/\\s+/g, ' ').trim();
      const card = root.closest('details');
      card.open = false;
      await new Promise((resolve) => setTimeout(resolve, 40));
      card.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        keyboardSeason,
        missingSeason: root.querySelector('.mcdaniels-offense__inspection-season').textContent,
        missingInspection,
        svgs: root.querySelectorAll('svg').length,
        roots: document.querySelectorAll('[data-mcdaniels-offense-chart]').length,
      };
    })()`);
    assert(interaction.keyboardSeason === "2024–25", "Keyboard arrow selection failed.");
    assert(interaction.missingSeason === "2022–23" && interaction.missingInspection.includes("No playoff appearance recorded") && interaction.missingInspection.toLowerCase().includes("postseason data are absent"), "Missing postseason inspection failed.");
    assert(interaction.svgs === 3 && interaction.roots === 1, "Collapse/reopen duplicated chart elements.");

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(client, `(async () => {
      const root = document.querySelector('[data-mcdaniels-offense-chart]');
      root.mcdanielsOffenseChart.selectSeason('2025-26');
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 140));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const mobile = await evaluate(client, `(() => {
      const root = document.querySelector('[data-mcdaniels-offense-chart]');
      const panels = root.querySelector('.mcdaniels-offense__panels');
      const panel = root.querySelector('.mcdaniels-offense__panel');
      const observations = [...root.querySelectorAll('.mcdaniels-offense__panel')].map((node) => node.querySelectorAll('.mcdaniels-offense__point').length);
      return {
        columns: getComputedStyle(panels).gridTemplateColumns,
        panelWidth: panel.getBoundingClientRect().width,
        panelContainerWidth: panels.getBoundingClientRect().width,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        observations,
        samplesVisible: [...root.querySelectorAll('.mcdaniels-offense__sample')].every((node) => node.getBoundingClientRect().height > 0),
      };
    })()`);
    assert(Math.abs(mobile.panelWidth - mobile.panelContainerWidth) < 2, "Mobile panels did not stack to one column.");
    assert(mobile.pageWidth <= mobile.viewportWidth, `Mobile page overflowed (${mobile.pageWidth} > ${mobile.viewportWidth}).`);
    assert(mobile.observations.every((count) => count === 9) && mobile.samplesVisible, "Mobile lost observations or sample labels.");
    await captureElement(client, "mcdaniels-offense-mobile.png");

    const expandedTable = await evaluate(client, `(() => {
      const root = document.querySelector('[data-mcdaniels-offense-chart]');
      root.querySelector('.mcdaniels-offense__table-details').open = true;
      const hit = root.querySelector('.mcdaniels-offense__season-hit');
      hit.focus();
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        rows: root.querySelectorAll('.mcdaniels-offense__table-row').length,
        focus: document.activeElement === hit,
        role: hit.getAttribute('role'),
      };
    })()`);
    assert(expandedTable.pageWidth <= expandedTable.viewportWidth && expandedTable.rows === 10, "Expanded mobile table overflowed or lost rows.");
    assert(expandedTable.focus && expandedTable.role === "button", "Keyboard target was not focusable.");
    await client.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    assert(await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`), "Reduced-motion mode failed.");
    assert(browserErrors.length === 0, `Browser console/runtime errors: ${browserErrors.join(" | ")}`);

    console.log("PASS: 10 normalized rows, 9 observations per metric, correct coordinates/table values, and explicit playoff gap.");
    console.log("PASS: supplied values, visible playoff samples, Minnesota theme, and story placement after the McDaniels paragraph.");
    console.log("PASS: keyboard/touch selection, missing-playoff copy, collapse/reopen, resize, 390px stacking, and no overflow.");
    console.log("PASS: reduced motion and no browser console/runtime errors.");
    console.log("Wrote artifacts/mcdaniels-offense-desktop.png and artifacts/mcdaniels-offense-mobile.png");
  } finally {
    clearInterval(keepAlive);
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
