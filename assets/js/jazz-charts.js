(function initializeJazzCharts() {
  "use strict";

  const d3 = window.d3;
  const GEORGE_SEASONS = ["2023-24", "2024-25", "2025-26"];
  const REBOUND_SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"];
  const GEORGE_EXPECTED = new Map([
    ["2023-24", [23.2, 0.533, 22.8, 13.0, 4.4, 75, 27.0]],
    ["2024-25", [25.6, 0.539, 24.3, 16.8, 5.6, 67, 31.5]],
    ["2025-26", [33.5, 0.609, 27.9, 23.6, 6.1, 54, 33.1]],
  ]);
  const REBOUND_EXPECTED = {
    "lauri-markkanen": [[20.7, 13.6], [19.6, 13.6], [14.9, 10.1], [15.7, 10.8]],
    "jaren-jackson-jr": [[18.8, 12.6], [15.0, 9.4], [15.5, 10.0], [17.4, 10.1]],
  };
  let instanceCount = 0;

  const requiredNumber = (row, field) => {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid or missing ${field}.`);
    return value;
  };
  const seasonLabel = (season) => season.replace("-", "\u2013");

  function parseGeorge(row) {
    return {
      playerId: row.player_id.trim(), playerName: row.player_name.trim(), season: row.season.trim(),
      seasonType: row.season_type.trim(), team: row.team.trim(), games: requiredNumber(row, "games"),
      mpg: requiredNumber(row, "minutes_per_game"), minutes: requiredNumber(row, "total_minutes"),
      ppg: requiredNumber(row, "points_per_game"), apg: requiredNumber(row, "assists_per_game"),
      pointsPer100: requiredNumber(row, "points_per_100"), assistsPer100: requiredNumber(row, "assists_per_100"),
      trueShooting: requiredNumber(row, "ts_pct"), usagePct: requiredNumber(row, "usage_pct"),
    };
  }

  function validateGeorge(rows) {
    if (rows.length !== 3) throw new Error(`Expected three George rows, found ${rows.length}.`);
    rows.forEach((row, index) => {
      if (row.playerId !== "keyonte-george" || row.playerName !== "Keyonte George" || row.team !== "UTA" || row.seasonType !== "regular_season" || row.season !== GEORGE_SEASONS[index]) throw new Error("George player, team or season context is invalid.");
      if (row.trueShooting < 0 || row.trueShooting > 1 || row.usagePct < 1) throw new Error("George percentage units are invalid.");
      const actual = [row.pointsPer100, row.trueShooting, row.usagePct, row.ppg, row.apg, row.games, row.mpg];
      actual.forEach((value, i) => { if (value !== GEORGE_EXPECTED.get(row.season)[i]) throw new Error(`${row.season} conflicts with verified George values.`); });
    });
    if (Math.abs((rows[2].assistsPer100 - rows[1].assistsPer100) - 0.1) > 1e-9) throw new Error("George assist-rate context is invalid.");
  }

  function parseRebound(row) {
    return {
      playerId: row.player_id.trim(), playerName: row.player_name.trim(), season: row.season.trim(),
      seasonType: row.season_type.trim(), team: row.team.trim(), teamLabel: row.team_label.trim(),
      games: requiredNumber(row, "games"), minutes: requiredNumber(row, "total_minutes"),
      drbPct: requiredNumber(row, "drb_pct"), trbPct: requiredNumber(row, "trb_pct"),
    };
  }

  function validateRebounds(rows) {
    if (rows.length !== 8) throw new Error(`Expected eight rebounding rows, found ${rows.length}.`);
    Object.entries(REBOUND_EXPECTED).forEach(([playerId, expected]) => {
      const playerRows = rows.filter((row) => row.playerId === playerId);
      if (playerRows.length !== 4) throw new Error(`${playerId}: expected four rows.`);
      playerRows.forEach((row, index) => {
        if (row.season !== REBOUND_SEASONS[index] || row.seasonType !== "regular_season") throw new Error(`${playerId}: season coverage is invalid.`);
        if (row.drbPct !== expected[index][0] || row.trbPct !== expected[index][1]) throw new Error(`${playerId} ${row.season} conflicts with verified rebound values.`);
      });
    });
    const combined = rows.find((row) => row.playerId === "jaren-jackson-jr" && row.season === "2025-26");
    if (combined.team !== "2TM" || combined.teamLabel !== "Memphis/Utah combined") throw new Error("Jackson's 2025-26 combined-team context is missing.");
  }

  const GEORGE_METRICS = [
    { key: "pointsPer100", title: "Points per 100 possessions", domain: [20, 36], ticks: [20, 25, 30, 35], format: (v) => v.toFixed(1) },
    { key: "trueShooting", title: "True shooting percentage", domain: [0.50, 0.63], ticks: [0.50, 0.55, 0.60], format: (v) => `${(v * 100).toFixed(1)}%` },
    { key: "usagePct", title: "Usage percentage", domain: [20, 30], ticks: [20, 25, 30], format: (v) => `${v.toFixed(1)}%` },
  ];
  const REBOUND_METRICS = [
    { key: "drbPct", title: "Defensive rebound percentage", domain: [12, 22], ticks: [12, 16, 20], format: (v) => `${v.toFixed(1)}%` },
    { key: "trbPct", title: "Total rebound percentage", domain: [8, 15], ticks: [8, 10, 12, 14], format: (v) => `${v.toFixed(1)}%` },
  ];

  class JazzChart {
    constructor(root, type) {
      this.root = root; this.type = type; this.instanceId = `jazz-${type}-${++instanceCount}`;
      this.plot = root.querySelector(".jazz-chart__panels"); this.status = root.querySelector(".jazz-chart__status");
      this.rows = []; this.lastWidth = 0; this.renderQueued = false;
      this.resizeObserver = new ResizeObserver(() => this.queueRender()); this.resizeObserver.observe(this.plot);
    }
    load() {
      if (this.loadPromise) return this.loadPromise;
      const parser = this.type === "george" ? parseGeorge : parseRebound;
      const validator = this.type === "george" ? validateGeorge : validateRebounds;
      this.root.setAttribute("aria-busy", "true");
      this.loadPromise = d3.csv(this.root.dataset.source, parser).then((rows) => {
        validator(rows); this.rows = rows;
        if (this.type === "george") {
          const latest = rows.at(-1);
          const prior = rows.at(-2);
          this.root.querySelector("[data-jazz-george-annotation-value]").textContent = `${latest.pointsPer100.toFixed(1)} points per 100 possessions, with true shooting up ${((latest.trueShooting - prior.trueShooting) * 100).toFixed(1)} percentage points.`;
        }
        this.root.setAttribute("aria-busy", "false"); this.status.remove(); this.render(true);
      }).catch((error) => {
        console.error(`Jazz ${this.type} chart data error:`, error); this.root.setAttribute("aria-busy", "false");
        this.status.className = "jazz-chart__status jazz-chart__status--error";
        this.status.textContent = "This chart could not be displayed. The complete validated values remain available in the table below.";
      });
      return this.loadPromise;
    }
    queueRender() {
      if (!this.rows.length || this.renderQueued) return;
      this.renderQueued = true; requestAnimationFrame(() => { this.renderQueued = false; this.render(); });
    }
    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width || (!force && width === this.lastWidth)) return;
      this.lastWidth = width; this.plot.replaceChildren();
      (this.type === "george" ? GEORGE_METRICS : REBOUND_METRICS).forEach((metric) => this.renderPanel(metric));
    }
    renderPanel(metric) {
      const seasons = this.type === "george" ? GEORGE_SEASONS : REBOUND_SEASONS;
      const panel = document.createElement("section"); panel.className = "jazz-chart__panel";
      const heading = document.createElement("h4"); heading.className = "jazz-chart__panel-title";
      heading.id = `${this.instanceId}-${metric.key}`; heading.textContent = metric.title; panel.appendChild(heading); this.plot.appendChild(panel);
      const width = Math.max(270, Math.floor(panel.getBoundingClientRect().width));
      const height = this.type === "george" ? 285 : 300;
      const margin = { top: 34, right: this.type === "george" ? 18 : 82, bottom: this.type === "george" ? 70 : 48, left: 43 };
      const x = d3.scalePoint(seasons, [margin.left, width - margin.right]).padding(0.38);
      const y = d3.scaleLinear(metric.domain, [height - margin.bottom, margin.top]);
      const svg = d3.select(panel).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-labelledby", heading.id);
      if (this.type === "george") svg.append("rect").attr("class", "jazz-chart__latest-band").attr("x", x("2025-26") - 28).attr("y", 8).attr("width", 56).attr("height", height - 16).attr("rx", 6);
      svg.append("g").selectAll("line").data(metric.ticks).join("line").attr("class", "jazz-chart__gridline").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y).attr("y2", y);
      svg.append("g").selectAll("text").data(metric.ticks).join("text").attr("class", "jazz-chart__axis-label").attr("x", margin.left - 7).attr("y", (tick) => y(tick) + 3.5).attr("text-anchor", "end").text(metric.format);
      const groups = this.type === "george" ? [{ id: "george", rows: this.rows }] : [
        { id: "markkanen", rows: this.rows.filter((row) => row.playerId === "lauri-markkanen") },
        { id: "jackson", rows: this.rows.filter((row) => row.playerId === "jaren-jackson-jr") },
      ];
      const line = d3.line().x((row) => x(row.season)).y((row) => y(row[metric.key]));
      groups.forEach((group) => {
        svg.append("path").datum(group.rows).attr("class", `jazz-chart__line${group.id === "jackson" ? " jazz-chart__line--jackson" : ""}`).attr("d", line);
        const marks = svg.append("g").selectAll("g").data(group.rows).join("g")
          .attr("class", (row) => `jazz-chart__mark jazz-chart__mark--${group.id}${row.season === "2025-26" ? " is-latest" : ""}`)
          .attr("transform", (row) => `translate(${x(row.season)},${y(row[metric.key])})`);
        if (group.id === "jackson") marks.append("rect").attr("x", -5).attr("y", -5).attr("width", 10).attr("height", 10);
        else marks.append("circle").attr("r", (row) => this.type === "george" && row.season === "2025-26" ? 7 : 5);
        marks.select("circle,rect").append("title").text((row) => `${row.playerName}, ${seasonLabel(row.season)}: ${metric.format(row[metric.key])}; ${row.games} games, ${row.minutes.toLocaleString("en-US")} total minutes${row.teamLabel === "Memphis/Utah combined" ? "; Memphis/Utah combined" : ""}.`);
        marks.append("text").attr("class", `jazz-chart__value jazz-chart__value--${group.id}`)
          .attr("text-anchor", (row) => this.type === "george" ? "middle" : row.season === "2022-23" ? "start" : group.id === "markkanen" || row.season === "2025-26" ? "end" : "start")
          .attr("x", (row) => this.type === "george" ? 0 : row.season === "2022-23" ? 8 : group.id === "markkanen" || row.season === "2025-26" ? -8 : 8)
          .attr("y", (row) => this.type === "george" ? -11 : group.id === "markkanen" ? row.season === "2022-23" ? -18 : -7 : 13)
          .text((row) => metric.format(row[metric.key]));
        if (this.type === "rebounding") {
          const latest = group.rows[group.rows.length - 1];
          svg.append("text").attr("class", `jazz-chart__series-label jazz-chart__series-label--${group.id}`)
            .attr("x", x(latest.season) + 10).attr("y", y(latest[metric.key]) + (group.id === "markkanen" ? -7 : 13))
            .text(group.id === "markkanen" ? "Markkanen" : "Jackson");
        }
      });
      const labels = svg.append("g").selectAll("g").data(seasons).join("g").attr("transform", (season) => `translate(${x(season)},${height - margin.bottom + 22})`);
      labels.append("text").attr("class", "jazz-chart__season").attr("text-anchor", "middle")
        .text((season) => this.type === "rebounding" && width < 360 ? seasonLabel(season).slice(2) : seasonLabel(season));
      if (this.type === "george") labels.append("text").attr("class", "jazz-chart__sample").attr("text-anchor", "middle").attr("y", 17).text((season) => `${this.rows.find((row) => row.season === season).games} G`);
    }
  }

  function initialize(root, type) {
    if (!d3) { const status = root.querySelector(".jazz-chart__status"); status.className += " jazz-chart__status--error"; status.textContent = "This chart could not load. The complete values remain available below."; return; }
    if (!root.jazzChart) root.jazzChart = new JazzChart(root, type);
    root.jazzChart.load();
  }
  document.querySelectorAll("[data-jazz-george-chart], [data-jazz-rebounding-chart]").forEach((root) => {
    const card = root.closest("details"); const type = root.hasAttribute("data-jazz-george-chart") ? "george" : "rebounding";
    const loadWhenVisible = () => { if (!card || card.open) requestAnimationFrame(() => initialize(root, type)); };
    card?.addEventListener("toggle", loadWhenVisible); loadWhenVisible();
  });
  window.validateJazzGeorgeRows = validateGeorge;
  window.validateJazzReboundRows = validateRebounds;
})();
