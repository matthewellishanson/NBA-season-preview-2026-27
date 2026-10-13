(function initializeMaxeyCareerCharts() {
  "use strict";

  const d3 = window.d3;
  const EXPECTED = [
    ["2020-21", 20, 61, 935, 25.2, 6.2, 0.531, 23.0],
    ["2021-22", 21, 75, 2650, 24.7, 6.0, 0.594, 20.2],
    ["2022-23", 22, 60, 2016, 29.9, 5.2, 0.605, 24.1],
    ["2023-24", 23, 70, 2626, 34.0, 8.1, 0.573, 28.0],
    ["2024-25", 24, 52, 1960, 34.4, 8.0, 0.562, 29.8],
    ["2025-26", 25, 70, 2661, 35.9, 8.4, 0.588, 29.4],
  ];
  const METRICS = [
    { key: "points", title: "Points per 100 possessions", unit: "PTS per 100", format: (value) => value.toFixed(1), padding: 1.4 },
    { key: "assists", title: "Assists per 100 possessions", unit: "AST per 100", format: (value) => value.toFixed(1), padding: 0.55 },
    { key: "trueShooting", title: "True shooting percentage", unit: "TS%", format: (value) => `${(value * 100).toFixed(1)}%`, padding: 0.012 },
  ];
  let instanceCount = 0;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function number(row, field) {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function parseRow(row) {
    return {
      season: row.season?.trim() || "",
      startYear: number(row, "season_start_year"),
      player: row.player?.trim() || "",
      team: row.team?.trim() || "",
      age: number(row, "age"),
      games: number(row, "games"),
      minutes: number(row, "minutes"),
      points: number(row, "pts_per100"),
      assists: number(row, "ast_per100"),
      trueShooting: number(row, "ts_pct"),
      usage: number(row, "usg_pct"),
    };
  }

  function validateRows(rows) {
    if (rows.length !== EXPECTED.length) throw new Error(`Expected ${EXPECTED.length} completed seasons.`);
    const identities = new Set();
    rows.forEach((row, index) => {
      const expected = EXPECTED[index];
      const actual = [row.season, row.age, row.games, row.minutes, row.points, row.assists, row.trueShooting, row.usage];
      if (row.player !== "Tyrese Maxey" || row.team !== "PHI" || row.startYear !== 2020 + index) {
        throw new Error(`${row.season || `row ${index + 1}`} has an unexpected player, team, or year identity.`);
      }
      const identity = `${row.season}|${row.player}|${row.team}`;
      if (identities.has(identity)) throw new Error(`Duplicate season identity ${identity}.`);
      identities.add(identity);
      actual.forEach((value, fieldIndex) => {
        if (typeof value === "number" ? Math.abs(value - expected[fieldIndex]) > 1e-9 : value !== expected[fieldIndex]) {
          throw new Error(`${row.season || `row ${index + 1}`} conflicts with the verified source data.`);
        }
      });
    });
  }

  function shortSeason(season) {
    return `${season.slice(2, 4)}–${season.slice(-2)}`;
  }

  function paddedDomain(values, padding) {
    const [minimum, maximum] = d3.extent(values);
    return [minimum - padding, maximum + padding];
  }

  class MaxeyCareerChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `maxey-career-${++instanceCount}`;
      this.rows = [];
      this.loadPromise = null;
      this.lastWidth = 0;
      this.renderQueued = false;
      this.plot = root.querySelector(".maxey-career__plot");
      this.status = root.querySelector(".maxey-career__status");
      this.inspection = root.querySelector(".maxey-career__inspection");
      this.tableWrap = root.querySelector(".maxey-career__table-wrap");
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
          this.renderTable();
          this.render(true);
        })
        .catch((error) => {
          console.error("Tyrese Maxey career chart data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "maxey-career__status maxey-career__status--error";
          this.status.textContent = "Maxey’s career data could not be displayed. The accessible source table remains available in the processed CSV.";
        });
      return this.loadPromise;
    }

    queueRender() {
      if (!this.rows.length || this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        const width = Math.floor(this.plot.getBoundingClientRect().width);
        if (width > 0 && Math.abs(width - this.lastWidth) >= 2) this.render();
      });
    }

    renderTable() {
      const cells = [
        ["Age", (row) => row.age], ["G", (row) => row.games], ["MP", (row) => row.minutes.toLocaleString("en-US")],
        ["PTS/100", (row) => row.points.toFixed(1)], ["AST/100", (row) => row.assists.toFixed(1)],
        ["TS%", (row) => METRICS[2].format(row.trueShooting)], ["USG%", (row) => `${row.usage.toFixed(1)}%`],
      ];
      this.tableWrap.innerHTML = `<table class="maxey-career__table">
        <caption class="maxey-career__visually-hidden">Tyrese Maxey regular-season career trajectory data, including games, minutes, scoring, assists, true shooting, and usage</caption>
        <thead><tr><th scope="col">Season</th>${cells.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
        <tbody>${this.rows.map((row) => `<tr><th scope="row">${escapeHtml(row.season)}</th>${cells.map(([label, format]) => `<td data-label="${label}">${format(row)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
    }

    describe(row, metric) {
      return `${row.season}: ${metric.title} ${metric.format(row[metric.key])}; ${row.games} games, ${row.minutes.toLocaleString("en-US")} minutes, age ${row.age}, ${row.usage.toFixed(1)}% usage.`;
    }

    inspect(row, metric, x, y, tooltip) {
      const description = this.describe(row, metric);
      this.inspection.textContent = description;
      tooltip.innerHTML = `<strong>${escapeHtml(row.season)} · ${escapeHtml(metric.title)}</strong>${escapeHtml(metric.format(row[metric.key]))} · ${row.games} G · ${row.minutes.toLocaleString("en-US")} MP<br>Age ${row.age} · ${row.usage.toFixed(1)}% USG`;
      tooltip.hidden = false;
      const safeX = Math.max(125, Math.min(this.lastWidth - 125, x));
      tooltip.style.left = `${safeX}px`;
      tooltip.style.top = `${Math.max(70, y)}px`;
    }

    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width) return;
      if (!force && width === this.lastWidth) return;
      this.lastWidth = width;
      this.plot.replaceChildren();

      const stacked = width < 700;
      const height = stacked ? 750 : 340;
      const outer = stacked ? 4 : 2;
      const gap = stacked ? 20 : 15;
      const panelWidth = stacked ? width - outer * 2 : (width - outer * 2 - gap * 2) / 3;
      const panelHeight = stacked ? (height - gap * 2) / 3 : height;
      const svg = d3.select(this.plot).append("svg")
        .attr("class", "maxey-career__svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", `${this.instanceId}-title ${this.instanceId}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-title`).text("Tyrese Maxey’s expanding offensive role");
      svg.append("desc").attr("id", `${this.instanceId}-desc`).text("Three aligned line charts show Maxey's points and assists per 100 possessions and true shooting percentage for each regular season from 2020-21 through 2025-26. Each panel has an independent labeled vertical scale. Values are connected directly without smoothing or forecasting.");

      const tooltip = document.createElement("div");
      tooltip.className = "maxey-career__tooltip";
      tooltip.hidden = true;
      tooltip.setAttribute("role", "tooltip");
      this.plot.append(tooltip);

      METRICS.forEach((metric, metricIndex) => {
        const panelX = stacked ? outer : outer + metricIndex * (panelWidth + gap);
        const panelY = stacked ? metricIndex * (panelHeight + gap) : 0;
        const margin = { top: 51, right: 9, bottom: 37, left: stacked ? 42 : 37 };
        const left = panelX + margin.left;
        const right = panelX + panelWidth - margin.right;
        const top = panelY + margin.top;
        const bottom = panelY + panelHeight - margin.bottom;
        const x = d3.scalePoint().domain(this.rows.map((row) => row.season)).range([left, right]).padding(0.18);
        const y = d3.scaleLinear().domain(paddedDomain(this.rows.map((row) => row[metric.key]), metric.padding)).nice(4).range([bottom, top]);
        const panel = svg.append("g");
        panel.append("text").attr("class", "maxey-career__panel-title").attr("x", panelX + 4).attr("y", panelY + 18).text(metric.title);
        panel.append("text").attr("class", "maxey-career__panel-unit").attr("x", panelX + 4).attr("y", panelY + 34).text(`Independent scale · ${metric.unit}`);
        panel.append("g").attr("class", "maxey-career__grid")
          .attr("transform", `translate(${left},0)`)
          .call(d3.axisLeft(y).ticks(4).tickSize(-(right - left)).tickFormat(""))
          .call((group) => group.select(".domain").remove());
        panel.append("g").attr("class", "maxey-career__axis").attr("transform", `translate(${left},0)`)
          .call(d3.axisLeft(y).ticks(4).tickSize(3).tickFormat(metric.key === "trueShooting" ? (value) => `${Math.round(value * 100)}%` : d3.format(".1f")));
        panel.append("g").attr("class", "maxey-career__axis").attr("transform", `translate(0,${bottom})`)
          .call(d3.axisBottom(x).tickSize(3).tickFormat(shortSeason));
        panel.append("path").datum(this.rows).attr("class", "maxey-career__line")
          .attr("d", d3.line().x((row) => x(row.season)).y((row) => y(row[metric.key])));

        panel.selectAll(`.metric-point-${metricIndex}`).data(this.rows).join("circle")
          .attr("class", (row, index) => `maxey-career__point${index === this.rows.length - 1 ? " maxey-career__point--latest" : ""}`)
          .attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row[metric.key])).attr("r", 4.5);
        panel.selectAll(`.metric-value-${metricIndex}`).data(this.rows).join("text")
          .attr("class", (row, index) => `maxey-career__value${index === this.rows.length - 1 ? " maxey-career__value--latest" : ""}`)
          .attr("x", (row) => x(row.season))
          .attr("y", (row, index) => y(row[metric.key]) + (index % 2 && index < this.rows.length - 1 ? 16 : -9))
          .attr("text-anchor", "middle").text((row) => metric.format(row[metric.key]));
        panel.selectAll(`.metric-hit-${metricIndex}`).data(this.rows).join("circle")
          .attr("class", "maxey-career__hit").attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row[metric.key])).attr("r", 18)
          .attr("tabindex", 0).attr("role", "button")
          .attr("aria-label", (row) => this.describe(row, metric))
          .on("pointerenter focus click", (event, row) => this.inspect(row, metric, x(row.season), y(row[metric.key]), tooltip))
          .on("pointerleave blur", () => { tooltip.hidden = true; })
          .on("keydown", (event, row) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              this.inspect(row, metric, x(row.season), y(row[metric.key]), tooltip);
            } else if (event.key === "Escape") {
              tooltip.hidden = true;
            }
          });
      });
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-maxey-career-chart]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".maxey-career__status");
        status.className = "maxey-career__status maxey-career__status--error";
        status.textContent = "The chart library could not be loaded. The normalized CSV remains available.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.maxeyInitialized === "true") return;
      root.dataset.maxeyInitialized = "true";
      const chart = new MaxeyCareerChart(root);
      const card = root.closest("details");
      const loadWhenVisible = () => { if (!card || card.open) requestAnimationFrame(() => chart.load()); };
      if (card) card.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  initialize();
})();
