(function initializeGarlandClippersCharts() {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
  const EXPECTED = new Map([
    ["2021-22", [68, 14, 35.7, 30.3, 12.0, 0.576, "CLE", false]],
    ["2022-23", [69, 13, 35.5, 30.5, 11.0, 0.587, "CLE", false]],
    ["2023-24", [57, 25, 33.4, 26.7, 9.7, 0.560, "CLE", false]],
    ["2024-25", [75, 7, 30.7, 32.3, 10.6, 0.600, "CLE", false]],
    ["2025-26", [45, 37, 29.9, 30.6, 10.9, 0.582, "2TM", true]],
  ]);
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
      playerId: row.player_id?.trim() || "",
      playerName: row.player_name?.trim() || "",
      season: row.season?.trim() || "",
      seasonType: row.season_type?.trim() || "",
      team: row.source_team?.trim() || "",
      combinedTotal: row.is_combined_total === "true",
      age: number(row, "season_age"),
      games: number(row, "games"),
      schedule: number(row, "scheduled_games_reference"),
      notPlayed: number(row, "games_not_played"),
      starts: number(row, "starts"),
      mpg: number(row, "minutes_per_game"),
      minutes: number(row, "total_minutes"),
      pointsPerGame: number(row, "points_per_game"),
      assistsPerGame: number(row, "assists_per_game"),
      pointsPer100: number(row, "points_per_100"),
      assistsPer100: number(row, "assists_per_100"),
      trueShooting: number(row, "ts_pct"),
      perGameSource: row.per_game_source_row_id?.trim() || "",
      p100Source: row.p100_source_row_id?.trim() || "",
      advancedSource: row.advanced_source_row_id?.trim() || "",
    };
  }

  function validateRows(rows) {
    if (rows.length !== 5) throw new Error(`Expected five player-season rows, found ${rows.length}.`);
    const identities = new Set();
    rows.forEach((row, index) => {
      const identity = `${row.playerId}|${row.season}|${row.seasonType}`;
      if (identities.has(identity)) throw new Error(`Duplicate normalized identity ${identity}.`);
      identities.add(identity);
      if (row.playerId !== "garlada01" || row.playerName !== "Darius Garland") {
        throw new Error(`${identity} has an unexpected player identity.`);
      }
      if (row.season !== SEASONS[index] || row.seasonType !== "regular_season") {
        throw new Error("Regular-season coverage is incomplete or out of order.");
      }
      if (row.schedule !== 82 || row.games + row.notPlayed !== 82) {
        throw new Error(`${row.season} does not reconcile to the 82-game reference.`);
      }
      if (Math.abs(row.minutes / row.games - row.mpg) > 0.051) {
        throw new Error(`${row.season} has inconsistent minute units.`);
      }
      if (row.trueShooting < 0 || row.trueShooting > 1) throw new Error("TS% must be a fraction.");
      if (!row.perGameSource || !row.p100Source || !row.advancedSource) {
        throw new Error(`${row.season} is missing source provenance.`);
      }
      const actual = [row.games, row.notPlayed, row.mpg, row.pointsPer100, row.assistsPer100, row.trueShooting, row.team, row.combinedTotal];
      const expected = EXPECTED.get(row.season);
      actual.forEach((value, valueIndex) => {
        if (value !== expected[valueIndex]) throw new Error(`${row.season} conflicts with verified source values.`);
      });
    });
  }

  function displaySeason(season) {
    return season.replace("-", "\u2013");
  }

  function shortSeason(season) {
    return season.slice(2).replace("-", "\u2013");
  }

  function formatTs(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function teamLabel(row) {
    return row.combinedTotal ? "2 teams (combined total)" : row.team;
  }

  class GarlandChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `garland-clippers-${++instanceCount}`;
      this.plot = root.querySelector(".garland-chart__plot");
      this.status = root.querySelector(".garland-chart__status");
      this.select = root.querySelector(".garland-chart__season-select");
      this.inspectionTitle = root.querySelector(".garland-chart__inspection-title");
      this.inspectionValues = root.querySelector(".garland-chart__inspection-values");
      this.announcement = root.querySelector(".garland-chart__announcement");
      this.tableWrap = root.querySelector(".garland-chart__table-wrap");
      this.rows = [];
      this.bySeason = new Map();
      this.panelStates = [];
      this.selectedSeason = "2025-26";
      this.lastWidth = 0;
      this.renderQueued = false;
      this.select.addEventListener("change", () => this.selectSeason(this.select.value, true));
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
          this.bySeason = new Map(rows.map((row) => [row.season, row]));
          this.root.setAttribute("aria-busy", "false");
          this.renderTable();
          this.updateInspection(false);
          this.render(true);
        })
        .catch((error) => {
          console.error("Darius Garland chart data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "garland-chart__status garland-chart__status--error";
          this.status.textContent = "Garland's chart could not be displayed. The validated CSV remains available below.";
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
      if (!width || (!force && width === this.lastWidth)) return;
      this.lastWidth = width;
      this.plot.replaceChildren();
      this.panelStates = [];
      this.renderAvailability();
      this.renderProduction();
      this.renderEfficiency();
      this.updateSelection();
    }

    basePanel(className, title, note) {
      const panel = document.createElement("section");
      panel.className = `garland-chart__panel ${className}`;
      panel.innerHTML = `<header><h4>${escapeHtml(title)}</h4><p>${escapeHtml(note)}</p></header>`;
      this.plot.appendChild(panel);
      return panel;
    }

    dimensions(panel, height, bottomMargin = 48) {
      const width = Math.max(280, Math.floor(panel.getBoundingClientRect().width));
      const compact = width < 430;
      return {
        width,
        height,
        compact,
        left: compact ? 42 : 54,
        right: width - (compact ? 13 : 22),
        top: 28,
        bottom: height - bottomMargin,
      };
    }

    svg(panel, dimensions, key, title, description) {
      const svg = d3.select(panel).append("svg")
        .attr("class", "garland-chart__svg")
        .attr("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`)
        .attr("role", "img")
        .attr("aria-labelledby", `${this.instanceId}-${key}-title ${this.instanceId}-${key}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-${key}-title`).text(title);
      svg.append("desc").attr("id", `${this.instanceId}-${key}-desc`).text(description);
      return svg;
    }

    seasonScale(dimensions) {
      return d3.scalePoint().domain(SEASONS).range([dimensions.left, dimensions.right]).padding(0.45);
    }

    drawSeasonAxis(svg, x, y, detail = false) {
      const axis = svg.append("g").attr("class", "garland-chart__axis garland-chart__axis--season")
        .attr("transform", `translate(0,${y})`)
        .call(d3.axisBottom(x).tickSize(4).tickSizeOuter(0).tickPadding(7).tickFormat(shortSeason));
      if (detail) {
        axis.selectAll(".tick").each((season, index, nodes) => {
          const row = this.bySeason.get(season);
          const tick = d3.select(nodes[index]);
          tick.append("text").attr("class", "garland-chart__tick-detail").attr("y", 29)
            .text(`${row.notPlayed} not played`);
          tick.append("text").attr("class", "garland-chart__tick-detail").attr("y", 43)
            .text(`${row.mpg.toFixed(1)} MPG`);
        });
      }
    }

    drawGrid(svg, y, dimensions, ticks, formatter) {
      svg.append("g").attr("class", "garland-chart__grid")
        .attr("transform", `translate(${dimensions.left},0)`)
        .call(d3.axisLeft(y).tickValues(ticks).tickSize(-(dimensions.right - dimensions.left)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("g").attr("class", "garland-chart__axis garland-chart__axis--y")
        .attr("transform", `translate(${dimensions.left},0)`)
        .call(d3.axisLeft(y).tickValues(ticks).tickSize(4).tickSizeOuter(0).tickPadding(6).tickFormat(formatter));
    }

    addInteractions(svg, x, top, bottom, panelKey) {
      const guide = svg.append("line").attr("class", "garland-chart__guide").attr("y1", top).attr("y2", bottom);
      const step = x.step();
      const hits = svg.append("g").selectAll("rect")
        .data(this.rows).join("rect")
        .attr("class", "garland-chart__hit")
        .attr("data-season", (row) => row.season)
        .attr("x", (row) => x(row.season) - step / 2)
        .attr("y", top)
        .attr("width", step)
        .attr("height", bottom - top)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (row) => `${displaySeason(row.season)}. ${row.games} games, ${row.notPlayed} not played, ${row.mpg.toFixed(1)} minutes per game, ${row.pointsPer100.toFixed(1)} points and ${row.assistsPer100.toFixed(1)} assists per 100 possessions, ${formatTs(row.trueShooting)} true shooting, ${teamLabel(row)}.`)
        .on("pointerenter pointerdown click focus", (event, row) => this.selectSeason(row.season, event.type !== "pointerenter"))
        .on("keydown", (event, row) => this.handleKey(event, row.season, panelKey));
      this.panelStates.push({ x, guide, hits, panelKey });
    }

    renderAvailability() {
      const panel = this.basePanel(
        "garland-chart__panel--availability",
        "1. Games played",
        "Bars begin at zero; the 82-game line is a schedule reference.",
      );
      const dimensions = this.dimensions(panel, 248, 72);
      const x = this.seasonScale(dimensions);
      const y = d3.scaleLinear().domain([0, 82]).range([dimensions.bottom, dimensions.top]);
      const svg = this.svg(panel, dimensions, "games", "Games played", "Garland's games played in each regular season from 2021-22 through 2025-26. Labels also give games not played and minutes per game; no reason for an absence is assigned.");
      this.drawGrid(svg, y, dimensions, [0, 20, 40, 60, 82], d3.format("d"));
      svg.append("line").attr("class", "garland-chart__reference")
        .attr("x1", dimensions.left).attr("x2", dimensions.right).attr("y1", y(82)).attr("y2", y(82));
      svg.append("text").attr("class", "garland-chart__reference-label")
        .attr("x", dimensions.right).attr("y", y(82) - 6).attr("text-anchor", "end").text("82-game schedule");
      const barWidth = Math.min(54, x.step() * 0.55);
      svg.append("g").selectAll("rect")
        .data(this.rows).join("rect")
        .attr("class", "garland-chart__bar")
        .attr("data-season", (row) => row.season)
        .attr("x", (row) => x(row.season) - barWidth / 2)
        .attr("y", (row) => y(row.games))
        .attr("width", barWidth)
        .attr("height", (row) => y(0) - y(row.games));
      svg.append("g").selectAll("text")
        .data(this.rows).join("text")
        .attr("class", "garland-chart__value garland-chart__value--games")
        .attr("data-season", (row) => row.season)
        .attr("x", (row) => x(row.season)).attr("y", (row) => y(row.games) - 7)
        .attr("text-anchor", "middle").text((row) => `${row.games} G`);
      this.drawSeasonAxis(svg, x, dimensions.bottom, true);
      this.addInteractions(svg, x, dimensions.top, dimensions.bottom, "games");
    }

    renderProduction() {
      const panel = this.basePanel(
        "garland-chart__panel--production",
        "2. Scoring and playmaking",
        "Separate scales; both measures are rates per 100 possessions.",
      );
      const dimensions = this.dimensions(panel, 330, 48);
      const x = this.seasonScale(dimensions);
      const svg = this.svg(panel, dimensions, "production", "Points and assists per 100 possessions", "Two vertically aligned small multiples show Garland's points and assists per 100 possessions in each regular season from 2021-22 through 2025-26. Every value is directly labeled.");
      const bands = [
        { key: "pointsPer100", label: "Points / 100 possessions", domain: [25, 33], ticks: [26, 28, 30, 32], top: 29, bottom: 132, className: "points", symbol: d3.symbolCircle },
        { key: "assistsPer100", label: "Assists / 100 possessions", domain: [9, 12.5], ticks: [9, 10, 11, 12], top: 172, bottom: 275, className: "assists", symbol: d3.symbolSquare },
      ];
      bands.forEach((band) => {
        const y = d3.scaleLinear().domain(band.domain).range([band.bottom, band.top]);
        svg.append("text").attr("class", "garland-chart__band-label")
          .attr("x", dimensions.left).attr("y", band.top - 9).text(band.label);
        svg.append("g").attr("class", "garland-chart__grid")
          .attr("transform", `translate(${dimensions.left},0)`)
          .call(d3.axisLeft(y).tickValues(band.ticks).tickSize(-(dimensions.right - dimensions.left)).tickFormat(""))
          .call((group) => group.select(".domain").remove());
        svg.append("g").attr("class", "garland-chart__axis garland-chart__axis--y")
          .attr("transform", `translate(${dimensions.left},0)`)
          .call(d3.axisLeft(y).tickValues(band.ticks).tickSize(4).tickSizeOuter(0).tickPadding(6));
        const line = d3.line().x((row) => x(row.season)).y((row) => y(row[band.key]));
        svg.append("path").datum(this.rows).attr("class", `garland-chart__line garland-chart__line--${band.className}`).attr("d", line);
        svg.append("g").selectAll("path")
          .data(this.rows).join("path")
          .attr("class", `garland-chart__point garland-chart__point--${band.className}`)
          .attr("data-season", (row) => row.season)
          .attr("transform", (row) => `translate(${x(row.season)},${y(row[band.key])})`)
          .attr("d", d3.symbol().type(band.symbol).size(76));
        svg.append("g").selectAll("text")
          .data(this.rows).join("text")
          .attr("class", `garland-chart__value garland-chart__value--${band.className}`)
          .attr("data-season", (row) => row.season)
          .attr("x", (row) => x(row.season)).attr("y", (row) => y(row[band.key]) - 10)
          .attr("text-anchor", "middle").text((row) => row[band.key].toFixed(1));
      });
      this.drawSeasonAxis(svg, x, dimensions.bottom);
      this.addInteractions(svg, x, bands[0].top, bands[1].bottom, "production");
    }

    renderEfficiency() {
      const panel = this.basePanel(
        "garland-chart__panel--efficiency",
        "3. Scoring efficiency",
        "True shooting percentage; no compatible local league-average series is available.",
      );
      const dimensions = this.dimensions(panel, 218, 48);
      const x = this.seasonScale(dimensions);
      const y = d3.scaleLinear().domain([0.54, 0.61]).range([dimensions.bottom, dimensions.top]);
      const svg = this.svg(panel, dimensions, "efficiency", "True shooting percentage", "Garland's true shooting percentage in each regular season from 2021-22 through 2025-26. Every percentage is directly labeled.");
      this.drawGrid(svg, y, dimensions, [0.54, 0.56, 0.58, 0.60], (value) => `${Math.round(value * 100)}%`);
      const line = d3.line().x((row) => x(row.season)).y((row) => y(row.trueShooting));
      svg.append("path").datum(this.rows).attr("class", "garland-chart__line garland-chart__line--efficiency").attr("d", line);
      svg.append("g").selectAll("circle")
        .data(this.rows).join("circle")
        .attr("class", "garland-chart__point garland-chart__point--efficiency")
        .attr("data-season", (row) => row.season)
        .attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row.trueShooting)).attr("r", 4.7);
      svg.append("g").selectAll("text")
        .data(this.rows).join("text")
        .attr("class", "garland-chart__value garland-chart__value--efficiency")
        .attr("data-season", (row) => row.season)
        .attr("x", (row) => x(row.season)).attr("y", (row) => y(row.trueShooting) - 10)
        .attr("text-anchor", "middle").text((row) => formatTs(row.trueShooting));
      this.drawSeasonAxis(svg, x, dimensions.bottom);
      this.addInteractions(svg, x, dimensions.top, dimensions.bottom, "efficiency");
    }

    handleKey(event, season, panelKey) {
      let index = SEASONS.indexOf(season);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") index = Math.max(0, index - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") index = Math.min(SEASONS.length - 1, index + 1);
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = SEASONS.length - 1;
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectSeason(season, true);
        return;
      } else return;
      event.preventDefault();
      const next = SEASONS[index];
      this.selectSeason(next, true);
      this.panelStates.find((state) => state.panelKey === panelKey)?.hits
        .filter((row) => row.season === next).node()?.focus();
    }

    selectSeason(season, announce) {
      if (!this.bySeason.has(season)) return;
      this.selectedSeason = season;
      this.select.value = season;
      this.updateSelection();
      this.updateInspection(announce);
    }

    updateSelection() {
      this.panelStates.forEach(({ x, guide, hits }) => {
        guide.attr("x1", x(this.selectedSeason)).attr("x2", x(this.selectedSeason));
        hits.classed("is-selected", (row) => row.season === this.selectedSeason)
          .attr("aria-pressed", (row) => String(row.season === this.selectedSeason));
      });
      this.plot.querySelectorAll("[data-season]").forEach((node) => {
        if (!node.classList.contains("garland-chart__hit")) {
          node.classList.toggle("is-selected", node.dataset.season === this.selectedSeason);
        }
      });
    }

    updateInspection(announce) {
      const row = this.bySeason.get(this.selectedSeason);
      if (!row) return;
      this.inspectionTitle.textContent = displaySeason(row.season);
      const values = [
        ["Team record", teamLabel(row)],
        ["Availability", `${row.games} games \u00b7 ${row.notPlayed} not played`],
        ["Playing time", `${row.mpg.toFixed(1)} MPG \u00b7 ${row.minutes.toLocaleString("en-US")} minutes`],
        ["Scoring", `${row.pointsPer100.toFixed(1)} points / 100`],
        ["Playmaking", `${row.assistsPer100.toFixed(1)} assists / 100`],
        ["Efficiency", `${formatTs(row.trueShooting)} TS`],
      ];
      this.inspectionValues.innerHTML = values.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
      if (announce) {
        this.announcement.textContent = `${displaySeason(row.season)}: ${row.games} games, ${row.notPlayed} not played, ${row.mpg.toFixed(1)} minutes per game, ${row.pointsPer100.toFixed(1)} points and ${row.assistsPer100.toFixed(1)} assists per 100 possessions, ${formatTs(row.trueShooting)} true shooting.`;
      }
    }

    renderTable() {
      const columns = [
        ["Season", "Season", (row) => displaySeason(row.season)],
        ["Team(s)", "Team(s)", teamLabel],
        ["G", "Games", (row) => row.games],
        ["Not played", "Not played", (row) => row.notPlayed],
        ["MPG", "Minutes/game", (row) => row.mpg.toFixed(1)],
        ["PTS/100", "Points/100", (row) => row.pointsPer100.toFixed(1)],
        ["AST/100", "Assists/100", (row) => row.assistsPer100.toFixed(1)],
        ["TS%", "True shooting", (row) => formatTs(row.trueShooting)],
      ];
      this.tableWrap.innerHTML = `<table class="garland-chart__table team-graphic__table">
        <caption class="garland-chart__visually-hidden">Darius Garland regular-season availability, playing time, scoring, playmaking and efficiency from 2021-22 through 2025-26</caption>
        <thead><tr>${columns.map(([label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr></thead>
        <tbody>${this.rows.map((row) => `<tr class="garland-chart__table-row">${columns.map(([label, mobileLabel, format], index) => {
          const tag = index === 0 ? "th" : "td";
          const scope = index === 0 ? ' scope="row"' : "";
          return `<${tag}${scope} data-label="${escapeHtml(mobileLabel)}">${escapeHtml(format(row))}</${tag}>`;
        }).join("")}</tr>`).join("")}</tbody>
      </table>`;
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-garland-clippers-chart]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".garland-chart__status");
        status.className = "garland-chart__status garland-chart__status--error";
        status.textContent = "The chart library could not be loaded. The validated CSV remains available below.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.garlandInitialized === "true") return;
      root.dataset.garlandInitialized = "true";
      const chart = new GarlandChart(root);
      root.garlandClippersChart = chart;
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
