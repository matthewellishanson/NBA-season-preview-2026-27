(function initializeHeatPreviewCharts() {
  "use strict";

  const d3 = window.d3;
  const displaySeason = (value) => value.replace("-", "\u2013");
  const fractionPercent = (value) => `${(value * 100).toFixed(1)}%`;
  const number = (row, key, allowMissing = false) => {
    if (allowMissing && row[key] === "") return null;
    const value = Number(row[key]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${key}.`);
    return value;
  };

  function error(root, message, error) {
    console.error(message, error);
    root.setAttribute("aria-busy", "false");
    const status = root.querySelector(".heat-chart__status");
    if (status) {
      status.className = "heat-chart__status heat-chart__status--error";
      status.textContent = "This graphic could not be displayed. The complete validated values remain available in the table below.";
    }
  }

  function mountWhenOpen(root, load) {
    const card = root.closest("details");
    let started = false;
    const start = () => {
      if (started || (card && !card.open)) return;
      started = true;
      requestAnimationFrame(load);
    };
    card?.addEventListener("toggle", start);
    start();
  }

  function parseKlay(row) {
    return {
      season: row.season, team: row.team, status: row.status,
      games: number(row, "games", true), mpg: number(row, "minutes_per_game", true),
      threePct: number(row, "three_pct", true), threePa: number(row, "three_attempts_per_game", true),
      threeRate: number(row, "three_point_attempt_rate", true), twoPct: number(row, "two_pct", true),
      twoPa: number(row, "two_attempts_per_game", true), ts: number(row, "true_shooting_pct", true),
      threePlus: number(row, "three_plus", true),
    };
  }

  class KlayChart {
    constructor(root) {
      this.root = root;
      this.plot = root.querySelector(".heat-chart__panels");
      this.lastWidth = 0;
      this.observer = new ResizeObserver(() => this.queue());
      this.observer.observe(this.plot);
    }
    async load() {
      try {
        this.rows = await d3.csv(this.root.dataset.source, parseKlay);
        if (this.rows.length !== 13 || this.rows.filter((row) => row.status === "absence").map((row) => row.season).join("|") !== "2019-20|2020-21") throw new Error("Klay season coverage changed.");
        const anchor = this.rows.find((row) => row.season === "2025-26");
        if ([anchor.games, anchor.mpg, anchor.threePct, anchor.threePa, anchor.threeRate, anchor.twoPct, anchor.ts, anchor.threePlus].join("|") !== "69|21.7|0.383|7.6|0.724|0.418|0.541|107") throw new Error("Klay validation anchor changed.");
        this.root.querySelector(".heat-chart__status").remove();
        this.root.setAttribute("aria-busy", "false");
        this.render(true);
      } catch (caught) { error(this.root, "Klay chart error:", caught); }
    }
    queue() { if (!this.rows || this.queued) return; this.queued = true; requestAnimationFrame(() => { this.queued = false; this.render(); }); }
    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width || (!force && width === this.lastWidth)) return;
      this.lastWidth = width;
      this.plot.replaceChildren();
      const metrics = [
        { key: "threePct", title: "Three-point accuracy", domain: [0.3, 0.47], ticks: [0.3, 0.35, 0.4, 0.45], format: fractionPercent, support: (row) => `${row.threePa.toFixed(1)} 3PA/G \u00b7 3P+ ${row.threePlus}` },
        { key: "threeRate", title: "Three-point reliance", domain: [0.35, 0.76], ticks: [0.4, 0.5, 0.6, 0.7], format: fractionPercent, support: (row) => `${row.threePa.toFixed(1)} 3PA/G` },
        { key: "twoPct", title: "Two-point accuracy", domain: [0.39, 0.54], ticks: [0.4, 0.45, 0.5], format: fractionPercent, support: (row) => `${row.twoPa.toFixed(1)} 2PA/G` },
      ];
      metrics.forEach((metric, index) => this.panel(metric, index));
    }
    panel(metric, index) {
      const panel = document.createElement("section");
      panel.className = "heat-chart__panel";
      panel.innerHTML = `<h4 class="heat-chart__panel-title">${metric.title}</h4>`;
      this.plot.appendChild(panel);
      const width = Math.max(300, panel.clientWidth - 20);
      const mobile = width < 520;
      const height = index === 2 ? (mobile ? 225 : 190) : (mobile ? 205 : 165);
      const margin = { top: 24, right: 15, bottom: index === 2 ? 62 : 24, left: 43 };
      const seasons = this.rows.filter((row) => row.status !== "snapshot").map((row) => row.season);
      const x = d3.scalePoint(seasons, [margin.left, width - margin.right]).padding(.35);
      const y = d3.scaleLinear(metric.domain, [height - margin.bottom, margin.top]);
      const svg = d3.select(panel).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", `${metric.title} by season from 2014-15 through 2025-26.`);
      const bandStart = (x("2018-19") + x("2019-20")) / 2;
      const bandEnd = (x("2020-21") + x("2021-22")) / 2;
      svg.append("rect").attr("class", "heat-chart__absence-band").attr("x", bandStart).attr("y", 7).attr("width", bandEnd - bandStart).attr("height", height - margin.bottom - 7);
      if (index === 0) svg.append("text").attr("class", "heat-chart__absence-label").attr("x", (bandStart + bandEnd) / 2).attr("y", 18).attr("text-anchor", "middle").text("Missed both seasons");
      svg.append("g").selectAll("line").data(metric.ticks).join("line").attr("class", "heat-chart__grid").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y).attr("y2", y);
      svg.append("g").selectAll("text").data(metric.ticks).join("text").attr("class", "heat-chart__axis-label").attr("x", margin.left - 6).attr("y", (tick) => y(tick) + 3).attr("text-anchor", "end").text(fractionPercent);
      const completed = this.rows.filter((row) => row.status === "completed");
      const segments = [];
      let segment = [];
      this.rows.filter((row) => row.status !== "snapshot").forEach((row) => {
        if (row.status === "absence") { if (segment.length) segments.push(segment); segment = []; }
        else segment.push(row);
      });
      if (segment.length) segments.push(segment);
      svg.append("g").selectAll("path").data(segments).join("path").attr("class", "heat-chart__line").attr("d", d3.line().x((row) => x(row.season)).y((row) => y(row[metric.key])));
      const points = svg.append("g").selectAll("g").data(completed).join("g").attr("transform", (row) => `translate(${x(row.season)},${y(row[metric.key])})`);
      points.append("circle").attr("class", "heat-chart__point").attr("r", 4.5).append("title").text((row) => `${displaySeason(row.season)}, ${row.team}: ${metric.format(row[metric.key])}; ${metric.support(row)}; ${row.games} games.`);
      const mobileLabelOffsets = [-9, 16, -24];
      const mobileLabelSeasons = new Set(["2014-15", "2016-17", "2018-19", "2021-22", "2023-24", "2025-26"]);
      points.append("text").attr("class", "heat-chart__value").attr("text-anchor", "middle").attr("y", (row, pointIndex) => mobile ? mobileLabelOffsets[pointIndex % mobileLabelOffsets.length] : -9).text((row) => mobile && !mobileLabelSeasons.has(row.season) ? "" : metric.format(row[metric.key]));
      if (index === 0) svg.append("text").attr("class", "heat-chart__return-label").attr("x", x("2021-22") + 7).attr("y", y(this.rows.find((row) => row.season === "2021-22")[metric.key]) + (mobile ? 29 : 15)).text("32 games");
      if (index === 2) {
        svg.append("g").selectAll("text").data(seasons).join("text").attr("class", "heat-chart__season").attr("transform", (season) => `translate(${x(season)},${height - margin.bottom + 13}) rotate(-42)`).attr("text-anchor", "end").text(displaySeason);
        svg.append("text").attr("class", "heat-chart__era").attr("x", x("2017-18")).attr("y", height - 4).attr("text-anchor", "middle").text("GOLDEN STATE");
        svg.append("text").attr("class", "heat-chart__era").attr("x", (x("2024-25") + x("2025-26")) / 2).attr("y", height - 4).attr("text-anchor", "middle").text("DALLAS");
      }
    }
  }

  function parseBam(row) { return { season: row.season, games: number(row, "games"), attempts: number(row, "three_attempts_per_game"), pct: number(row, "three_pct"), rate: number(row, "three_point_attempt_rate") }; }
  function parseProfile(row) { return { id: row.player_id, name: row.player_name, team: row.team, games: number(row, "games"), rim: number(row, "within_three_share"), other: number(row, "other_two_share"), three: number(row, "three_share"), rimPct: number(row, "within_three_fg_pct"), threePct: number(row, "three_pct"), ts: number(row, "true_shooting_pct") }; }

  class FitChart {
    constructor(root) { this.root = root; this.plotA = root.querySelector("[data-heat-bam-role]"); this.plotB = root.querySelector("[data-heat-star-profiles]"); this.observer = new ResizeObserver(() => this.queue()); this.observer.observe(root.querySelector(".heat-fit__layout")); }
    async load() {
      try {
        [this.bam, this.profiles] = await Promise.all([d3.csv(this.root.dataset.bamSource, parseBam), d3.csv(this.root.dataset.profileSource, parseProfile)]);
        if (this.bam.map((row) => [row.games, row.attempts, row.pct].join("/")).join("|") !== "71/0.6/0.357|78/2.8/0.357|73/5.5/0.318") throw new Error("Bam role anchors changed.");
        if (this.profiles.map((row) => [row.rim, row.other, row.three].join("/")).join("|") !== "0.205/0.446/0.349|0.61/0.315/0.075") throw new Error("Shot profile anchors changed.");
        this.root.querySelector(".heat-chart__status").remove(); this.root.setAttribute("aria-busy", "false"); this.render(true);
      } catch (caught) { error(this.root, "Bam/Giannis chart error:", caught); }
    }
    queue() { if (!this.bam || this.queued) return; this.queued = true; requestAnimationFrame(() => { this.queued = false; this.render(); }); }
    render() { this.renderRole(); this.renderProfiles(); }
    renderRole() {
      this.plotA.replaceChildren();
      const width = Math.max(300, this.plotA.clientWidth - 20), height = 205, margin = { top: 43, right: 74, bottom: 20, left: 65 };
      const y = d3.scaleBand(this.bam.map((row) => row.season), [margin.top, height - margin.bottom]).padding(.38);
      const xAttempts = d3.scaleLinear([0, 6], [margin.left, width * .58]);
      const xPct = d3.scaleLinear([.25, .4], [width * .69, width - 12]);
      const svg = d3.select(this.plotA).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Bam Adebayo three-point attempts and accuracy across three completed seasons.");
      svg.append("text").attr("class", "heat-chart__axis-label").attr("x", margin.left).attr("y", 12).text("3PA per game");
      svg.append("text").attr("class", "heat-chart__axis-label").attr("x", width * .69).attr("y", 12).text("3P%");
      const pctTicks = [.25, .30, .35, .40];
      svg.append("g").selectAll("line").data(pctTicks).join("line").attr("class", "heat-chart__grid").attr("x1", xPct).attr("x2", xPct).attr("y1", margin.top - 5).attr("y2", height - margin.bottom + 4);
      svg.append("g").selectAll("text").data(pctTicks).join("text").attr("class", "heat-chart__axis-label").attr("x", xPct).attr("y", 29).attr("text-anchor", "middle").text((tick) => `${Math.round(tick * 100)}%`);
      const row = svg.append("g").selectAll("g").data(this.bam).join("g");
      row.append("text").attr("class", "heat-chart__season").attr("x", margin.left - 7).attr("y", (d) => y(d.season) + y.bandwidth() / 2 + 3).attr("text-anchor", "end").text((d) => displaySeason(d.season));
      row.append("rect").attr("class", "heat-fit__bar").attr("x", margin.left).attr("y", (d) => y(d.season)).attr("width", (d) => xAttempts(d.attempts) - margin.left).attr("height", y.bandwidth());
      row.append("text").attr("class", "heat-chart__value").attr("x", (d) => xAttempts(d.attempts) + 5).attr("y", (d) => y(d.season) + y.bandwidth() / 2 + 3).text((d) => d.attempts.toFixed(1));
      row.append("circle").attr("class", "heat-fit__dot").attr("cx", (d) => xPct(d.pct)).attr("cy", (d) => y(d.season) + y.bandwidth() / 2).attr("r", 5);
      row.append("text").attr("class", "heat-chart__value").attr("x", (d) => xPct(d.pct) + (d.pct > .37 ? -8 : 8)).attr("y", (d) => y(d.season) + y.bandwidth() / 2 + 3).attr("text-anchor", (d) => d.pct > .37 ? "end" : "start").text((d) => fractionPercent(d.pct));
      row.append("text").attr("class", "heat-chart__axis-label").attr("x", width - 4).attr("y", (d) => y(d.season) + y.bandwidth() / 2 + 16).attr("text-anchor", "end").text((d) => `${d.games} G`);
    }
    renderProfiles() {
      this.plotB.replaceChildren();
      const width = Math.max(300, this.plotB.clientWidth - 20), height = 160, margin = { top: 31, right: 8, bottom: 18, left: 78 };
      const x = d3.scaleLinear([0, 1], [margin.left, width - margin.right]);
      const y = d3.scaleBand(this.profiles.map((row) => row.id), [margin.top, height - margin.bottom]).padding(.38);
      const svg = d3.select(this.plotB).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Bam Adebayo and Giannis Antetokounmpo 2025-26 field-goal attempt distributions.");
      const groups = svg.append("g").selectAll("g").data(this.profiles).join("g");
      groups.append("text").attr("class", "heat-chart__season").attr("x", margin.left - 7).attr("y", (d) => y(d.id) + y.bandwidth() / 2 - 2).attr("text-anchor", "end").text((d) => d.name.split(" ")[0]);
      groups.append("text").attr("class", "heat-chart__axis-label").attr("x", margin.left - 7).attr("y", (d) => y(d.id) + y.bandwidth() / 2 + 11).attr("text-anchor", "end").text((d) => `${d.team} \u00b7 ${d.games} G`);
      const segments = groups.selectAll("rect").data((d) => [{ key: "rim", value: d.rim, start: 0 }, { key: "other", value: d.other, start: d.rim }, { key: "three", value: d.three, start: d.rim + d.other }]).join("rect").attr("class", (d) => `heat-fit__segment--${d.key}`).attr("x", (d) => x(d.start)).attr("y", function () { return y(this.parentNode.__data__.id); }).attr("width", (d) => x(d.start + d.value) - x(d.start)).attr("height", y.bandwidth());
      groups.selectAll("text.segment").data((d) => [{ key: "rim", value: d.rim, start: 0 }, { key: "other", value: d.other, start: d.rim }, { key: "three", value: d.three, start: d.rim + d.other }]).join("text").attr("class", (d) => `heat-fit__segment-label segment${d.key === "three" ? " is-dark" : ""}`).attr("x", (d) => (x(d.start) + x(d.start + d.value)) / 2).attr("y", function () { return y(this.parentNode.__data__.id) + y.bandwidth() / 2 + 3.5; }).attr("text-anchor", "middle").text((d) => d.value >= .12 ? fractionPercent(d.value) : fractionPercent(d.value));
      svg.append("text").attr("class", "heat-chart__axis-label").attr("x", margin.left).attr("y", 14).text("Share of field-goal attempts \u00b7 2025\u201326");
    }
  }

  function parseMatrix(row) { return { group: row.group, id: row.player_id, name: row.player_name, team: row.team_2025_26, transaction: row.transaction, games: number(row, "games"), mpg: number(row, "minutes_per_game"), minutes: number(row, "total_minutes"), threePa: number(row, "three_attempts_per_100"), threePct: number(row, "three_pct"), assists: number(row, "assists_per_100"), ts: number(row, "true_shooting_pct") }; }
  async function loadMatrix(root) {
    try {
      const rows = await d3.csv(root.dataset.source, parseMatrix);
      if (rows.length !== 7 || rows.filter((row) => row.group === "Departure").reduce((sum, row) => sum + row.minutes, 0) !== 7520) throw new Error("Offseason matrix coverage changed.");
      const domains = { threePa: [0, 18], threePct: [.25, .45], assists: [0, 10], ts: [.5, .68] };
      root.querySelectorAll("[data-player-id]").forEach((tr) => {
        const row = rows.find((item) => item.id === tr.dataset.playerId);
        if (!row) throw new Error(`Missing rendered player ${tr.dataset.playerId}.`);
        Object.entries(domains).forEach(([key, [minimum, maximum]]) => {
          const cell = tr.querySelector(`[data-metric="${key}"]`);
          if (!cell) return;
          cell.style.setProperty("--metric-width", `${Math.max(0, Math.min(100, (row[key] - minimum) / (maximum - minimum) * 100))}%`);
          cell.classList.toggle("heat-matrix__metric--dot", key === "threePct" || key === "ts");
        });
      });
      const updateLayout = () => {
        const width = root.getBoundingClientRect().width;
        const compact = width < 620;
        root.classList.toggle("is-compact", compact);
        root.classList.toggle("is-compact-wide", compact && width >= 460);
        root.dataset.matrixLayout = compact ? "compact" : "matrix";
      };
      root.matrixResizeObserver?.disconnect();
      root.matrixResizeObserver = new ResizeObserver(updateLayout);
      root.matrixResizeObserver.observe(root);
      updateLayout();
      root.setAttribute("aria-busy", "false");
    } catch (caught) { error(root, "Offseason matrix error:", caught); }
  }

  document.querySelectorAll("[data-heat-klay-chart]").forEach((root) => mountWhenOpen(root, () => d3 ? new KlayChart(root).load() : error(root, "D3 unavailable", new Error("D3 unavailable"))));
  document.querySelectorAll("[data-heat-fit-chart]").forEach((root) => mountWhenOpen(root, () => d3 ? new FitChart(root).load() : error(root, "D3 unavailable", new Error("D3 unavailable"))));
  document.querySelectorAll("[data-heat-offseason-chart]").forEach((root) => mountWhenOpen(root, () => d3 ? loadMatrix(root) : error(root, "D3 unavailable", new Error("D3 unavailable"))));
})();
