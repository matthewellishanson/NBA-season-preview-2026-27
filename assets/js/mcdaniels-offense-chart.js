(function initializeMcDanielsOffenseCharts() {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
  const FULL_REGULAR_SEASONS = ["2020-21", ...SEASONS];
  const POSTSEASONS = ["2021-22", "2023-24", "2024-25", "2025-26"];
  const SERIES = [
    { type: "Regular season", className: "regular", symbol: "circle" },
    { type: "Playoffs", className: "playoffs", symbol: "diamond" },
  ];
  const METRICS = [
    {
      key: "pointsPer100",
      title: "Points per 100 possessions",
      unit: "Points per 100 possessions",
      domain: [0, 25],
      ticks: [0, 5, 10, 15, 20, 25],
      formatTick: (value) => String(value),
      formatValue: (value) => value.toFixed(1),
    },
    {
      key: "trueShooting",
      title: "True shooting percentage",
      unit: "True shooting (%)",
      domain: [0.45, 0.75],
      ticks: [0.5, 0.6, 0.7],
      formatTick: (value) => `${Math.round(value * 100)}%`,
      formatValue: formatFraction,
    },
    {
      key: "usage",
      title: "Usage percentage",
      unit: "Usage (%)",
      domain: [12, 24],
      ticks: [12, 16, 20, 24],
      formatTick: (value) => `${value}%`,
      formatValue: formatPercentPoints,
    },
  ];
  const EXPECTED = {
    "2024-25|Regular season": [18.9, 0.562, 16.3, 82],
    "2024-25|Playoffs": [22.3, 0.607, 17.4, 15],
    "2025-26|Regular season": [22.3, 0.611, 18.5, 73],
    "2025-26|Playoffs": [23.2, 0.512, 21.3, 12],
  };
  let instanceCount = 0;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function requiredText(row, field) {
    const value = row[field]?.trim() || "";
    if (!value) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function requiredNumber(row, field) {
    const raw = row[field]?.trim();
    if (raw === "" || raw == null) throw new Error(`Invalid or missing ${field}.`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function parseRow(row) {
    return {
      playerId: requiredText(row, "player_id"),
      playerName: requiredText(row, "player_name"),
      season: requiredText(row, "season"),
      seasonStart: requiredNumber(row, "season_start"),
      seasonType: requiredText(row, "season_type"),
      team: requiredText(row, "source_team"),
      age: requiredNumber(row, "season_age"),
      games: requiredNumber(row, "games"),
      starts: requiredNumber(row, "starts"),
      minutesPerGame: requiredNumber(row, "minutes_per_game"),
      totalMinutes: requiredNumber(row, "total_minutes"),
      pointsPerGame: requiredNumber(row, "points_per_game"),
      reboundsPerGame: requiredNumber(row, "rebounds_per_game"),
      assistsPerGame: requiredNumber(row, "assists_per_game"),
      pointsPer100: requiredNumber(row, "points_per_100"),
      reboundsPer100: requiredNumber(row, "rebounds_per_100"),
      assistsPer100: requiredNumber(row, "assists_per_100"),
      fgaPer100: requiredNumber(row, "fga_per_100"),
      fg3aPer100: requiredNumber(row, "fg3a_per_100"),
      turnoversPer100: requiredNumber(row, "turnovers_per_100"),
      trueShooting: requiredNumber(row, "ts_pct"),
      usage: requiredNumber(row, "usage_pct"),
      threePointPct: requiredNumber(row, "fg3_pct"),
      reboundPct: requiredNumber(row, "total_rebound_pct"),
      assistPct: requiredNumber(row, "assist_pct"),
      turnoverPct: requiredNumber(row, "turnover_pct"),
    };
  }

  function formatFraction(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function formatPercentPoints(value) {
    return `${value.toFixed(1)}%`;
  }

  function formatInteger(value) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function shortSeason(season) {
    return `${season.slice(2, 4)}–${season.slice(-2)}`;
  }

  function keyFor(row) {
    return `${row.season}|${row.seasonType}`;
  }

  function validateRows(rows) {
    if (rows.length !== 10) throw new Error(`Expected 10 normalized rows, found ${rows.length}.`);
    const identities = new Set();
    rows.forEach((row) => {
      if (row.playerId !== "jaden_mcdaniels" || row.playerName !== "Jaden McDaniels" || row.team !== "MIN") {
        throw new Error(`${row.season}: unexpected player or team identity.`);
      }
      if (!["Regular season", "Playoffs"].includes(row.seasonType)) {
        throw new Error(`${row.season}: unexpected season type.`);
      }
      const identity = `${row.playerId}|${row.season}|${row.seasonType}|${row.team}`;
      if (identities.has(identity)) throw new Error(`Duplicate normalized key ${identity}.`);
      identities.add(identity);
      if (row.seasonStart !== Number(row.season.slice(0, 4)) || row.games <= 0 || row.starts < 0 || row.starts > row.games) {
        throw new Error(`${row.season} ${row.seasonType}: invalid season metadata.`);
      }
      if (Math.abs(row.totalMinutes / row.games - row.minutesPerGame) > 0.051) {
        throw new Error(`${row.season} ${row.seasonType}: MPG reconciliation failed.`);
      }
      [row.trueShooting, row.threePointPct].forEach((value) => {
        if (value < 0 || value > 1) throw new Error(`${row.season}: invalid fractional percentage.`);
      });
      [row.usage, row.reboundPct, row.assistPct, row.turnoverPct].forEach((value) => {
        if (value < 0 || value > 100) throw new Error(`${row.season}: invalid percentage-point value.`);
      });
    });
    const regular = rows.filter((row) => row.seasonType === "Regular season").map((row) => row.season);
    const playoffs = rows.filter((row) => row.seasonType === "Playoffs").map((row) => row.season);
    if (regular.join("|") !== FULL_REGULAR_SEASONS.join("|") || playoffs.join("|") !== POSTSEASONS.join("|")) {
      throw new Error("Normalized season coverage is incomplete or unordered.");
    }
    const chartRows = rows.filter((row) => SEASONS.includes(row.season));
    if (chartRows.length !== 9) throw new Error(`Expected nine plotted observations, found ${chartRows.length}.`);
    const byKey = new Map(rows.map((row) => [keyFor(row), row]));
    Object.entries(EXPECTED).forEach(([key, expected]) => {
      const row = byKey.get(key);
      const actual = [row.pointsPer100, row.trueShooting, row.usage, row.games];
      expected.forEach((value, index) => {
        if (Math.abs(actual[index] - value) > 1e-9) throw new Error(`${key}: supplied-file check failed.`);
      });
    });
    if (byKey.has("2022-23|Playoffs")) throw new Error("The 2022-23 playoff gap must remain missing.");
    const latestRegular = byKey.get("2025-26|Regular season");
    const latestPlayoffs = byKey.get("2025-26|Playoffs");
    if (
      latestRegular.fgaPer100 !== 16.7 || latestPlayoffs.fgaPer100 !== 20.8
      || latestRegular.fg3aPer100 !== 5.2 || latestPlayoffs.fg3aPer100 !== 5.0
      || latestRegular.threePointPct !== 0.412 || latestPlayoffs.threePointPct !== 0.238
    ) throw new Error("Latest-season supporting-field check failed.");
  }

  function symbolType(name) {
    return name === "diamond" ? d3.symbolDiamond : d3.symbolCircle;
  }

  class McDanielsOffenseChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `mcdaniels-offense-${++instanceCount}`;
      this.rows = [];
      this.chartRows = [];
      this.rowsByKey = new Map();
      this.selectedSeason = "2025-26";
      this.lastWidth = 0;
      this.renderQueued = false;
      this.loadPromise = null;
      this.panelStates = [];
      this.plot = root.querySelector(".mcdaniels-offense__plot");
      this.status = root.querySelector(".mcdaniels-offense__status");
      this.inspectionSeason = root.querySelector(".mcdaniels-offense__inspection-season");
      this.inspectionValues = root.querySelector(".mcdaniels-offense__inspection-values");
      this.inspectionAnnouncement = root.querySelector(".mcdaniels-offense__inspection-announcement");
      this.tableWrap = root.querySelector(".mcdaniels-offense__table-wrap");
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
          this.chartRows = rows.filter((row) => SEASONS.includes(row.season));
          this.rowsByKey = new Map(rows.map((row) => [keyFor(row), row]));
          this.renderTable();
          this.root.setAttribute("aria-busy", "false");
          this.render(true);
          this.updateInspection();
        })
        .catch((error) => {
          console.error("McDaniels offense chart data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "mcdaniels-offense__status mcdaniels-offense__status--error";
          this.status.textContent = "The McDaniels comparison could not be displayed. The validated normalized CSV remains available.";
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

    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width) return;
      if (!force && width === this.lastWidth) return;
      this.lastWidth = width;
      this.plot.replaceChildren();
      this.panelStates = [];

      const panels = document.createElement("div");
      panels.className = "mcdaniels-offense__panels";
      this.plot.append(panels);
      METRICS.forEach((metric) => this.renderPanel(panels, metric));
      this.updateSelection();
    }

    renderPanel(container, metric) {
      const panel = document.createElement("section");
      panel.className = "mcdaniels-offense__panel";
      const title = document.createElement("h4");
      title.textContent = metric.title;
      panel.append(title);
      container.append(panel);

      const panelWidth = Math.max(240, Math.floor(panel.getBoundingClientRect().width));
      const compact = panelWidth < 330;
      const margin = { top: 15, right: 10, bottom: 38, left: compact ? 51 : 58 };
      const innerWidth = panelWidth - margin.left - margin.right;
      const innerHeight = compact ? 190 : 205;
      const height = innerHeight + margin.top + margin.bottom;
      const svgId = `${this.instanceId}-${metric.key}`;
      const svg = d3.select(panel).append("svg")
        .attr("class", "mcdaniels-offense__svg")
        .attr("viewBox", `0 0 ${panelWidth} ${height}`)
        .attr("width", panelWidth)
        .attr("height", height)
        .attr("role", "group")
        .attr("aria-labelledby", `${svgId}-title ${svgId}-desc`);
      svg.append("title").attr("id", `${svgId}-title`).text(metric.title);
      svg.append("desc").attr("id", `${svgId}-desc`).text(
        `Regular-season and playoff ${metric.title.toLowerCase()} for Jaden McDaniels from 2021-22 through 2025-26. The playoff series has no 2022-23 observation and its line breaks at that season.`
      );
      const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
      const x = d3.scalePoint().domain(SEASONS).range([0, innerWidth]).padding(0.12);
      const y = d3.scaleLinear().domain(metric.domain).range([innerHeight, 0]);

      chart.append("g")
        .attr("class", "mcdaniels-offense__grid")
        .call(d3.axisLeft(y).tickValues(metric.ticks).tickSize(-innerWidth).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      chart.append("g")
        .attr("class", "mcdaniels-offense__axis mcdaniels-offense__axis--y")
        .call(d3.axisLeft(y).tickValues(metric.ticks).tickFormat(metric.formatTick).tickSize(4).tickSizeOuter(0).tickPadding(7))
        .call((group) => group.select(".domain").remove());
      chart.append("g")
        .attr("class", "mcdaniels-offense__axis mcdaniels-offense__axis--x")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickFormat(shortSeason).tickSize(4).tickSizeOuter(0).tickPadding(8))
        .call((group) => group.select(".domain").remove());
      chart.append("text")
        .attr("class", "mcdaniels-offense__axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -margin.left + 12)
        .attr("text-anchor", "middle")
        .text(metric.unit);

      const guide = chart.append("line")
        .attr("class", "mcdaniels-offense__season-guide")
        .attr("y1", 0)
        .attr("y2", innerHeight);
      const line = d3.line()
        .defined((slot) => slot.row != null)
        .x((slot) => x(slot.season))
        .y((slot) => y(slot.row[metric.key]));
      const allPoints = [];

      SERIES.forEach((series) => {
        const slots = SEASONS.map((season) => ({
          season,
          row: this.rowsByKey.get(`${season}|${series.type}`) || null,
        }));
        chart.append("path")
          .datum(slots)
          .attr("class", `mcdaniels-offense__line mcdaniels-offense__line--${series.className}`)
          .attr("d", line);
        const points = chart.append("g")
          .selectAll("path")
          .data(slots.filter((slot) => slot.row), (slot) => slot.season)
          .join("path")
          .attr("class", `mcdaniels-offense__point mcdaniels-offense__point--${series.className}`)
          .attr("data-season", (slot) => slot.season)
          .attr("transform", (slot) => `translate(${x(slot.season)},${y(slot.row[metric.key])})`)
          .attr("d", d3.symbol().type(symbolType(series.symbol)).size(series.symbol === "diamond" ? 66 : 58));
        allPoints.push(points);
      });

      const step = SEASONS.length > 1 ? x(SEASONS[1]) - x(SEASONS[0]) : innerWidth;
      const hitWidth = Math.max(44, Math.min(step, 64));
      const hits = chart.append("g")
        .attr("class", "mcdaniels-offense__season-hits")
        .selectAll("rect")
        .data(SEASONS)
        .join("rect")
        .attr("class", "mcdaniels-offense__season-hit")
        .attr("data-season", (season) => season)
        .attr("x", (season) => x(season) - hitWidth / 2)
        .attr("y", 0)
        .attr("width", hitWidth)
        .attr("height", innerHeight)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (season) => `Select ${season} across all three McDaniels comparison panels`)
        .on("pointerenter pointerdown click focus", (event, season) => this.selectSeason(season))
        .on("keydown", (event, season) => this.handleSeasonKey(event, season));

      this.panelStates.push({ guide, hits, allPoints, x, y, metric });
    }

    handleSeasonKey(event, season) {
      let nextIndex = SEASONS.indexOf(season);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = Math.max(0, nextIndex - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = Math.min(SEASONS.length - 1, nextIndex + 1);
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = SEASONS.length - 1;
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectSeason(season);
        return;
      } else return;
      event.preventDefault();
      const nextSeason = SEASONS[nextIndex];
      const nextHit = event.currentTarget.parentElement.querySelector(`[data-season="${nextSeason}"]`);
      if (nextHit) nextHit.focus();
      this.selectSeason(nextSeason);
    }

    selectSeason(season) {
      if (!SEASONS.includes(season)) return;
      this.selectedSeason = season;
      this.updateSelection();
      this.updateInspection();
    }

    updateSelection() {
      this.panelStates.forEach(({ guide, hits, allPoints, x }) => {
        guide.attr("x1", x(this.selectedSeason)).attr("x2", x(this.selectedSeason));
        hits
          .classed("is-selected", (season) => season === this.selectedSeason)
          .attr("aria-pressed", (season) => String(season === this.selectedSeason));
        allPoints.forEach((points) => {
          points.classed("is-selected", (slot) => slot.season === this.selectedSeason);
        });
      });
    }

    inspectionCard(row, label, className) {
      return `<article class="mcdaniels-offense__inspection-card mcdaniels-offense__inspection-card--${className}">
        <strong>${escapeHtml(label)}</strong>
        <span>${row.games} G · ${formatInteger(row.totalMinutes)} total minutes · ${row.minutesPerGame.toFixed(1)} MPG</span>
        <span class="mcdaniels-offense__inspection-primary"><b>${row.pointsPer100.toFixed(1)}</b> PTS/100 · <b>${formatFraction(row.trueShooting)}</b> TS · <b>${formatPercentPoints(row.usage)}</b> USG</span>
        <span>FGA/100 ${row.fgaPer100.toFixed(1)} · 3PA/100 ${row.fg3aPer100.toFixed(1)} · 3P% ${formatFraction(row.threePointPct)}</span>
        <span>AST/100 ${row.assistsPer100.toFixed(1)} · TRB% ${formatPercentPoints(row.reboundPct)}</span>
      </article>`;
    }

    updateInspection() {
      if (!this.rows.length) return;
      const regular = this.rowsByKey.get(`${this.selectedSeason}|Regular season`);
      const playoffs = this.rowsByKey.get(`${this.selectedSeason}|Playoffs`);
      this.inspectionSeason.textContent = this.selectedSeason.replace("-", "–");
      const regularCard = this.inspectionCard(regular, "Regular season", "regular");
      const playoffCard = playoffs
        ? this.inspectionCard(playoffs, "Playoffs", "playoffs")
        : `<article class="mcdaniels-offense__inspection-card mcdaniels-offense__inspection-card--missing">
            <strong>Playoffs</strong>
            <span><b>No playoff appearance recorded.</b></span>
            <span>Postseason data are absent for this player-season; the regular-season values remain shown.</span>
          </article>`;
      this.inspectionValues.innerHTML = regularCard + playoffCard;
      this.inspectionAnnouncement.textContent = playoffs
        ? `${this.selectedSeason}. Regular season: ${regular.pointsPer100.toFixed(1)} points per 100, ${formatFraction(regular.trueShooting)} true shooting, ${formatPercentPoints(regular.usage)} usage. Playoffs: ${playoffs.pointsPer100.toFixed(1)} points per 100, ${formatFraction(playoffs.trueShooting)} true shooting, ${formatPercentPoints(playoffs.usage)} usage, ${playoffs.games} games and ${playoffs.totalMinutes} minutes.`
        : `${this.selectedSeason}. Regular season values are shown. No playoff appearance recorded; postseason data are absent for this player-season.`;
    }

    renderTable() {
      const columns = [
        ["Season", "Season", (row) => row.season.replace("-", "–")],
        ["Type", "Season type", (row) => row.seasonType],
        ["Age", "Age", (row) => row.age],
        ["G", "Games", (row) => row.games],
        ["GS", "Starts", (row) => row.starts],
        ["MPG", "Minutes/game", (row) => row.minutesPerGame.toFixed(1)],
        ["MP", "Total minutes", (row) => formatInteger(row.totalMinutes)],
        ["PPG", "Points/game", (row) => row.pointsPerGame.toFixed(1)],
        ["RPG", "Rebounds/game", (row) => row.reboundsPerGame.toFixed(1)],
        ["APG", "Assists/game", (row) => row.assistsPerGame.toFixed(1)],
        ["PTS/100", "Points/100", (row) => row.pointsPer100.toFixed(1)],
        ["TS%", "True shooting", (row) => formatFraction(row.trueShooting)],
        ["USG%", "Usage", (row) => formatPercentPoints(row.usage)],
        ["FGA/100", "Field-goal attempts/100", (row) => row.fgaPer100.toFixed(1)],
        ["3PA/100", "3-point attempts/100", (row) => row.fg3aPer100.toFixed(1)],
        ["3P%", "3-point percentage", (row) => formatFraction(row.threePointPct)],
        ["AST/100", "Assists/100", (row) => row.assistsPer100.toFixed(1)],
        ["TRB%", "Total rebound percentage", (row) => formatPercentPoints(row.reboundPct)],
      ];
      this.tableWrap.innerHTML = `<table class="mcdaniels-offense__table">
        <caption class="mcdaniels-offense__visually-hidden">Jaden McDaniels regular-season and playoff production, including the 2020-21 regular season retained outside the chart window</caption>
        <thead><tr>${columns.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
        <tbody>${this.rows.map((row) => `<tr class="mcdaniels-offense__table-row">${columns.map(([, mobileLabel, format], index) => {
          const tag = index === 0 ? "th" : "td";
          const scope = index === 0 ? ' scope="row"' : "";
          return `<${tag}${scope} data-label="${escapeHtml(mobileLabel)}">${escapeHtml(format(row))}</${tag}>`;
        }).join("")}</tr>`).join("")}</tbody>
      </table>`;
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-mcdaniels-offense-chart]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".mcdaniels-offense__status");
        status.className = "mcdaniels-offense__status mcdaniels-offense__status--error";
        status.textContent = "The chart library could not be loaded. The normalized CSV remains available.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.mcdanielsInitialized === "true") return;
      root.dataset.mcdanielsInitialized = "true";
      const chart = new McDanielsOffenseChart(root);
      root.mcdanielsOffenseChart = chart;
      const card = root.closest("details");
      const loadWhenVisible = () => {
        if (!card || card.open) requestAnimationFrame(() => chart.load().then(() => chart.queueRender()));
      };
      if (card) card.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  initialize();
})();
