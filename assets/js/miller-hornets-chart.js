(function initializeMillerHornetsChart() {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2023-24", "2024-25", "2025-26"];
  const EXPECTED = new Map([
    ["2023-24", [74, 32.2, 2383, 26.5, 23.9, 0.552, 95]],
    ["2024-25", [27, 34.2, 924, 30.2, 27.7, 0.540, 94]],
    ["2025-26", [65, 30.3, 1968, 33.0, 28.1, 0.574, 99]],
  ]);
  const METRICS = [
    { key: "pointsPer100", title: "Points per 100 possessions", domain: [24, 35], ticks: [25, 30, 35], format: oneDecimal },
    { key: "usagePct", title: "Usage rate", domain: [22, 30], ticks: [22, 26, 30], format: percentUnits },
    { key: "trueShooting", title: "True shooting", domain: [0.52, 0.59], ticks: [0.52, 0.55, 0.58], format: fractionalPercent },
  ];
  let instanceCount = 0;

  function oneDecimal(value) { return value.toFixed(1); }
  function percentUnits(value) { return `${value.toFixed(1)}%`; }
  function fractionalPercent(value) { return `${(value * 100).toFixed(1)}%`; }
  function displaySeason(value) { return value.replace("-", "\u2013"); }
  function number(row, field) {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field}.`);
    return value;
  }
  function parseRow(row) {
    return {
      playerId: row.player_id?.trim(), playerName: row.player_name?.trim(), season: row.season?.trim(), team: row.team?.trim(),
      games: number(row, "games"), mpg: number(row, "minutes_per_game"), minutes: number(row, "total_minutes"),
      pointsPer100: number(row, "points_per_100"), usagePct: number(row, "usage_pct"),
      trueShooting: number(row, "ts_pct"), tsPlus: number(row, "ts_plus"),
    };
  }
  function validateRows(rows) {
    if (rows.length !== 3) throw new Error(`Expected three seasons, found ${rows.length}.`);
    const keys = new Set();
    rows.forEach((row, index) => {
      const key = `${row.season}|${row.team}`;
      if (keys.has(key)) throw new Error(`Duplicate season/team ${key}.`);
      keys.add(key);
      if (row.playerId !== "brandon-miller" || row.playerName !== "Brandon Miller" || row.team !== "CHO" || row.season !== SEASONS[index]) {
        throw new Error(`${key} has an unexpected identity or order.`);
      }
      if (!(row.trueShooting > 0 && row.trueShooting < 1) || row.usagePct < 1) throw new Error(`${row.season} has invalid percentage units.`);
      if (Math.abs(row.minutes / row.games - row.mpg) > 0.08) throw new Error(`${row.season} has inconsistent minutes fields.`);
      const actual = [row.games, row.mpg, row.minutes, row.pointsPer100, row.usagePct, row.trueShooting, row.tsPlus];
      if (actual.some((value, valueIndex) => value !== EXPECTED.get(row.season)[valueIndex])) throw new Error(`${row.season} conflicts with verified source values.`);
    });
  }

  class MillerChart {
    constructor(root) {
      this.root = root;
      this.plot = root.querySelector(".miller-chart__panels");
      this.status = root.querySelector(".miller-chart__status");
      this.instanceId = `miller-hornets-${++instanceCount}`;
      this.rows = [];
      this.lastWidth = 0;
      this.resizeObserver = new ResizeObserver(() => this.queueRender());
      this.resizeObserver.observe(this.plot);
    }
    load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = d3.csv(this.root.dataset.source, parseRow).then((rows) => {
        validateRows(rows);
        this.rows = rows;
        this.root.setAttribute("aria-busy", "false");
        this.status.remove();
        this.render(true);
        if (new URLSearchParams(location.search).getAll("preview").includes("hornets") && location.hash === "#team-hornets") {
          this.root.scrollIntoView({ block: "start", behavior: "instant" });
        }
      }).catch((error) => {
        console.error("Brandon Miller chart data error:", error);
        this.root.setAttribute("aria-busy", "false");
        this.status.className = "miller-chart__status miller-chart__status--error";
        this.status.textContent = "Miller's chart could not be displayed. The complete validated values remain available in the table below.";
      });
      return this.loadPromise;
    }
    queueRender() {
      if (!this.rows.length || this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => { this.queued = false; this.render(); });
    }
    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width || (!force && width === this.lastWidth)) return;
      this.lastWidth = width;
      this.plot.replaceChildren();
      METRICS.forEach((metric) => this.renderPanel(metric));
    }
    renderPanel(metric) {
      const panel = document.createElement("section");
      panel.className = "miller-chart__panel";
      const headingId = `${this.instanceId}-${metric.key}`;
      panel.innerHTML = `<h4 class="miller-chart__panel-title" id="${headingId}">${metric.title}</h4>`;
      this.plot.appendChild(panel);
      const width = Math.max(250, Math.floor(panel.getBoundingClientRect().width));
      const height = 300;
      const margin = { top: 31, right: 14, bottom: 86, left: 42 };
      const x = d3.scalePoint(SEASONS, [margin.left, width - margin.right]).padding(0.38);
      const y = d3.scaleLinear(metric.domain, [height - margin.bottom, margin.top]);
      const svg = d3.select(panel).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-labelledby", headingId);
      svg.append("rect").attr("class", "miller-chart__latest-band").attr("x", x("2025-26") - 28).attr("y", 8).attr("width", 56).attr("height", height - 16).attr("rx", 6);
      svg.append("g").selectAll("line").data(metric.ticks).join("line").attr("class", "miller-chart__gridline")
        .attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y).attr("y2", y);
      svg.append("g").selectAll("text").data(metric.ticks).join("text").attr("class", "miller-chart__y-label")
        .attr("x", margin.left - 7).attr("y", (tick) => y(tick) + 3.5).attr("text-anchor", "end").text(metric.format);
      svg.append("path").datum(this.rows).attr("class", "miller-chart__line")
        .attr("d", d3.line().x((row) => x(row.season)).y((row) => y(row[metric.key])));
      const marks = svg.append("g").selectAll("g").data(this.rows).join("g")
        .attr("class", (row) => `miller-chart__mark${row.season === "2025-26" ? " is-latest" : ""}${row.season === "2024-25" ? " is-small-sample" : ""}`)
        .attr("transform", (row) => `translate(${x(row.season)},${y(row[metric.key])})`);
      marks.append((row) => document.createElementNS("http://www.w3.org/2000/svg", row.season === "2025-26" ? "rect" : "circle"))
        .attr("x", (row) => row.season === "2025-26" ? -6 : null).attr("y", (row) => row.season === "2025-26" ? -6 : null)
        .attr("width", (row) => row.season === "2025-26" ? 12 : null).attr("height", (row) => row.season === "2025-26" ? 12 : null)
        .attr("rx", (row) => row.season === "2025-26" ? 2 : null).attr("r", (row) => row.season === "2025-26" ? null : 5)
        .append("title").text((row) => `${displaySeason(row.season)}: ${metric.format(row[metric.key])}; ${row.games} games, ${row.mpg.toFixed(1)} minutes per game.`);
      marks.append("text").attr("class", "miller-chart__value").attr("text-anchor", (row) => row.season === "2025-26" ? "end" : "middle")
        .attr("x", (row) => row.season === "2025-26" ? -10 : 0).attr("y", -12).text((row) => metric.format(row[metric.key]));
      const labels = svg.append("g").selectAll("g").data(this.rows).join("g")
        .attr("class", (row) => `miller-chart__x-label${row.season === "2025-26" ? " is-latest" : ""}`)
        .attr("transform", (row) => `translate(${x(row.season)},${height - margin.bottom + 21})`);
      labels.append("text").attr("class", "miller-chart__season").attr("text-anchor", "middle").text((row) => displaySeason(row.season));
      labels.append("text").attr("class", (row) => `miller-chart__sample${row.season === "2024-25" ? " is-warning" : ""}`).attr("text-anchor", "middle").attr("y", 17)
        .text((row) => row.season === "2024-25" ? "27 G \u00b7 smaller sample" : `${row.games} G`);
      labels.append("text").attr("class", "miller-chart__sample").attr("text-anchor", "middle").attr("y", 32).text((row) => `${row.mpg.toFixed(1)} MPG`);
      if (metric.key === "trueShooting") labels.append("text").attr("class", "miller-chart__ts-plus").attr("text-anchor", "middle").attr("y", 48).text((row) => `TS+ ${row.tsPlus}`);
    }
  }

  function mount(root) {
    if (!d3) {
      root.querySelector(".miller-chart__status").textContent = "Miller's chart could not load. The complete values remain available below.";
      return;
    }
    if (!root.millerChart) root.millerChart = new MillerChart(root);
    root.dataset.millerInitialized = "true";
    root.millerChart.load();
  }
  document.querySelectorAll("[data-miller-hornets-chart]").forEach((root) => {
    const card = root.closest("details");
    const loadWhenVisible = () => { if (!card || card.open) requestAnimationFrame(() => mount(root)); };
    card?.addEventListener("toggle", loadWhenVisible);
    loadWhenVisible();
  });
  window.validateMillerHornetsRows = validateRows;
})();
