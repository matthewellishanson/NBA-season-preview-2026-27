(function initializeKawhiProductionAvailability() {
  "use strict";

  const d3 = window.d3;
  const MAIN_SEASONS = ["2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
  const PLAYOFF_SEASONS = MAIN_SEASONS.slice(0, -1);
  const METRICS = [
    { key: "games", title: "Regular-season games played", unit: "Games", domain: [0, 82], ticks: [0, 20, 40, 60, 82], kind: "bar", format: (value) => String(value) },
    { key: "pointsPer100", title: "Points per 100 possessions", unit: "Points per 100", domain: [0, 50], ticks: [0, 10, 20, 30, 40, 50], kind: "line", format: (value) => value.toFixed(1) },
    { key: "trueShooting", title: "True shooting percentage", unit: "True shooting", domain: [0.45, 0.70], ticks: [0.45, 0.50, 0.55, 0.60, 0.65, 0.70], kind: "line", format: formatFraction },
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
      seasonType: row.season_type,
      team: row.source_team,
      age: nullableNumber(row.season_age),
      games: nullableNumber(row.games),
      starts: nullableNumber(row.starts),
      minutesPerGame: nullableNumber(row.minutes_per_game),
      totalMinutes: nullableNumber(row.total_minutes),
      pointsPerGame: nullableNumber(row.points_per_game),
      pointsPer100: nullableNumber(row.points_per_100),
      assistsPer100: nullableNumber(row.assists_per_100),
      trueShooting: nullableNumber(row.ts_pct),
      usage: nullableNumber(row.usage_pct),
      turnoverPct: nullableNumber(row.turnover_pct),
      appearanceStatus: row.appearance_status,
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function shortSeason(season) {
    return season.replace(/^20/, "").replace("-", "–");
  }

  function fullSeason(season) {
    return season.replace("-", "–");
  }

  function formatFraction(value) {
    return value == null ? "Undefined" : `${(value * 100).toFixed(1)}%`;
  }

  function formatPercentPoints(value) {
    return value == null ? "Undefined" : `${value.toFixed(1)}%`;
  }

  function formatInteger(value) {
    return value == null ? "Undefined" : value.toLocaleString("en-US");
  }

  function valueOrUndefined(value, formatter) {
    return value == null ? "Undefined" : formatter(value);
  }

  class KawhiChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `kawhi-production-${++instanceCount}`;
      this.plot = root.querySelector(".kawhi-production__plot");
      this.status = root.querySelector(".kawhi-production__status");
      this.select = root.querySelector(".kawhi-production__season-select");
      this.inspectionTitle = root.querySelector(".kawhi-production__inspection-title");
      this.inspectionValues = root.querySelector(".kawhi-production__inspection-values");
      this.inspectionAnnouncement = root.querySelector(".kawhi-production__inspection-announcement");
      this.playoffStrip = root.querySelector(".kawhi-production__playoff-list");
      this.tableWrap = root.querySelector(".kawhi-production__table-wrap");
      this.selectedSeason = "2025-26";
      this.rows = [];
      this.regularRows = [];
      this.postseasonRows = [];
      this.regularBySeason = new Map();
      this.postseasonBySeason = new Map();
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
          this.rows = rows;
          this.regularRows = MAIN_SEASONS.map((season) => rows.find((row) => row.seasonType === "regular_season" && row.season === season));
          this.postseasonRows = PLAYOFF_SEASONS.map((season) => rows.find((row) => row.seasonType === "postseason" && row.season === season));
          this.regularBySeason = new Map(this.regularRows.map((row) => [row.season, row]));
          this.postseasonBySeason = new Map(this.postseasonRows.map((row) => [row.season, row]));
          this.loaded = true;
          this.root.setAttribute("aria-busy", "false");
          this.renderPlayoffStrip();
          this.renderTable();
          this.render();
        })
        .catch((error) => {
          console.error("Kawhi production chart failed:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "kawhi-production__status kawhi-production__status--error";
          this.status.innerHTML = `Leonard&rsquo;s chart could not be loaded. <a href="${escapeHtml(this.root.dataset.source)}">Open the normalized CSV.</a>`;
        });
      return this.loadPromise;
    }

    validateRows(rows) {
      const key = (row) => `${row.playerId}|${row.season}|${row.seasonType}|${row.team}`;
      if (new Set(rows.map(key)).size !== rows.length) throw new Error("Duplicate normalized keys.");
      MAIN_SEASONS.forEach((season) => {
        const row = rows.find((candidate) => candidate.season === season && candidate.seasonType === "regular_season");
        if (!row) throw new Error(`Missing regular-season row for ${season}.`);
      });
      PLAYOFF_SEASONS.forEach((season) => {
        const row = rows.find((candidate) => candidate.season === season && candidate.seasonType === "postseason");
        if (!row) throw new Error(`Missing postseason alignment row for ${season}.`);
      });
      const missed = rows.find((row) => row.season === "2021-22" && row.seasonType === "regular_season");
      if (missed.appearanceStatus !== "confirmed_no_appearance" || missed.games !== 0 || missed.totalMinutes !== 0 || missed.minutesPerGame !== null || missed.pointsPer100 !== null || missed.trueShooting !== null) {
        throw new Error("The 2021-22 missed season was normalized incorrectly.");
      }
      const latest = rows.find((row) => row.season === "2025-26" && row.seasonType === "regular_season");
      if (latest.games !== 65 || latest.pointsPer100 !== 43.3 || latest.trueShooting !== 0.629) throw new Error("Latest-season check values disagree.");
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
      this.plot.innerHTML = '<div class="kawhi-production__panels"></div>';
      this.panels = this.plot.querySelector(".kawhi-production__panels");
      this.panelStates = [];
      METRICS.forEach((metric) => this.renderPanel(metric));
      this.updateSelection(false);
      this.updateInspection(false);
    }

    renderPanel(metric) {
      const panel = document.createElement("section");
      panel.className = `kawhi-production__panel kawhi-production__panel--${metric.kind}`;
      panel.innerHTML = `<h4>${escapeHtml(metric.title)}</h4>`;
      this.panels.appendChild(panel);
      const panelWidth = Math.max(270, Math.floor(panel.getBoundingClientRect().width));
      const height = 280;
      const margin = { top: 27, right: 18, bottom: 39, left: 43 };
      const left = margin.left;
      const right = panelWidth - margin.right;
      const top = margin.top;
      const bottom = height - margin.bottom;
      const x = d3.scalePoint().domain(MAIN_SEASONS).range([left, right]).padding(0.38);
      const y = d3.scaleLinear().domain(metric.domain).range([bottom, top]);
      const svg = d3.select(panel).append("svg")
        .attr("class", "kawhi-production__svg")
        .attr("viewBox", `0 0 ${panelWidth} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", `${this.instanceId}-${metric.key}-title ${this.instanceId}-${metric.key}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-${metric.key}-title`).text(metric.title);
      svg.append("desc").attr("id", `${this.instanceId}-${metric.key}-desc`).text(`Kawhi Leonard by season from 2018-19 through 2025-26. The 2021-22 rate is undefined because he made no regular-season appearances.`);

      svg.append("g").attr("class", "kawhi-production__grid")
        .attr("transform", `translate(${left},0)`)
        .call(d3.axisLeft(y).tickValues(metric.ticks).tickSize(-(right - left)).tickFormat(""));
      svg.append("g").attr("class", "kawhi-production__axis")
        .attr("transform", `translate(${left},0)`)
        .call(d3.axisLeft(y).tickValues(metric.ticks).tickSize(4).tickSizeOuter(0).tickPadding(6).tickFormat(metric.key === "trueShooting" ? (value) => `${Math.round(value * 100)}%` : d3.format("d")));
      svg.append("text").attr("class", "kawhi-production__axis-label").attr("x", left).attr("y", 12).text(metric.unit);
      svg.append("g").attr("class", "kawhi-production__axis kawhi-production__axis--x")
        .attr("transform", `translate(0,${bottom})`)
        .call(d3.axisBottom(x).tickSize(4).tickSizeOuter(0).tickPadding(7).tickFormat(shortSeason));

      const championshipX = x("2018-19");
      const clippersStart = (x("2018-19") + x("2019-20")) / 2;
      svg.append("rect").attr("class", "kawhi-production__championship-band")
        .attr("x", Math.max(left, championshipX - 17)).attr("y", top).attr("width", 34).attr("height", bottom - top);
      svg.append("line").attr("class", "kawhi-production__tenure-divider")
        .attr("x1", clippersStart).attr("x2", clippersStart).attr("y1", top).attr("y2", bottom);

      if (metric.kind === "bar") this.renderBars(svg, metric, x, y, top, bottom);
      else this.renderLine(svg, metric, x, y);

      const missedX = x("2021-22");
      svg.append("text").attr("class", "kawhi-production__missed-label")
        .attr("x", missedX).attr("y", top + 12).attr("text-anchor", "middle").text("Missed");
      svg.append("text").attr("class", "kawhi-production__missed-label")
        .attr("x", missedX).attr("y", top + 24).attr("text-anchor", "middle").text("season");

      const guide = svg.append("line").attr("class", "kawhi-production__season-guide")
        .attr("y1", top).attr("y2", bottom);
      const step = x.step();
      const hits = svg.append("g").selectAll("rect")
        .data(MAIN_SEASONS).join("rect")
        .attr("class", "kawhi-production__season-hit")
        .attr("data-season", (season) => season)
        .attr("x", (season) => x(season) - step / 2)
        .attr("y", top)
        .attr("width", step)
        .attr("height", bottom - top)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (season) => `Select ${season} across all Leonard panels`)
        .on("pointerenter pointerdown click focus", (event, season) => this.selectSeason(season, event.type !== "pointerenter"))
        .on("keydown", (event, season) => this.handleSeasonKey(event, season));
      this.panelStates.push({ metric, x, y, top, bottom, guide, hits });
    }

    renderBars(svg, metric, x, y, top, bottom) {
      const barWidth = Math.min(28, x.step() * 0.58);
      svg.append("g").selectAll("rect")
        .data(this.regularRows).join("rect")
        .attr("class", (row) => `kawhi-production__bar${row.season === "2018-19" ? " is-championship" : ""}`)
        .attr("data-season", (row) => row.season)
        .attr("x", (row) => x(row.season) - barWidth / 2)
        .attr("y", (row) => row.games === 0 ? bottom - 2 : y(row.games))
        .attr("width", barWidth)
        .attr("height", (row) => row.games === 0 ? 2 : bottom - y(row.games));
      svg.append("g").selectAll("text")
        .data(this.regularRows.filter((row) => row.season === "2018-19" || row.season === "2025-26"))
        .join("text").attr("class", "kawhi-production__direct-value")
        .attr("x", (row) => x(row.season)).attr("y", (row) => Math.max(top + 11, y(row.games) - 7))
        .attr("text-anchor", "middle").text((row) => metric.format(row.games));
    }

    renderLine(svg, metric, x, y) {
      const line = d3.line()
        .defined((row) => row[metric.key] != null)
        .x((row) => x(row.season))
        .y((row) => y(row[metric.key]));
      svg.append("path").datum(this.regularRows).attr("class", "kawhi-production__line").attr("d", line);
      svg.append("g").selectAll("circle")
        .data(this.regularRows.filter((row) => row[metric.key] != null)).join("circle")
        .attr("class", (row) => `kawhi-production__point${row.season === "2018-19" ? " is-championship" : ""}`)
        .attr("data-season", (row) => row.season)
        .attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row[metric.key])).attr("r", 4.2);
      svg.append("g").selectAll("text")
        .data(this.regularRows.filter((row) => row.season === "2018-19" || row.season === "2025-26"))
        .join("text").attr("class", "kawhi-production__direct-value")
        .attr("x", (row) => x(row.season))
        .attr("y", (row) => y(row[metric.key]) - 9)
        .attr("text-anchor", (row) => row.season === "2025-26" ? "end" : "start")
        .attr("dx", (row) => row.season === "2025-26" ? -6 : 6)
        .text((row) => metric.format(row[metric.key]));
    }

    handleSeasonKey(event, season) {
      let index = MAIN_SEASONS.indexOf(season);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") index = Math.max(0, index - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") index = Math.min(MAIN_SEASONS.length - 1, index + 1);
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = MAIN_SEASONS.length - 1;
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectSeason(season, true);
        return;
      } else return;
      event.preventDefault();
      const next = MAIN_SEASONS[index];
      this.selectSeason(next, true);
      const panel = event.currentTarget.closest("svg");
      panel?.querySelector(`[data-season="${next}"].kawhi-production__season-hit`)?.focus();
    }

    selectSeason(season, announce) {
      if (!MAIN_SEASONS.includes(season)) return;
      this.selectedSeason = season;
      this.select.value = season;
      this.updateSelection(announce);
      this.updateInspection(announce);
    }

    updateSelection() {
      this.panelStates.forEach(({ x, guide, hits }) => {
        guide.attr("x1", x(this.selectedSeason)).attr("x2", x(this.selectedSeason));
        hits.classed("is-selected", (season) => season === this.selectedSeason)
          .attr("aria-pressed", (season) => String(season === this.selectedSeason));
      });
      this.plot.querySelectorAll(".kawhi-production__bar, .kawhi-production__point").forEach((mark) => {
        mark.classList.toggle("is-selected", mark.dataset.season === this.selectedSeason);
      });
      this.playoffStrip.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("is-selected", button.dataset.season === this.selectedSeason);
        button.setAttribute("aria-pressed", String(button.dataset.season === this.selectedSeason));
      });
    }

    inspectionCard(row, label, type) {
      if (!row || row.appearanceStatus === "no_source_row") {
        return `<article class="kawhi-production__inspection-card kawhi-production__inspection-card--missing">
          <strong>${escapeHtml(label)}</strong>
          <span><b>No appearance recorded in supplied tables.</b></span>
          <span>Games and production rates are unknown; no absence reason is inferred.</span>
        </article>`;
      }
      if (row.appearanceStatus === "confirmed_no_appearance") {
        return `<article class="kawhi-production__inspection-card kawhi-production__inspection-card--missing">
          <strong>${escapeHtml(label)}</strong>
          <span><b>No appearances · 0 games · 0 total minutes</b></span>
          <span>MPG, PPG, points/100, TS% and USG% are undefined—not zero.</span>
          <span>Age ${row.age}</span>
        </article>`;
      }
      const sample = type === "postseason" && row.games === 2 ? '<em class="kawhi-production__small-sample">2-game sample</em>' : "";
      return `<article class="kawhi-production__inspection-card kawhi-production__inspection-card--${type}">
        <strong>${escapeHtml(label)} ${sample}</strong>
        <span>${row.games} games · ${formatInteger(row.totalMinutes)} total minutes · ${row.minutesPerGame.toFixed(1)} MPG · age ${row.age}</span>
        <span><b>${row.pointsPerGame.toFixed(1)}</b> PPG · <b>${row.pointsPer100.toFixed(1)}</b> points/100 · <b>${formatFraction(row.trueShooting)}</b> TS · <b>${formatPercentPoints(row.usage)}</b> USG</span>
      </article>`;
    }

    updateInspection(announce) {
      if (!this.regularBySeason.size) return;
      const regular = this.regularBySeason.get(this.selectedSeason);
      const postseason = this.postseasonBySeason.get(this.selectedSeason);
      this.inspectionTitle.textContent = fullSeason(this.selectedSeason);
      const regularCard = this.inspectionCard(regular, "Regular season", "regular");
      const postseasonCard = this.selectedSeason === "2025-26"
        ? `<article class="kawhi-production__inspection-card kawhi-production__inspection-card--missing"><strong>Postseason</strong><span><b>Outside supplied postseason coverage.</b></span><span>Records stop at 2024–25; no 2025–26 result is inferred.</span></article>`
        : this.inspectionCard(postseason, "Postseason", "postseason");
      this.inspectionValues.innerHTML = regularCard + postseasonCard;
      if (announce) {
        const regularText = regular.appearanceStatus === "confirmed_no_appearance"
          ? "No regular-season appearances; production rates are undefined."
          : `${regular.games} regular-season games, ${regular.totalMinutes} minutes, ${regular.pointsPer100.toFixed(1)} points per 100 and ${formatFraction(regular.trueShooting)} true shooting.`;
        const postseasonText = this.selectedSeason === "2025-26"
          ? "Postseason records stop at 2024-25."
          : postseason.appearanceStatus === "no_source_row"
            ? "No postseason appearance is recorded in the supplied tables."
            : `${postseason.games} postseason games and ${postseason.totalMinutes} minutes.`;
        this.inspectionAnnouncement.textContent = `${this.selectedSeason}. ${regularText} ${postseasonText}`;
      }
    }

    renderPlayoffStrip() {
      this.playoffStrip.innerHTML = this.postseasonRows.map((row) => {
        const missing = row.appearanceStatus === "no_source_row";
        const tiny = row.games === 2;
        const classes = ["kawhi-production__playoff-item", missing ? "is-missing" : "", tiny ? "is-two-game" : ""].filter(Boolean).join(" ");
        return `<button type="button" class="${classes}" data-season="${row.season}" aria-pressed="false">
          <span class="kawhi-production__playoff-season">${fullSeason(row.season)}</span>
          ${missing
            ? '<span class="kawhi-production__playoff-missing">No appearance recorded in supplied tables</span>'
            : `<span><b>${row.games} G</b> / ${formatInteger(row.totalMinutes)} min</span>${tiny ? '<em>2-game sample</em>' : ""}`}
        </button>`;
      }).join("");
      this.playoffStrip.querySelectorAll("button").forEach((button) => {
        button.addEventListener("pointerenter", () => this.selectSeason(button.dataset.season, false));
        button.addEventListener("pointerdown", () => this.selectSeason(button.dataset.season, true));
        button.addEventListener("click", () => this.selectSeason(button.dataset.season, true));
        button.addEventListener("focus", () => this.selectSeason(button.dataset.season, false));
      });
    }

    renderTable() {
      const rows = [
        ...this.regularRows,
        ...this.postseasonRows,
      ].sort((a, b) => d3.ascending(a.seasonStart, b.seasonStart) || d3.ascending(a.seasonType, b.seasonType));
      const columns = [
        ["Season", "Season", (row) => fullSeason(row.season)],
        ["Type", "Season type", (row) => row.seasonType === "regular_season" ? "Regular season" : "Postseason"],
        ["Team", "Source team", (row) => row.team],
        ["Status", "Appearance status", (row) => row.appearanceStatus === "appeared" ? "Appeared" : row.appearanceStatus === "confirmed_no_appearance" ? "No appearances" : "No source row"],
        ["Age", "Age", (row) => valueOrUndefined(row.age, String)],
        ["G", "Games", (row) => valueOrUndefined(row.games, String)],
        ["GS", "Starts", (row) => valueOrUndefined(row.starts, String)],
        ["MPG", "Minutes/game", (row) => valueOrUndefined(row.minutesPerGame, (value) => value.toFixed(1))],
        ["MP", "Total minutes", (row) => valueOrUndefined(row.totalMinutes, formatInteger)],
        ["PPG", "Points/game", (row) => valueOrUndefined(row.pointsPerGame, (value) => value.toFixed(1))],
        ["PTS/100", "Points/100", (row) => valueOrUndefined(row.pointsPer100, (value) => value.toFixed(1))],
        ["AST/100", "Assists/100", (row) => valueOrUndefined(row.assistsPer100, (value) => value.toFixed(1))],
        ["TS%", "True shooting", (row) => formatFraction(row.trueShooting)],
        ["USG%", "Usage", (row) => formatPercentPoints(row.usage)],
        ["TOV%", "Turnover percentage", (row) => formatPercentPoints(row.turnoverPct)],
      ];
      this.tableWrap.innerHTML = `<table class="kawhi-production__table team-graphic__table">
        <caption>Leonard regular seasons from 2018–19 through 2025–26 and supplied postseason records through 2024–25. Undefined values are not zeroes.</caption>
        <thead><tr>${columns.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr class="kawhi-production__table-row">${columns.map(([, mobileLabel, formatter], index) => {
          const tag = index === 0 ? "th" : "td";
          const scope = index === 0 ? ' scope="row"' : "";
          return `<${tag}${scope} data-label="${escapeHtml(mobileLabel)}">${escapeHtml(formatter(row))}</${tag}>`;
        }).join("")}</tr>`).join("")}</tbody>
      </table>`;
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-kawhi-production-chart]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".kawhi-production__status");
        status.className = "kawhi-production__status kawhi-production__status--error";
        status.textContent = "The chart library could not be loaded. The normalized CSV remains available.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.kawhiInitialized === "true") return;
      root.dataset.kawhiInitialized = "true";
      const chart = new KawhiChart(root);
      root.kawhiProductionChart = chart;
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
