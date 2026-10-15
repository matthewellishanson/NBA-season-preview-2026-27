(function initializeCelticsWingComparisons() {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
  const PLAYER_ORDER = ["jaylen_brown", "jayson_tatum", "paul_george"];
  const PLAYER_CONFIG = {
    jaylen_brown: { name: "Jaylen Brown", className: "brown", symbol: "circle" },
    jayson_tatum: { name: "Jayson Tatum", className: "tatum", symbol: "diamond" },
    paul_george: { name: "Paul George", className: "george", symbol: "square" },
  };
  const EXPECTED_2025_26 = {
    jaylen_brown: [71, 42.2, 7.5, 0.573, 36.2],
    jayson_tatum: [16, 33.7, 8.2, 0.541, 30.0],
    paul_george: [37, 27.3, 5.7, 0.570, 23.3],
  };
  const VIEWS = {
    availability: [
      { key: "games", title: "Games played", unit: "Games", fixedDomain: [0, 82], ticks: 5, format: d3 ? d3.format("d") : String },
      { key: "minutesPerGame", title: "Minutes per game", unit: "Minutes per game", padding: 1.5, ticks: 5, format: (value) => value.toFixed(1) },
      { key: "age", title: "Season age", unit: "Age in years", padding: 1, ticks: 5, format: d3 ? d3.format("d") : String },
    ],
    offense: [
      { key: "pointsPer100", title: "Points per 100 possessions", unit: "Points per 100 possessions", zeroBased: true, step: 5, ticks: 5, format: (value) => value.toFixed(1) },
      { key: "assistsPer100", title: "Assists per 100 possessions", unit: "Assists per 100 possessions", zeroBased: true, step: 1, ticks: 5, format: (value) => value.toFixed(1) },
      { key: "trueShooting", title: "True shooting percentage", unit: "True shooting percentage", padding: 0.025, ticks: 5, percent: true, format: formatFraction },
      { key: "usage", title: "Usage percentage", unit: "Usage percentage", padding: 2, ticks: 5, percentPoints: true, format: formatPercentPoints },
    ],
  };
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

  function text(row, field) {
    const value = row[field]?.trim() || "";
    if (!value) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function parseRow(row) {
    return {
      playerId: text(row, "player_id"),
      playerName: text(row, "player_name"),
      season: text(row, "season"),
      seasonStart: number(row, "season_start"),
      age: number(row, "season_age"),
      team: text(row, "source_team"),
      league: text(row, "league"),
      position: text(row, "position"),
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
      turnoversPer100: number(row, "turnovers_per_100"),
      fgaPer100: number(row, "fga_per_100"),
      ftaPer100: number(row, "fta_per_100"),
      fg3aPer100: number(row, "fg3a_per_100"),
      fieldGoalPct: number(row, "fg_pct"),
      threePointPct: number(row, "fg3_pct"),
      freeThrowPct: number(row, "ft_pct"),
      effectiveFieldGoalPct: number(row, "efg_pct"),
      trueShooting: number(row, "ts_pct"),
      usage: number(row, "usage_pct"),
      assistPct: number(row, "assist_pct"),
      turnoverPct: number(row, "turnover_pct"),
      threePointAttemptRate: number(row, "three_point_attempt_rate"),
      freeThrowAttemptRate: number(row, "free_throw_attempt_rate"),
    };
  }

  function formatFraction(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function formatPercentPoints(value) {
    return `${value.toFixed(1)}%`;
  }

  function shortSeason(season) {
    return `${season.slice(2, 4)}–${season.slice(-2)}`;
  }

  function validateRows(rows) {
    if (rows.length !== 15) throw new Error(`Expected 15 player-season rows, found ${rows.length}.`);
    const identities = new Set();
    rows.forEach((row) => {
      if (!PLAYER_CONFIG[row.playerId] || row.playerName !== PLAYER_CONFIG[row.playerId].name) {
        throw new Error(`${row.season}: unexpected player identity.`);
      }
      if (!SEASONS.includes(row.season) || row.seasonStart !== Number(row.season.slice(0, 4))) {
        throw new Error(`${row.playerName}: unexpected season identity ${row.season}.`);
      }
      const identity = `${row.playerId}|${row.season}`;
      if (identities.has(identity)) throw new Error(`Duplicate player-season ${identity}.`);
      identities.add(identity);
      if (row.league !== "NBA" || row.games < 0 || row.games > 82 || row.starts < 0 || row.starts > row.games) {
        throw new Error(`${row.playerName} ${row.season}: invalid metadata.`);
      }
      [row.fieldGoalPct, row.threePointPct, row.freeThrowPct, row.effectiveFieldGoalPct, row.trueShooting, row.threePointAttemptRate, row.freeThrowAttemptRate].forEach((value) => {
        if (value < 0 || value > 1) throw new Error(`${row.playerName} ${row.season}: invalid fractional percentage.`);
      });
      [row.usage, row.assistPct, row.turnoverPct].forEach((value) => {
        if (value < 0 || value > 100) throw new Error(`${row.playerName} ${row.season}: invalid percentage-point value.`);
      });
    });
    PLAYER_ORDER.forEach((playerId) => {
      const playerRows = rows.filter((row) => row.playerId === playerId);
      if (playerRows.length !== 5 || playerRows.some((row, index) => row.season !== SEASONS[index])) {
        throw new Error(`${PLAYER_CONFIG[playerId].name}: incomplete or unordered season coverage.`);
      }
      playerRows.forEach((row) => {
        const expectedTeam = playerId === "paul_george" && row.seasonStart >= 2024 ? "PHI" : playerId === "paul_george" ? "LAC" : "BOS";
        if (row.team !== expectedTeam) throw new Error(`${row.playerName} ${row.season}: unexpected historical team.`);
      });
      const latest = playerRows[4];
      const actual = [latest.games, latest.pointsPer100, latest.assistsPer100, latest.trueShooting, latest.usage];
      EXPECTED_2025_26[playerId].forEach((expected, index) => {
        if (Math.abs(actual[index] - expected) > 1e-9) {
          throw new Error(`${latest.playerName} 2025-26 conflicts with the supplied-file check.`);
        }
      });
    });
    const tatumLatest = rows.find((row) => row.playerId === "jayson_tatum" && row.season === "2025-26");
    if (tatumLatest.totalMinutes !== 522) throw new Error("Tatum's 2025-26 minutes check failed.");
    const georgePhiGames = d3.sum(rows.filter((row) => row.playerId === "paul_george" && row.team === "PHI"), (row) => row.games);
    if (georgePhiGames !== 78) throw new Error("George's two-season Philadelphia games check failed.");
  }

  function metricDomain(rows, metric) {
    if (metric.fixedDomain) return metric.fixedDomain;
    const values = rows.map((row) => row[metric.key]);
    const maximum = d3.max(values);
    if (metric.zeroBased) return [0, Math.ceil(maximum / metric.step) * metric.step];
    const [minimum] = d3.extent(values);
    return [minimum - metric.padding, maximum + metric.padding];
  }

  function symbolType(name) {
    if (name === "diamond") return d3.symbolDiamond;
    if (name === "square") return d3.symbolSquare;
    return d3.symbolCircle;
  }

  class CelticsWingComparison {
    constructor(root) {
      this.root = root;
      this.instanceId = `celtics-wings-${++instanceCount}`;
      this.rows = [];
      this.rowsByPlayer = new Map();
      this.selectedSeason = "2025-26";
      this.activeView = root.dataset.activeView || "availability";
      this.lastWidth = 0;
      this.renderQueued = false;
      this.loadPromise = null;
      this.panelStates = [];
      this.plot = root.querySelector(".celtics-wings__plot");
      this.status = root.querySelector(".celtics-wings__status");
      this.inspectionTitle = root.querySelector(".celtics-wings__inspection-heading h4");
      this.inspectionValues = root.querySelector(".celtics-wings__inspection-values");
      this.tableWrap = root.querySelector(".celtics-wings__table-wrap");
      this.buttons = [...root.querySelectorAll("[data-celtics-view]")];
      this.buttons.forEach((button) => button.addEventListener("click", () => this.setView(button.dataset.celticsView)));
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
          this.rowsByPlayer = d3.group(rows, (row) => row.playerId);
          this.renderTable();
          this.root.setAttribute("aria-busy", "false");
          this.render(true);
          this.updateInspection();
        })
        .catch((error) => {
          console.error("Celtics wing comparison data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "celtics-wings__status celtics-wings__status--error";
          this.status.textContent = "The Celtics wing comparison could not be displayed. The validated normalized CSV remains available.";
        });
      return this.loadPromise;
    }

    setView(view) {
      if (!VIEWS[view] || view === this.activeView) return;
      this.activeView = view;
      this.root.dataset.activeView = view;
      this.buttons.forEach((button) => {
        const active = button.dataset.celticsView === view;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      if (this.rows.length) {
        this.render(true);
        this.updateInspection();
      }
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
      panels.className = `celtics-wings__panels celtics-wings__panels--${this.activeView}`;
      this.plot.append(panels);
      VIEWS[this.activeView].forEach((metric, index) => this.renderPanel(panels, metric, index));
      this.updateSelection();
    }

    renderPanel(container, metric, metricIndex) {
      const panel = document.createElement("section");
      panel.className = "celtics-wings__panel";
      panel.innerHTML = `<h4 id="${this.instanceId}-${metric.key}-heading">${escapeHtml(metric.title)}</h4><p class="celtics-wings__panel-unit">Y-axis · ${escapeHtml(metric.unit)}</p>`;
      container.append(panel);

      const width = Math.max(250, Math.floor(panel.getBoundingClientRect().width) - 10);
      const height = width < 330 ? 250 : 238;
      const margin = { top: 14, right: 10, bottom: 39, left: width < 300 ? 51 : 55 };
      const left = margin.left;
      const right = width - margin.right;
      const top = margin.top;
      const bottom = height - margin.bottom;
      const x = d3.scalePoint().domain(SEASONS).range([left, right]).padding(0.2);
      const y = d3.scaleLinear().domain(metricDomain(this.rows, metric)).range([bottom, top]);
      if (!metric.fixedDomain) y.nice(metric.ticks);
      const svg = d3.select(panel).append("svg")
        .attr("class", "celtics-wings__svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "group")
        .attr("aria-labelledby", `${this.instanceId}-${metric.key}-title ${this.instanceId}-${metric.key}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-${metric.key}-title`).text(metric.title);
      svg.append("desc").attr("id", `${this.instanceId}-${metric.key}-desc`).text(`Five regular seasons, 2021-22 through 2025-26, comparing Jaylen Brown, Jayson Tatum and Paul George. The vertical axis is ${metric.unit}. Focus a season band to update the shared inspection strip.`);

      const tickFormat = metric.percent
        ? (value) => `${Math.round(value * 100)}%`
        : metric.percentPoints
          ? (value) => `${Math.round(value)}%`
          : metric.key === "games" || metric.key === "age"
            ? d3.format("d")
            : d3.format(".1f");
      svg.append("g")
        .attr("class", "celtics-wings__grid")
        .attr("transform", `translate(${left},0)`)
        .call(d3.axisLeft(y).ticks(metric.ticks).tickSize(-(right - left)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("g")
        .attr("class", "celtics-wings__axis")
        .attr("transform", `translate(${left},0)`)
        .call(d3.axisLeft(y).ticks(metric.ticks).tickSize(4).tickPadding(6).tickFormat(tickFormat));
      svg.append("g")
        .attr("class", "celtics-wings__axis")
        .attr("transform", `translate(0,${bottom})`)
        .call(d3.axisBottom(x).tickSize(4).tickPadding(7).tickFormat(shortSeason));
      svg.append("text")
        .attr("class", "celtics-wings__axis-label")
        .attr("transform", `translate(12 ${(top + bottom) / 2}) rotate(-90)`)
        .attr("text-anchor", "middle")
        .text(metric.unit);

      const guide = svg.append("line")
        .attr("class", "celtics-wings__season-guide")
        .attr("y1", top)
        .attr("y2", bottom);
      const allPoints = [];
      PLAYER_ORDER.forEach((playerId) => {
        const config = PLAYER_CONFIG[playerId];
        const playerRows = this.rowsByPlayer.get(playerId);
        const line = d3.line()
          .defined((row) => Number.isFinite(row[metric.key]))
          .x((row) => x(row.season))
          .y((row) => y(row[metric.key]));
        svg.append("path")
          .datum(playerRows)
          .attr("class", `celtics-wings__line celtics-wings__line--${config.className}`)
          .attr("d", line);
        const points = svg.append("g")
          .selectAll(`.celtics-wings__point-${metricIndex}-${config.className}`)
          .data(playerRows, (row) => row.season)
          .join("path")
          .attr("class", `celtics-wings__point celtics-wings__point--${config.className}`)
          .attr("data-season", (row) => row.season)
          .attr("d", d3.symbol().type(symbolType(config.symbol)).size(45))
          .attr("transform", (row) => `translate(${x(row.season)},${y(row[metric.key])})`);
        allPoints.push(points);

        if (playerId === "jayson_tatum") {
          const shortSample = playerRows.find((row) => row.season === "2025-26");
          svg.append("circle")
            .attr("class", "celtics-wings__short-sample")
            .attr("cx", x(shortSample.season))
            .attr("cy", y(shortSample[metric.key]))
            .attr("r", 8.5)
            .append("title")
            .text("Jayson Tatum: 16 games · 522 minutes in 2025-26");
        }
      });

      const spacing = SEASONS.length > 1 ? x(SEASONS[1]) - x(SEASONS[0]) : right - left;
      const hitWidth = Math.max(44, Math.min(spacing, 72));
      const hits = svg.append("g")
        .selectAll(`.celtics-wings__season-hit-${metricIndex}`)
        .data(SEASONS)
        .join("rect")
        .attr("class", "celtics-wings__season-hit")
        .attr("data-season", (season) => season)
        .attr("x", (season) => x(season) - hitWidth / 2)
        .attr("y", top)
        .attr("width", hitWidth)
        .attr("height", bottom - top)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (season) => `Select ${season} across all visible comparison panels`)
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
        allPoints.forEach((points) => points.classed("is-selected", (row) => row.season === this.selectedSeason));
      });
    }

    updateInspection() {
      if (!this.rows.length) return;
      this.inspectionTitle.textContent = this.selectedSeason.replace("-", "–");
      const selectedRows = PLAYER_ORDER.map((playerId) => this.rowsByPlayer.get(playerId).find((row) => row.season === this.selectedSeason));
      this.inspectionValues.innerHTML = selectedRows.map((row) => {
        const values = this.activeView === "availability"
          ? `${row.games} G · ${row.minutesPerGame.toFixed(1)} MPG · age ${row.age}`
          : `${row.pointsPer100.toFixed(1)} PTS/100 · ${row.assistsPer100.toFixed(1)} AST/100 · ${formatFraction(row.trueShooting)} TS · ${formatPercentPoints(row.usage)} USG`;
        const sampleNote = row.playerId === "jayson_tatum" && row.season === "2025-26" ? '<span><b>Short sample:</b> 16 games · 522 minutes</span>' : "";
        return `<article class="celtics-wings__inspection-card">
          <strong>${escapeHtml(row.playerName)}</strong>
          <span>${escapeHtml(row.team)} · ${row.games} games · ${row.totalMinutes.toLocaleString("en-US")} minutes</span>
          <span><b>${escapeHtml(values)}</b></span>${sampleNote}
        </article>`;
      }).join("");
    }

    renderTable() {
      const columns = [
        ["Season", "Season", (row) => row.season],
        ["Team", "Team", (row) => row.team],
        ["Age", "Age", (row) => row.age],
        ["G", "Games", (row) => row.games],
        ["GS", "Starts", (row) => row.starts],
        ["MPG", "Minutes/game", (row) => row.minutesPerGame.toFixed(1)],
        ["MP", "Total minutes", (row) => row.totalMinutes.toLocaleString("en-US")],
        ["PPG", "Points/game", (row) => row.pointsPerGame.toFixed(1)],
        ["RPG", "Rebounds/game", (row) => row.reboundsPerGame.toFixed(1)],
        ["APG", "Assists/game", (row) => row.assistsPerGame.toFixed(1)],
        ["PTS/100", "Points/100", (row) => row.pointsPer100.toFixed(1)],
        ["REB/100", "Rebounds/100", (row) => row.reboundsPer100.toFixed(1)],
        ["AST/100", "Assists/100", (row) => row.assistsPer100.toFixed(1)],
        ["TOV/100", "Turnovers/100", (row) => row.turnoversPer100.toFixed(1)],
        ['<abbr title="True shooting percentage">TS%</abbr>', "TS%", (row) => formatFraction(row.trueShooting)],
        ['<abbr title="Effective field-goal percentage">eFG%</abbr>', "eFG%", (row) => formatFraction(row.effectiveFieldGoalPct)],
        ['<abbr title="Usage percentage">USG%</abbr>', "USG%", (row) => formatPercentPoints(row.usage)],
        ['<abbr title="Assist percentage">AST%</abbr>', "AST%", (row) => formatPercentPoints(row.assistPct)],
        ['<abbr title="Turnover percentage">TOV%</abbr>', "TOV%", (row) => formatPercentPoints(row.turnoverPct)],
      ];
      const bodies = PLAYER_ORDER.map((playerId) => {
        const config = PLAYER_CONFIG[playerId];
        const rows = this.rowsByPlayer.get(playerId);
        return `<tbody aria-label="${escapeHtml(config.name)}">
          <tr class="celtics-wings__table-group"><th colspan="${columns.length}">${escapeHtml(config.name)}</th></tr>
          ${rows.map((row) => `<tr class="celtics-wings__table-data-row">${columns.map(([label, mobileLabel, format], index) => {
            const tag = index === 0 ? "th" : "td";
            const scope = index === 0 ? ' scope="row"' : "";
            return `<${tag}${scope} data-label="${escapeHtml(mobileLabel)}">${escapeHtml(format(row))}</${tag}>`;
          }).join("")}</tr>`).join("")}
        </tbody>`;
      }).join("");
      this.tableWrap.innerHTML = `<table class="celtics-wings__table">
        <caption class="celtics-wings__visually-hidden">Brown, Tatum and George regular-season availability and production, 2021-22 through 2025-26</caption>
        <thead><tr>${columns.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
        ${bodies}
      </table>`;
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-celtics-wing-chart]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".celtics-wings__status");
        status.className = "celtics-wings__status celtics-wings__status--error";
        status.textContent = "The chart library could not be loaded. The validated normalized CSV remains available.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.celticsWingInitialized === "true") return;
      root.dataset.celticsWingInitialized = "true";
      const chart = new CelticsWingComparison(root);
      root.celticsWingChart = chart;
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
