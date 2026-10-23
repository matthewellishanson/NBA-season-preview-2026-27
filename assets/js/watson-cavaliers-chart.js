(function initializeWatsonCavaliersCharts() {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"];
  const EXPECTED = new Map([
    ["2022-23", [23, 186, 8.1, 19.7, 17.7, 0.553]],
    ["2023-24", [80, 1488, 18.6, 17.7, 16.2, 0.539]],
    ["2024-25", [68, 1656, 24.4, 16.0, 13.9, 0.564]],
    ["2025-26", [54, 1598, 29.6, 24.1, 20.6, 0.594]],
  ]);
  const METRICS = [
    {
      key: "pointsPer100",
      title: "Points per 100 possessions",
      domain: [14, 26],
      ticks: [15, 20, 25],
      format: (value) => value.toFixed(1),
    },
    {
      key: "usagePct",
      title: "Usage percentage",
      domain: [12, 22],
      ticks: [12, 16, 20],
      format: (value) => `${value.toFixed(1)}%`,
    },
    {
      key: "trueShooting",
      title: "True shooting percentage",
      domain: [0.52, 0.61],
      ticks: [0.52, 0.56, 0.60],
      format: (value) => `${(value * 100).toFixed(1)}%`,
    },
  ];
  let instanceCount = 0;

  function requiredNumber(row, field) {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function optionalNumber(row, field) {
    if (row[field] == null || row[field].trim() === "") return null;
    return requiredNumber(row, field);
  }

  function parseRow(row) {
    return {
      playerId: row.player_id?.trim() || "",
      playerName: row.player_name?.trim() || "",
      season: row.season?.trim() || "",
      seasonType: row.season_type?.trim() || "",
      team: row.team?.trim() || "",
      games: requiredNumber(row, "games"),
      starts: requiredNumber(row, "starts"),
      mpg: requiredNumber(row, "minutes_per_game"),
      minutes: requiredNumber(row, "total_minutes"),
      pointsPer100: requiredNumber(row, "points_per_100"),
      usagePct: requiredNumber(row, "usage_pct"),
      trueShooting: requiredNumber(row, "ts_pct"),
      onCourt: optionalNumber(row, "on_court_net_rating"),
      onOff: optionalNumber(row, "on_off_net_rating"),
    };
  }

  function validateRows(rows) {
    if (rows.length !== 4) throw new Error(`Expected four season rows, found ${rows.length}.`);
    const identities = new Set();
    rows.forEach((row, index) => {
      const identity = `${row.playerId}|${row.season}|${row.seasonType}|${row.team}`;
      if (identities.has(identity)) throw new Error(`Duplicate normalized identity ${identity}.`);
      identities.add(identity);
      if (row.playerId !== "peyton-watson" || row.playerName !== "Peyton Watson" || row.team !== "DEN") {
        throw new Error(`${identity} has an unexpected player or team identity.`);
      }
      if (row.season !== SEASONS[index] || row.seasonType !== "regular_season") {
        throw new Error("Regular-season coverage is incomplete or out of order.");
      }
      if (Math.abs(row.minutes / row.games - row.mpg) > 0.051) {
        throw new Error(`${row.season} has inconsistent MPG and total-minute units.`);
      }
      if (row.trueShooting < 0 || row.trueShooting > 1) throw new Error("TS% must be a fraction.");
      if (row.usagePct < 1) throw new Error("Usage must remain in percentage units.");
      const actual = [row.games, row.minutes, row.mpg, row.pointsPer100, row.usagePct, row.trueShooting];
      const expected = EXPECTED.get(row.season);
      actual.forEach((value, valueIndex) => {
        if (value !== expected[valueIndex]) throw new Error(`${row.season} conflicts with verified source values.`);
      });
    });
  }

  function displaySeason(season) {
    return season.replace("-", "\u2013");
  }

  class WatsonChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `watson-cavaliers-${++instanceCount}`;
      this.plot = root.querySelector(".watson-chart__panels");
      this.status = root.querySelector(".watson-chart__status");
      this.rows = [];
      this.lastWidth = 0;
      this.renderQueued = false;
      this.resizeObserver = new ResizeObserver(() => this.queueRender());
      this.resizeObserver.observe(this.plot);
    }

    load() {
      if (this.loadPromise) return this.loadPromise;
      this.root.setAttribute("aria-busy", "true");
      this.loadPromise = d3.csv(this.root.dataset.source, parseRow)
        .then((rows) => {
          validateRows(rows);
          this.rows = rows;
          this.root.setAttribute("aria-busy", "false");
          this.status.remove();
          this.render(true);
        })
        .catch((error) => {
          console.error("Peyton Watson chart data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "watson-chart__status watson-chart__status--error";
          this.status.textContent = "Watson's chart could not be displayed. The complete validated values remain available in the table below.";
        });
      return this.loadPromise;
    }

    queueRender() {
      if (!this.rows.length || this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render();
      });
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
      panel.className = "watson-chart__panel";
      const headingId = `${this.instanceId}-${metric.key}-title`;
      const heading = document.createElement("h4");
      heading.className = "watson-chart__panel-title";
      heading.id = headingId;
      heading.textContent = metric.title;
      panel.appendChild(heading);
      this.plot.appendChild(panel);

      const width = Math.max(250, Math.floor(panel.getBoundingClientRect().width));
      const height = 286;
      const margin = { top: 30, right: 14, bottom: 78, left: 42 };
      const x = d3.scalePoint(SEASONS, [margin.left, width - margin.right]).padding(0.38);
      const y = d3.scaleLinear(metric.domain, [height - margin.bottom, margin.top]);
      const svg = d3.select(panel).append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", headingId);

      svg.append("rect")
        .attr("class", "watson-chart__latest-band")
        .attr("x", x("2025-26") - 27)
        .attr("y", 8)
        .attr("width", 54)
        .attr("height", height - 17)
        .attr("rx", 6);

      svg.append("g")
        .selectAll("line")
        .data(metric.ticks)
        .join("line")
        .attr("class", "watson-chart__gridline")
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", (tick) => y(tick))
        .attr("y2", (tick) => y(tick));

      svg.append("g")
        .selectAll("text")
        .data(metric.ticks)
        .join("text")
        .attr("class", "watson-chart__y-label")
        .attr("x", margin.left - 7)
        .attr("y", (tick) => y(tick) + 3.5)
        .attr("text-anchor", "end")
        .text(metric.format);

      const line = d3.line()
        .x((row) => x(row.season))
        .y((row) => y(row[metric.key]));

      svg.append("path")
        .datum(this.rows)
        .attr("class", "watson-chart__line")
        .attr("d", line);

      const marks = svg.append("g")
        .selectAll("g")
        .data(this.rows)
        .join("g")
        .attr("class", (row) => `watson-chart__mark${row.season === "2025-26" ? " is-latest" : ""}`)
        .attr("transform", (row) => `translate(${x(row.season)},${y(row[metric.key])})`);

      marks.append("circle")
        .attr("r", (row) => row.season === "2025-26" ? 7 : 5)
        .append("title")
        .text((row) => `${displaySeason(row.season)}: ${metric.format(row[metric.key])}; ${row.games} games, ${row.minutes.toLocaleString("en-US")} total minutes.`);

      marks.append("text")
        .attr("class", "watson-chart__value")
        .attr("text-anchor", (row) => row.season === "2025-26" ? "end" : "middle")
        .attr("x", (row) => row.season === "2025-26" ? -10 : 0)
        .attr("y", -11)
        .text((row) => metric.format(row[metric.key]));

      const labels = svg.append("g")
        .selectAll("g")
        .data(this.rows)
        .join("g")
        .attr("class", (row) => `watson-chart__x-label${row.season === "2025-26" ? " is-latest" : ""}`)
        .attr("transform", (row) => `translate(${x(row.season)},${height - margin.bottom + 21})`);

      labels.append("text")
        .attr("text-anchor", "middle")
        .attr("class", "watson-chart__season")
        .text((row) => displaySeason(row.season));
      labels.append("text")
        .attr("text-anchor", "middle")
        .attr("class", "watson-chart__sample")
        .attr("y", 17)
        .text((row) => `${row.games} G`);
      labels.append("text")
        .attr("text-anchor", "middle")
        .attr("class", "watson-chart__sample")
        .attr("y", 31)
        .text((row) => `${row.minutes.toLocaleString("en-US")} MIN`);
    }
  }

  function loadChart(root) {
    if (!d3) {
      const status = root.querySelector(".watson-chart__status");
      status.className = "watson-chart__status watson-chart__status--error";
      status.textContent = "Watson's chart could not be displayed. The complete values remain available below.";
      return;
    }
    if (!root.watsonCavaliersChart) root.watsonCavaliersChart = new WatsonChart(root);
    root.dataset.watsonInitialized = "true";
    root.watsonCavaliersChart.load();
  }

  document.querySelectorAll("[data-watson-cavaliers-chart]").forEach((root) => {
    const card = root.closest("details");
    const loadWhenVisible = () => {
      if (!card || card.open) requestAnimationFrame(() => loadChart(root));
    };
    card?.addEventListener("toggle", loadWhenVisible);
    loadWhenVisible();
  });

  window.validateWatsonCavaliersRows = validateRows;
})();
