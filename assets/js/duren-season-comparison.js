(function initializeDurenSeasonComparisons() {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2024-25", "2025-26"];
  const SEASON_TYPES = ["regular_season", "playoffs"];
  const EXPECTED = new Map([
    ["2024-25|regular_season", [21.7, 0.703, 22.0, 17.2, 16.4, 78, 2034]],
    ["2024-25|playoffs", [17.3, 0.708, 18.1, 16.6, 12.8, 6, 203]],
    ["2025-26|regular_season", [33.4, 0.688, 20.9, 11.6, 23.6, 70, 1976]],
    ["2025-26|playoffs", [17.3, 0.553, 16.1, 19.8, 16.7, 14, 422]],
  ]);
  const METRICS = [
    {
      key: "pointsPer100",
      title: "Points per 100 possessions",
      short: "PTS/100",
      domain: [0, 36],
      ticks: [0, 10, 20, 30],
      format: (value) => value.toFixed(1),
      axisFormat: (value) => String(value),
    },
    {
      key: "trueShooting",
      title: "True shooting percentage",
      short: "TS%",
      domain: [0.5, 0.74],
      ticks: [0.5, 0.55, 0.6, 0.65, 0.7],
      format: formatFraction,
      axisFormat: (value) => `${Math.round(value * 100)}%`,
    },
    {
      key: "totalReboundPct",
      title: "Total rebound percentage",
      short: "TRB%",
      domain: [15, 23],
      ticks: [16, 18, 20, 22],
      format: formatPercentPoints,
      axisFormat: (value) => `${value}%`,
    },
    {
      key: "turnoverPct",
      title: "Turnover percentage",
      short: "TOV%",
      domain: [10, 21],
      ticks: [12, 16, 20],
      format: formatPercentPoints,
      axisFormat: (value) => `${value}%`,
    },
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

  function formatFraction(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function formatPercentPoints(value) {
    return `${value.toFixed(1)}%`;
  }

  function seasonTypeLabel(seasonType) {
    return seasonType === "regular_season" ? "Regular season" : "Playoffs";
  }

  function parseRow(row) {
    return {
      playerId: row.player_id?.trim() || "",
      playerName: row.player_name?.trim() || "",
      season: row.season?.trim() || "",
      seasonStart: number(row, "season_start"),
      seasonType: row.season_type?.trim() || "",
      team: row.source_team?.trim() || "",
      age: number(row, "season_age"),
      games: number(row, "games"),
      starts: number(row, "starts"),
      minutesPerGame: number(row, "minutes_per_game"),
      totalMinutes: number(row, "total_minutes"),
      pointsPerGame: number(row, "points_per_game"),
      reboundsPerGame: number(row, "rebounds_per_game"),
      assistsPerGame: number(row, "assists_per_game"),
      pointsPer100: number(row, "points_per_100"),
      reboundsPer100: number(row, "rebounds_per_100"),
      assistsPer100: number(row, "assists_per_100"),
      fgaPer100: number(row, "fga_per_100"),
      turnoversPer100: number(row, "turnovers_per_100"),
      trueShooting: number(row, "ts_pct"),
      usage: number(row, "usage_pct"),
      totalReboundPct: number(row, "total_rebound_pct"),
      turnoverPct: number(row, "turnover_pct"),
      offensiveReboundPct: number(row, "offensive_rebound_pct"),
      defensiveReboundPct: number(row, "defensive_rebound_pct"),
      perGameSource: row.per_game_source_row_id?.trim() || "",
      p100Source: row.p100_source_row_id?.trim() || "",
      advancedSource: row.advanced_source_row_id?.trim() || "",
    };
  }

  function validateRows(rows) {
    if (rows.length !== 6) throw new Error(`Expected six normalized rows, found ${rows.length}.`);
    const identities = new Set();
    const coverage = { regular_season: [], playoffs: [] };
    rows.forEach((row) => {
      const identity = [row.playerId, row.playerName, row.season, row.seasonType, row.team].join("|");
      if (identities.has(identity)) throw new Error(`Duplicate normalized identity ${identity}.`);
      identities.add(identity);
      if (row.playerId !== "jalen_duren" || row.playerName !== "Jalen Duren" || row.team !== "DET") {
        throw new Error(`${identity} has an unexpected player or team identity.`);
      }
      if (!SEASON_TYPES.includes(row.seasonType)) throw new Error(`Unexpected season type ${row.seasonType}.`);
      coverage[row.seasonType].push(row.season);
      if (Math.abs(row.totalMinutes / row.games - row.minutesPerGame) > 0.051) {
        throw new Error(`${row.season} ${row.seasonType} has inconsistent minute units.`);
      }
      if (row.trueShooting < 0 || row.trueShooting > 1) throw new Error("TS% must be a fraction.");
      [row.usage, row.totalReboundPct, row.turnoverPct, row.offensiveReboundPct, row.defensiveReboundPct]
        .forEach((value) => {
          if (value < 0 || value > 100) throw new Error("Percentage-point field is outside [0, 100].");
        });
      if (!row.perGameSource || !row.p100Source || !row.advancedSource) {
        throw new Error(`${row.season} ${row.seasonType} is missing source provenance.`);
      }
    });
    if (coverage.regular_season.join("|") !== "2022-23|2023-24|2024-25|2025-26") {
      throw new Error("Regular-season coverage is incomplete or out of order.");
    }
    if (coverage.playoffs.join("|") !== "2024-25|2025-26") {
      throw new Error("Postseason coverage is incomplete or out of order.");
    }

    const plotted = rows.filter((row) => SEASONS.includes(row.season));
    if (plotted.length !== 4) throw new Error(`Expected four plotted observations, found ${plotted.length}.`);
    plotted.forEach((row) => {
      const key = `${row.season}|${row.seasonType}`;
      const expected = EXPECTED.get(key);
      if (!expected) throw new Error(`Unexpected plotted identity ${key}.`);
      const actual = [row.pointsPer100, row.trueShooting, row.totalReboundPct, row.turnoverPct, row.usage, row.games, row.totalMinutes];
      actual.forEach((value, index) => {
        if (Math.abs(value - expected[index]) > 1e-9) {
          throw new Error(`${key} conflicts with the verified source values.`);
        }
      });
    });
  }

  class DurenSeasonComparison {
    constructor(root) {
      this.root = root;
      this.instanceId = `duren-season-comparison-${++instanceCount}`;
      this.rows = [];
      this.plottedRows = [];
      this.loadPromise = null;
      this.lastWidth = 0;
      this.renderQueued = false;
      this.selectedKey = "2025-26|playoffs";
      this.panelStates = [];
      this.plot = root.querySelector(".duren-comparison__plot");
      this.status = root.querySelector(".duren-comparison__status");
      this.inspection = root.querySelector(".duren-comparison__inspection-values");
      this.inspectionTitle = root.querySelector(".duren-comparison__inspection-title");
      this.tableWrap = root.querySelector(".duren-comparison__table-wrap");
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
          this.plottedRows = SEASONS.flatMap((season) => SEASON_TYPES.map((seasonType) =>
            rows.find((row) => row.season === season && row.seasonType === seasonType),
          ));
          this.root.setAttribute("aria-busy", "false");
          this.renderTable();
          this.updateInspection();
          this.render(true);
        })
        .catch((error) => {
          console.error("Jalen Duren season comparison data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "duren-comparison__status duren-comparison__status--error";
          this.status.textContent = "Duren's season comparison could not be displayed. The validated normalized CSV remains available.";
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

    rowFor(season, seasonType) {
      return this.plottedRows.find((row) => row.season === season && row.seasonType === seasonType);
    }

    describe(row, metric) {
      return `${row.season} ${seasonTypeLabel(row.seasonType)}: ${metric.title} ${metric.format(row[metric.key])}; ${row.games} games, ${row.totalMinutes.toLocaleString("en-US")} total minutes, ${row.minutesPerGame.toFixed(1)} minutes per game, ${row.usage.toFixed(1)}% usage.`;
    }

    select(row) {
      this.selectedKey = `${row.season}|${row.seasonType}`;
      this.root.querySelectorAll(".duren-comparison__hit").forEach((hit) => {
        const selected = hit.dataset.key === this.selectedKey;
        hit.setAttribute("aria-pressed", String(selected));
        hit.classList.toggle("is-selected", selected);
      });
      this.root.querySelectorAll(".duren-comparison__mark").forEach((mark) => {
        mark.classList.toggle("is-selected", mark.dataset.key === this.selectedKey);
      });
      this.updateInspection();
    }

    updateInspection() {
      if (!this.plottedRows.length) return;
      const row = this.plottedRows.find((candidate) => `${candidate.season}|${candidate.seasonType}` === this.selectedKey)
        || this.plottedRows[0];
      this.inspectionTitle.textContent = `${row.season.replace("-", "–")} · ${seasonTypeLabel(row.seasonType)}`;
      const values = [
        ["Sample", `${row.games} G · ${row.totalMinutes.toLocaleString("en-US")} MP`],
        ["Minutes/game", row.minutesPerGame.toFixed(1)],
        ["Usage", formatPercentPoints(row.usage)],
        ["Points/100", row.pointsPer100.toFixed(1)],
        ["True shooting", formatFraction(row.trueShooting)],
        ["Total rebound", formatPercentPoints(row.totalReboundPct)],
        ["Turnover", formatPercentPoints(row.turnoverPct)],
      ];
      this.inspection.innerHTML = values.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
    }

    renderTable() {
      const columns = [
        ["Season", "Season", (row) => row.season.replace("-", "–")],
        ["Type", "Season type", (row) => seasonTypeLabel(row.seasonType)],
        ["G", "Games", (row) => row.games],
        ["MP", "Total minutes", (row) => row.totalMinutes.toLocaleString("en-US")],
        ["MPG", "Minutes/game", (row) => row.minutesPerGame.toFixed(1)],
        ["USG%", "Usage", (row) => formatPercentPoints(row.usage)],
        ["PTS/100", "Points/100", (row) => row.pointsPer100.toFixed(1)],
        ["TS%", "True shooting", (row) => formatFraction(row.trueShooting)],
        ["TRB%", "Total rebound", (row) => formatPercentPoints(row.totalReboundPct)],
        ["TOV%", "Turnover", (row) => formatPercentPoints(row.turnoverPct)],
      ];
      this.tableWrap.innerHTML = `<table class="duren-comparison__table team-graphic__table">
        <caption class="duren-comparison__visually-hidden">Jalen Duren regular-season and postseason sample and plotted values for 2024-25 and 2025-26</caption>
        <thead><tr>${columns.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
        <tbody>${this.plottedRows.map((row) => `<tr class="duren-comparison__table-row">${columns.map(([label, mobileLabel, format], index) => {
          const tag = index === 0 ? "th" : "td";
          const scope = index === 0 ? ' scope="row"' : "";
          return `<${tag}${scope} data-label="${escapeHtml(mobileLabel)}">${escapeHtml(format(row))}</${tag}>`;
        }).join("")}</tr>`).join("")}</tbody>
      </table>`;
    }

    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width) return;
      if (!force && width === this.lastWidth) return;
      this.lastWidth = width;
      this.plot.replaceChildren();
      this.panelStates = [];
      const panels = d3.select(this.plot).selectAll("section")
        .data(METRICS)
        .join("section")
        .attr("class", "duren-comparison__panel")
        .attr("aria-label", (metric) => metric.title);
      panels.append("h4").text((metric) => metric.title);
      panels.append("p").attr("class", "duren-comparison__panel-note")
        .text((metric) => metric.key === "pointsPer100" ? "Per 100 possessions · scale starts at zero" : "Percentage · shared scale across both seasons");
      panels.each((metric, index, nodes) => this.renderPanel(nodes[index], metric, index));
    }

    renderPanel(panelNode, metric, metricIndex) {
      const panelWidth = Math.max(260, Math.floor(panelNode.getBoundingClientRect().width) - 18);
      const height = 210;
      const margin = { top: 29, right: 19, bottom: 34, left: panelWidth < 330 ? 65 : 72 };
      const left = margin.left;
      const right = panelWidth - margin.right;
      const top = margin.top;
      const bottom = height - margin.bottom;
      const x = d3.scaleLinear().domain(metric.domain).range([left, right]);
      const y = d3.scalePoint().domain(SEASONS).range([top + 20, bottom - 20]);
      this.panelStates.push({ metric, x, y });
      const svg = d3.select(panelNode).append("svg")
        .attr("class", "duren-comparison__svg")
        .attr("viewBox", `0 0 ${panelWidth} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", `${this.instanceId}-${metricIndex}-title ${this.instanceId}-${metricIndex}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-${metricIndex}-title`).text(metric.title);
      svg.append("desc").attr("id", `${this.instanceId}-${metricIndex}-desc`)
        .text(`${metric.title} for Jalen Duren in the 2024-25 and 2025-26 regular seasons and playoffs. A neutral line connects the two actual values in each season row.`);

      svg.append("g").attr("class", "duren-comparison__grid")
        .attr("transform", `translate(0,${bottom})`)
        .call(d3.axisBottom(x).tickValues(metric.ticks).tickSize(-(bottom - top)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("g").attr("class", "duren-comparison__axis duren-comparison__axis--x")
        .attr("transform", `translate(0,${bottom})`)
        .call(d3.axisBottom(x).tickValues(metric.ticks).tickSize(4).tickFormat(metric.axisFormat));
      svg.append("g").attr("class", "duren-comparison__axis duren-comparison__axis--y")
        .attr("transform", `translate(${left},0)`)
        .call(d3.axisLeft(y).tickSize(0).tickPadding(9).tickFormat((season) => season.replace("-", "–")))
        .call((group) => group.select(".domain").remove());

      SEASONS.forEach((season) => {
        const regular = this.rowFor(season, "regular_season");
        const playoffs = this.rowFor(season, "playoffs");
        svg.append("line")
          .attr("class", "duren-comparison__connector")
          .attr("x1", x(regular[metric.key]))
          .attr("x2", x(playoffs[metric.key]))
          .attr("y1", y(season))
          .attr("y2", y(season));
      });

      this.plottedRows.forEach((row) => {
        const cx = x(row[metric.key]);
        const cy = y(row.season);
        const key = `${row.season}|${row.seasonType}`;
        const symbol = d3.symbol()
          .type(row.seasonType === "regular_season" ? d3.symbolCircle : d3.symbolDiamond)
          .size(row.seasonType === "regular_season" ? 88 : 104);
        svg.append("path")
          .attr("class", `duren-comparison__mark duren-comparison__mark--${row.seasonType === "regular_season" ? "regular" : "playoffs"}`)
          .attr("data-key", key)
          .classed("is-selected", key === this.selectedKey)
          .attr("transform", `translate(${cx},${cy})`)
          .attr("d", symbol());
        svg.append("text")
          .attr("class", `duren-comparison__value duren-comparison__value--${row.seasonType === "regular_season" ? "regular" : "playoffs"}`)
          .attr("x", cx)
          .attr("y", cy + (row.seasonType === "regular_season" ? -11 : 17))
          .attr("text-anchor", "middle")
          .text(metric.format(row[metric.key]));
        svg.append("circle")
          .attr("class", "duren-comparison__hit")
          .attr("data-key", key)
          .attr("cx", cx)
          .attr("cy", cy)
          .attr("r", 18)
          .attr("tabindex", 0)
          .attr("role", "button")
          .attr("aria-pressed", String(key === this.selectedKey))
          .attr("aria-label", this.describe(row, metric))
          .classed("is-selected", key === this.selectedKey)
          .on("pointerenter pointerdown click focus", () => this.select(row))
          .on("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              this.select(row);
            }
          });
      });
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-duren-season-comparison]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".duren-comparison__status");
        status.className = "duren-comparison__status duren-comparison__status--error";
        status.textContent = "The chart library could not be loaded. The validated normalized CSV remains available.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.durenInitialized === "true") return;
      root.dataset.durenInitialized = "true";
      const chart = new DurenSeasonComparison(root);
      root.durenSeasonComparison = chart;
      const card = root.closest("details");
      const loadWhenVisible = () => {
        if (!card || card.open) requestAnimationFrame(() => chart.load());
      };
      if (card) card.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  initialize();
})();
