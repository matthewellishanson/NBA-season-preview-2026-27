(function initializeKesslerLakersChart() {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"];
  const DEFAULT_SEASON = "2024-25";
  const LATEST_SEASON = "2025-26";
  const METRICS = [
    {
      key: "games",
      title: "Games played",
      unit: "Games",
      domain: [0, 82],
      ticks: [0, 20, 40, 60, 82],
      kind: "bar",
      format: (value) => String(value),
      axisFormat: (value) => String(value),
    },
    {
      key: "offensiveReboundPct",
      title: "Offensive rebound percentage",
      unit: "ORB%",
      domain: [0, 20],
      ticks: [0, 5, 10, 15, 20],
      kind: "line",
      format: formatPercent,
      axisFormat: (value) => `${value}%`,
    },
    {
      key: "blockPct",
      title: "Block percentage",
      unit: "BLK%",
      domain: [0, 10],
      ticks: [0, 2, 4, 6, 8, 10],
      kind: "line",
      format: formatPercent,
      axisFormat: (value) => `${value}%`,
    },
  ];
  let instanceCount = 0;

  function nullableNumber(value) {
    return value === undefined || value === null || value.trim() === "" ? null : Number(value);
  }

  function parseRow(row) {
    return {
      playerId: row.player_id,
      playerName: row.player_name,
      season: row.season,
      seasonStart: Number(row.season_start),
      team: row.source_team,
      age: nullableNumber(row.season_age),
      games: nullableNumber(row.games),
      starts: nullableNumber(row.starts),
      minutesPerGame: nullableNumber(row.minutes_per_game),
      totalMinutes: nullableNumber(row.total_minutes),
      pointsPerGame: nullableNumber(row.points_per_game),
      reboundsPerGame: nullableNumber(row.rebounds_per_game),
      blocksPerGame: nullableNumber(row.blocks_per_game),
      pointsPer100: nullableNumber(row.points_per_100),
      reboundsPer100: nullableNumber(row.rebounds_per_100),
      blocksPer100: nullableNumber(row.blocks_per_100),
      offensiveReboundPct: nullableNumber(row.offensive_rebound_pct),
      defensiveReboundPct: nullableNumber(row.defensive_rebound_pct),
      totalReboundPct: nullableNumber(row.total_rebound_pct),
      blockPct: nullableNumber(row.block_pct),
      trueShooting: nullableNumber(row.ts_pct),
      usagePct: nullableNumber(row.usage_pct),
      turnoverPct: nullableNumber(row.turnover_pct),
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function fullSeason(season) {
    return season.replace("-", "–");
  }

  function shortSeason(season) {
    return season.replace(/^20/, "").replace("-", "–");
  }

  function formatPercent(value) {
    return value == null ? "Missing" : `${value.toFixed(1)}%`;
  }

  function formatFraction(value) {
    return value == null ? "Missing" : `${(value * 100).toFixed(1)}%`;
  }

  function formatOne(value) {
    return value == null ? "Missing" : value.toFixed(1);
  }

  function formatInteger(value) {
    return value == null ? "Missing" : value.toLocaleString("en-US");
  }

  class KesslerChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `kessler-lakers-${++instanceCount}`;
      this.plot = root.querySelector(".kessler-chart__plot");
      this.status = root.querySelector(".kessler-chart__status");
      this.select = root.querySelector(".kessler-chart__season-select");
      this.inspectionTitle = root.querySelector(".kessler-chart__inspection-title");
      this.inspectionValues = root.querySelector(".kessler-chart__inspection-values");
      this.announcement = root.querySelector(".kessler-chart__announcement");
      this.tableBody = root.querySelector(".kessler-chart__table-body");
      this.selectedSeason = DEFAULT_SEASON;
      this.rows = [];
      this.bySeason = new Map();
      this.panelStates = [];
      this.loaded = false;
      this.renderQueued = false;
      this.select.addEventListener("change", () => this.selectSeason(this.select.value, true));
      this.resizeObserver = new ResizeObserver(() => this.queueRender());
      this.resizeObserver.observe(root);
    }

    load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = d3.csv(this.root.dataset.source, parseRow)
        .then((rows) => {
          this.validateRows(rows);
          this.rows = SEASONS.map((season) => rows.find((row) => row.season === season));
          this.bySeason = new Map(this.rows.map((row) => [row.season, row]));
          this.loaded = true;
          this.root.setAttribute("aria-busy", "false");
          this.renderTable();
          this.render();
        })
        .catch((error) => {
          console.error("Kessler Lakers chart failed:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "kessler-chart__status kessler-chart__status--error";
          this.status.innerHTML = `Kessler&rsquo;s chart could not be loaded. <a href="${escapeHtml(this.root.dataset.source)}">Open the normalized CSV.</a>`;
        });
      return this.loadPromise;
    }

    validateRows(rows) {
      if (rows.length !== 4) throw new Error(`Expected four normalized rows; found ${rows.length}.`);
      const keys = rows.map((row) => `${row.playerId}|${row.season}|${row.team}`);
      if (new Set(keys).size !== rows.length) throw new Error("Duplicate normalized player-season-team keys.");
      SEASONS.forEach((season) => {
        const row = rows.find((candidate) => candidate.season === season && candidate.team === "UTA");
        if (!row) throw new Error(`Missing UTA row for ${season}.`);
        ["age", "games", "starts", "minutesPerGame", "totalMinutes", "reboundsPerGame", "blocksPerGame", "offensiveReboundPct", "blockPct", "trueShooting"].forEach((field) => {
          if (!Number.isFinite(row[field])) throw new Error(`${season}: missing or non-finite ${field}.`);
        });
      });
      const checks = {
        "2022-23": [74, 1703, 14.9, 8.6],
        "2023-24": [64, 1493, 12.3, 9.2],
        "2024-25": [58, 1740, 16.6, 7.4],
        "2025-26": [5, 154, 15.7, 5.6],
      };
      rows.forEach((row) => {
        const actual = [row.games, row.totalMinutes, row.offensiveReboundPct, row.blockPct];
        if (actual.some((value, index) => value !== checks[row.season][index])) {
          throw new Error(`${row.season}: source check values disagree.`);
        }
      });
    }

    queueRender() {
      if (!this.loaded || this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        if (this.root.getBoundingClientRect().width > 0) this.render();
      });
    }

    render() {
      if (!this.loaded || this.root.getBoundingClientRect().width <= 0) return;
      this.plot.innerHTML = '<div class="kessler-chart__panels"></div>';
      this.panels = this.plot.querySelector(".kessler-chart__panels");
      this.panelStates = [];
      METRICS.forEach((metric) => this.renderPanel(metric));
      this.updateSelection(false);
      this.updateInspection(false);
    }

    renderPanel(metric) {
      const panel = document.createElement("section");
      panel.className = `kessler-chart__panel kessler-chart__panel--${metric.kind}`;
      panel.innerHTML = `<h4>${escapeHtml(metric.title)}</h4>`;
      this.panels.appendChild(panel);

      const width = Math.max(250, Math.floor(panel.getBoundingClientRect().width));
      const height = 270;
      const margin = { top: 30, right: 24, bottom: 43, left: 45 };
      const left = margin.left;
      const right = width - margin.right;
      const top = margin.top;
      const bottom = height - margin.bottom;
      const x = d3.scalePoint().domain(SEASONS).range([left, right]).padding(0.45);
      const y = d3.scaleLinear().domain(metric.domain).range([bottom, top]);
      const svg = d3.select(panel).append("svg")
        .attr("class", "kessler-chart__svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", `${this.instanceId}-${metric.key}-title ${this.instanceId}-${metric.key}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-${metric.key}-title`).text(metric.title);
      svg.append("desc").attr("id", `${this.instanceId}-${metric.key}-desc`).text(
        `Walker Kessler's ${metric.title.toLowerCase()} for four Utah regular seasons from 2022-23 through 2025-26. The final point is a five-game, 154-minute sample.`,
      );

      svg.append("g").attr("class", "kessler-chart__grid")
        .attr("transform", `translate(${left},0)`)
        .call(d3.axisLeft(y).tickValues(metric.ticks).tickSize(-(right - left)).tickFormat(""));
      svg.append("g").attr("class", "kessler-chart__axis")
        .attr("transform", `translate(${left},0)`)
        .call(d3.axisLeft(y).tickValues(metric.ticks).tickSize(4).tickSizeOuter(0).tickPadding(6).tickFormat(metric.axisFormat));
      svg.append("text").attr("class", "kessler-chart__axis-label").attr("x", left).attr("y", 13).text(metric.unit);
      svg.append("g").attr("class", "kessler-chart__axis kessler-chart__axis--x")
        .attr("transform", `translate(0,${bottom})`)
        .call(d3.axisBottom(x).tickSize(4).tickSizeOuter(0).tickPadding(8).tickFormat(shortSeason));

      if (metric.kind === "bar") this.renderBars(svg, metric, x, y, top, bottom);
      else this.renderLine(svg, metric, x, y, top);

      const guide = svg.append("line").attr("class", "kessler-chart__selection-guide")
        .attr("y1", top).attr("y2", bottom);
      const hits = svg.append("g").selectAll("rect")
        .data(SEASONS).join("rect")
        .attr("class", "kessler-chart__season-hit")
        .attr("data-season", (season) => season)
        .attr("x", (season, index) => {
          const previous = index === 0 ? left : (x(SEASONS[index - 1]) + x(season)) / 2;
          return previous;
        })
        .attr("y", top)
        .attr("width", (season, index) => {
          const previous = index === 0 ? left : (x(SEASONS[index - 1]) + x(season)) / 2;
          const next = index === SEASONS.length - 1 ? right : (x(season) + x(SEASONS[index + 1])) / 2;
          return next - previous;
        })
        .attr("height", bottom - top)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (season) => `Select ${season} across all Kessler panels`)
        .on("pointerenter", (event, season) => this.selectSeason(season, false))
        .on("pointerdown click", (event, season) => this.selectSeason(season, true))
        .on("focus", (event, season) => this.selectSeason(season, false))
        .on("keydown", (event, season) => this.handleSeasonKey(event, season));
      this.panelStates.push({ metric, x, y, top, bottom, guide, hits });
    }

    renderBars(svg, metric, x, y, top, bottom) {
      const barWidth = Math.min(44, x.step() * 0.5);
      svg.append("g").selectAll("rect")
        .data(this.rows).join("rect")
        .attr("class", (row) => `kessler-chart__bar${row.season === LATEST_SEASON ? " is-limited-sample" : ""}`)
        .attr("data-season", (row) => row.season)
        .attr("x", (row) => x(row.season) - barWidth / 2)
        .attr("y", (row) => y(row.games))
        .attr("width", barWidth)
        .attr("height", (row) => bottom - y(row.games));
      const latest = this.bySeason.get(LATEST_SEASON);
      svg.append("text").datum(latest)
        .attr("class", "kessler-chart__direct-value kessler-chart__direct-value--latest")
        .attr("x", (row) => x(row.season))
        .attr("y", (row) => Math.max(top + 12, y(row.games) - 8))
        .attr("text-anchor", "middle")
        .text((row) => metric.format(row.games));
    }

    renderLine(svg, metric, x, y, top) {
      const line = d3.line()
        .defined((row) => row[metric.key] != null)
        .x((row) => x(row.season))
        .y((row) => y(row[metric.key]));
      svg.append("path").datum(this.rows).attr("class", "kessler-chart__line").attr("d", line);
      svg.append("g").selectAll("circle.kessler-chart__point")
        .data(this.rows).join("circle")
        .attr("class", (row) => `kessler-chart__point${row.season === LATEST_SEASON ? " is-limited-sample" : ""}`)
        .attr("data-season", (row) => row.season)
        .attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row[metric.key])).attr("r", 4.5);
      const latest = this.bySeason.get(LATEST_SEASON);
      svg.append("circle").datum(latest)
        .attr("class", "kessler-chart__sample-ring")
        .attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row[metric.key])).attr("r", 8);
      svg.append("text").datum(latest)
        .attr("class", "kessler-chart__direct-value kessler-chart__direct-value--latest")
        .attr("x", (row) => x(row.season) - 9)
        .attr("y", (row) => Math.max(top + 11, y(row[metric.key]) - 10))
        .attr("text-anchor", "end")
        .text((row) => metric.format(row[metric.key]));
    }

    handleSeasonKey(event, season) {
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
      event.currentTarget.closest("svg")?.querySelector(`.kessler-chart__season-hit[data-season="${next}"]`)?.focus();
    }

    selectSeason(season, announce) {
      if (!SEASONS.includes(season)) return;
      this.selectedSeason = season;
      this.select.value = season;
      this.updateSelection(announce);
      this.updateInspection(announce);
    }

    updateSelection() {
      this.panelStates.forEach(({ x, guide, hits }) => {
        guide.attr("x1", x(this.selectedSeason)).attr("x2", x(this.selectedSeason));
        hits.attr("aria-pressed", (season) => String(season === this.selectedSeason));
      });
      this.plot.querySelectorAll(".kessler-chart__bar, .kessler-chart__point").forEach((mark) => {
        mark.classList.toggle("is-selected", mark.dataset.season === this.selectedSeason);
      });
      this.tableBody.querySelectorAll("tr").forEach((row) => {
        row.classList.toggle("is-selected", row.dataset.season === this.selectedSeason);
      });
    }

    updateInspection(announce) {
      const row = this.bySeason.get(this.selectedSeason);
      if (!row) return;
      this.inspectionTitle.textContent = fullSeason(row.season);
      this.inspectionValues.innerHTML = `
        <span><b>${row.games}</b> <small>Games</small></span>
        <span><b>${formatInteger(row.totalMinutes)}</b> <small>Total minutes</small></span>
        <span><b>${formatOne(row.minutesPerGame)}</b> <small>MPG</small></span>
        <span><b>${row.age}</b> <small>Season age</small></span>
        <span><b>${formatPercent(row.offensiveReboundPct)}</b> <small>ORB%</small></span>
        <span><b>${formatPercent(row.blockPct)}</b> <small>BLK%</small></span>
        <span><b>${formatOne(row.reboundsPerGame)}</b> <small>Rebounds/game</small></span>
        <span><b>${formatOne(row.blocksPerGame)}</b> <small>Blocks/game</small></span>
        <span><b>${formatFraction(row.trueShooting)}</b> <small>TS%</small></span>`;
      if (announce) {
        this.announcement.textContent = `Selected season ${row.season}: ${row.games} games, ${row.totalMinutes} minutes, ${row.minutesPerGame.toFixed(1)} minutes per game, age ${row.age}, ${row.offensiveReboundPct.toFixed(1)} percent offensive rebound rate, ${row.blockPct.toFixed(1)} percent block rate, ${row.reboundsPerGame.toFixed(1)} rebounds and ${row.blocksPerGame.toFixed(1)} blocks per game, ${(row.trueShooting * 100).toFixed(1)} percent true shooting. The separate 2025-26 five-game warning remains visible.`;
      }
    }

    renderTable() {
      this.tableBody.innerHTML = this.rows.map((row) => `
        <tr class="kessler-chart__table-row" data-season="${row.season}">
          <th scope="row" data-label="Season">${fullSeason(row.season)}</th>
          <td data-label="Source team">${escapeHtml(row.team)}</td>
          <td data-label="Games">${row.games}</td>
          <td data-label="Total minutes">${formatInteger(row.totalMinutes)}</td>
          <td data-label="MPG">${formatOne(row.minutesPerGame)}</td>
          <td data-label="Season age">${row.age}</td>
          <td data-label="ORB%">${formatPercent(row.offensiveReboundPct)}</td>
          <td data-label="BLK%">${formatPercent(row.blockPct)}</td>
          <td data-label="Rebounds/game">${formatOne(row.reboundsPerGame)}</td>
          <td data-label="Blocks/game">${formatOne(row.blocksPerGame)}</td>
          <td data-label="TS%">${formatFraction(row.trueShooting)}</td>
        </tr>`).join("");
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-kessler-lakers-chart]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".kessler-chart__status");
        status.className = "kessler-chart__status kessler-chart__status--error";
        status.textContent = "The chart library could not be loaded. The normalized CSV remains available.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.kesslerInitialized === "true") return;
      root.dataset.kesslerInitialized = "true";
      const chart = new KesslerChart(root);
      root.kesslerChart = chart;
      const card = root.closest("details");
      const loadWhenVisible = () => {
        if (!card || card.open) requestAnimationFrame(() => chart.load().then(() => chart.queueRender()));
      };
      card?.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  initialize();
})();
