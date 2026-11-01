(function initializePortlandPreviewCharts() {
  "use strict";

  const d3 = window.d3;
  const CLINGAN_ID = "clingdo01";
  const SEASONS = ["2023-24", "2024-25", "2025-26"];
  const CENTER_METRICS = [
    { key: "orb_pct", title: "Offensive rebound percentage", note: "Estimated share of available offensive rebounds collected while on court" },
    { key: "drb_pct", title: "Defensive rebound percentage", note: "Estimated share of available defensive rebounds collected while on court" },
    { key: "blk_pct", title: "Block percentage", note: "Estimated share of opponent two-point attempts blocked while on court" },
  ];
  const DENI_METRICS = [
    { key: "usagePct", title: "Usage percentage", note: "Estimated share of team plays used while on court", domain: [18, 31], ticks: [20, 25, 30], format: percentUnits },
    { key: "assistsPer100", title: "Assists per 100 possessions", note: "", domain: [4, 11], ticks: [5, 8, 11], format: oneDecimal },
    { key: "ftaPer100Fga", title: "Free-throw attempts per 100 FGA", note: "FTr × 100; not free throws per 100 possessions", domain: [30, 60], ticks: [30, 45, 60], format: oneDecimal },
  ];
  let instanceCount = 0;

  function oneDecimal(value) { return value.toFixed(1); }
  function percentUnits(value) { return `${value.toFixed(1)}%`; }
  function fractionalPercent(value) { return `${(value * 100).toFixed(1)}%`; }
  function displaySeason(value) { return value.replace("-", "\u2013"); }
  function ordinal(value) {
    const lastTwo = value % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
    return `${value}${({ 1: "st", 2: "nd", 3: "rd" })[value % 10] || "th"}`;
  }
  function displayRank(profile) { return profile.tieCount > 1 ? `Tied ${ordinal(profile.rank)}` : ordinal(profile.rank); }
  function numeric(row, field) {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field}.`);
    return value;
  }
  function cssValue(root, token) { return getComputedStyle(root).getPropertyValue(token).trim(); }

  function parseCenter(row) {
    return {
      playerId: row.player_id?.trim(), playerName: row.player_name?.trim(), games: numeric(row, "games"),
      starts: numeric(row, "starts"), totalMinutes: numeric(row, "total_minutes"), position: row.source_position?.trim(),
      team: row.source_team?.trim(), orb_pct: numeric(row, "orb_pct"), drb_pct: numeric(row, "drb_pct"),
      blk_pct: numeric(row, "blk_pct"), isClingan: row.is_clingan === "true",
    };
  }
  function parseProfile(row) {
    return {
      playerId: row.player_id?.trim(), metricKey: row.metric_key?.trim(), sourceValue: numeric(row, "source_value"),
      displayValue: row.display_value?.trim(), rank: numeric(row, "rank"), rankDisplay: row.rank_display?.trim(),
      tieCount: numeric(row, "tie_count"), validQualifiers: numeric(row, "valid_qualifiers"),
    };
  }
  function parseDeni(row) {
    return {
      playerName: row.player_name?.trim(), season: row.season?.trim(), team: row.team?.trim(), games: numeric(row, "games"),
      starts: numeric(row, "starts"), totalMinutes: numeric(row, "total_minutes"), mpg: numeric(row, "minutes_per_game"),
      usagePct: numeric(row, "usage_pct"), assistsPer100: numeric(row, "assists_per_100"),
      assistsPerGame: numeric(row, "assists_per_game"), ftaPer100Fga: numeric(row, "fta_per_100_fga"),
      freeThrowRate: numeric(row, "free_throw_rate"), trueShooting: numeric(row, "true_shooting_pct"),
    };
  }

  function validateCenters(peers, profile) {
    if (peers.length !== 72 || new Set(peers.map((row) => row.playerId)).size !== 72) throw new Error("Expected 72 unique center records.");
    if (profile.length !== 3 || new Set(profile.map((row) => row.metricKey)).size !== 3) throw new Error("Expected three unique Clingan profile rows.");
    const clingan = peers.find((row) => row.playerId === CLINGAN_ID);
    if (!clingan || clingan.playerName !== "Donovan Clingan" || !clingan.isClingan || clingan.games !== 144 || clingan.totalMinutes !== 3418) {
      throw new Error("Clingan identity or combined sample is invalid.");
    }
    const offensiveLeaders = [...peers].sort((a, b) => b.orb_pct - a.orb_pct).slice(0, 2);
    if (offensiveLeaders[0].playerId !== "robinmi01" || offensiveLeaders[0].playerName !== "Mitchell Robinson" || offensiveLeaders[0].orb_pct !== 23.3 ||
        offensiveLeaders[1].playerId !== "adamsst01" || offensiveLeaders[1].playerName !== "Steven Adams" || offensiveLeaders[1].orb_pct !== 22.1) {
      throw new Error("Offensive-rebounding leader identities or values changed.");
    }
    const expected = new Map([
      ["orb_pct", [17.6, 3, "3", 1]],
      ["drb_pct", [27.6, 14, "14", 1]],
      ["blk_pct", [6.3, 7, "T-7", 2]],
    ]);
    CENTER_METRICS.forEach((metric) => {
      const row = profile.find((candidate) => candidate.metricKey === metric.key);
      const values = peers.map((peer) => peer[metric.key]);
      const rank = 1 + values.filter((value) => value > clingan[metric.key]).length;
      const tieCount = values.filter((value) => value === clingan[metric.key]).length;
      const exp = expected.get(metric.key);
      if (!row || row.playerId !== CLINGAN_ID || row.validQualifiers !== 72 || row.sourceValue !== exp[0] || row.rank !== exp[1] || row.rankDisplay !== exp[2] || row.tieCount !== exp[3] || rank !== exp[1] || tieCount !== exp[3]) {
        throw new Error(`${metric.key} conflicts with the verified source-precision rank.`);
      }
    });
    return clingan;
  }

  function validateDeni(rows) {
    if (rows.length !== 3) throw new Error(`Expected three Deni seasons; found ${rows.length}.`);
    const expected = new Map([
      ["2023-24", ["WAS", 75, 30.1, 20.2, 5.9, 34.0, 0.597]],
      ["2024-25", ["POR", 72, 30.0, 23.2, 6.3, 44.1, 0.605]],
      ["2025-26", ["POR", 66, 33.3, 29.3, 9.6, 57.3, 0.600]],
    ]);
    rows.forEach((row, index) => {
      const exp = expected.get(row.season);
      const actual = [row.team, row.games, row.mpg, row.usagePct, row.assistsPer100, row.ftaPer100Fga, row.trueShooting];
      if (row.playerName !== "Deni Avdija" || row.season !== SEASONS[index] || !exp || actual.some((value, valueIndex) => value !== exp[valueIndex])) {
        throw new Error(`${row.season} conflicts with verified Deni values or order.`);
      }
      if (row.season.startsWith("2026") || row.freeThrowRate * 100 !== row.ftaPer100Fga) throw new Error(`${row.season} has invalid season coverage or FTr units.`);
      if (Math.abs(row.totalMinutes / row.games - row.mpg) > 0.08) throw new Error(`${row.season} confuses total minutes and MPG.`);
    });
  }

  class ResponsiveChart {
    constructor(root, plot) {
      this.root = root;
      this.plot = plot;
      this.lastWidth = 0;
      this.resizeObserver = new ResizeObserver(() => this.queueRender());
      this.resizeObserver.observe(plot);
    }
    queueRender() {
      if (!this.ready || this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => { this.queued = false; this.render(); });
    }
  }

  class ClinganCentersChart extends ResponsiveChart {
    constructor(root) {
      super(root, root.querySelector(".clingan-centers__panels"));
      this.status = root.querySelector(".portland-chart__status");
      this.instanceId = `clingan-centers-${++instanceCount}`;
    }
    load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = Promise.all([
        d3.csv(this.root.dataset.peerSource, parseCenter),
        d3.csv(this.root.dataset.profileSource, parseProfile),
      ]).then(([peers, profile]) => {
        this.peers = peers; this.profile = profile; this.clingan = validateCenters(peers, profile); this.ready = true;
        this.root.setAttribute("aria-busy", "false"); this.status.remove(); this.render(true);
      }).catch((error) => this.fail(error));
      return this.loadPromise;
    }
    fail(error) {
      console.error("Portland Clingan chart data error:", error);
      this.root.setAttribute("aria-busy", "false");
      this.status.className = "portland-chart__status portland-chart__status--error";
      this.status.textContent = "Clingan's center comparison could not be displayed. The complete validated values remain available in the table below.";
    }
    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width || (!force && width === this.lastWidth)) return;
      this.lastWidth = width; this.plot.replaceChildren();
      CENTER_METRICS.forEach((metric, index) => this.renderPanel(metric, index));
    }
    renderPanel(metric, metricIndex) {
      const profile = this.profile.find((row) => row.metricKey === metric.key);
      const panel = document.createElement("section");
      panel.className = "clingan-centers__panel";
      const headingId = `${this.instanceId}-${metric.key}`;
      const descId = `${headingId}-desc`;
      panel.innerHTML = `<h4 class="clingan-centers__metric" id="${headingId}">${metric.title}</h4><p class="clingan-centers__metric-note">${metric.note}</p>`;
      this.plot.appendChild(panel);
      const width = Math.max(270, Math.floor(panel.getBoundingClientRect().width));
      const height = 92;
      const margin = { top: 14, right: 20, bottom: 26, left: 14 };
      const values = this.peers.map((row) => row[metric.key]);
      const x = d3.scaleLinear().domain([Math.max(0, d3.min(values) - 1), d3.max(values) + 2]).nice().range([margin.left, width - margin.right]);
      const svg = d3.select(panel).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-labelledby", `${headingId} ${descId}`);
      const rankLabel = displayRank(profile);
      svg.append("desc").attr("id", descId).text(`${this.peers.length} qualifying centers are shown as subdued dots. Donovan Clingan is highlighted at ${profile.displayValue}, ${rankLabel} of 72.`);
      svg.append("line").attr("class", "clingan-centers__baseline").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", 39).attr("y2", 39);
      svg.append("g").selectAll("circle").data(this.peers.filter((row) => !row.isClingan)).join("circle")
        .attr("class", "clingan-centers__peer").attr("cx", (row) => x(row[metric.key]))
        .attr("cy", (_, index) => 39 + (((index * 7 + metricIndex * 3) % 9) - 4) * 1.7).attr("r", 3.1)
        .append("title").text((row) => `${row.playerName}: ${row[metric.key].toFixed(1)}%`);
      const focusX = x(this.clingan[metric.key]);
      svg.append("circle").attr("class", "clingan-centers__focus").attr("cx", focusX).attr("cy", 39).attr("r", 6.5)
        .append("title").text(`Donovan Clingan: ${profile.displayValue}, ${rankLabel} of 72.`);
      const showOffensiveLeaders = metric.key === "orb_pct" && width >= 620;
      const anchorEnd = focusX > width * 0.62 || showOffensiveLeaders;
      svg.append("text").attr("class", "clingan-centers__label").attr("x", focusX + (anchorEnd ? -10 : 10)).attr("y", 19)
        .attr("text-anchor", anchorEnd ? "end" : "start").text(`${profile.displayValue} · ${rankLabel} of 72`);
      svg.append("text").attr("class", "clingan-centers__rank").attr("x", focusX + (anchorEnd ? -10 : 10)).attr("y", 31)
        .attr("text-anchor", anchorEnd ? "end" : "start").text("Clingan");
      if (showOffensiveLeaders) {
        const leaders = [...this.peers].sort((a, b) => b.orb_pct - a.orb_pct).slice(0, 2);
        svg.append("g").selectAll("text").data(leaders).join("text")
          .attr("class", "clingan-centers__peer-label")
          .attr("x", (row) => x(row.orb_pct) - 5)
          .attr("y", (_, index) => index === 0 ? 10 : 57)
          .attr("text-anchor", "end")
          .text((row) => `${row.playerName} ${row.orb_pct.toFixed(1)}%`);
      }
      svg.append("g").attr("class", "clingan-centers__axis").attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(width < 430 ? 4 : 6).tickFormat((value) => `${value}%`).tickSizeOuter(0));
    }
  }

  class DeniOffenseChart extends ResponsiveChart {
    constructor(root) {
      super(root, root.querySelector(".deni-offense__panels"));
      this.status = root.querySelector(".portland-chart__status");
      this.instanceId = `deni-offense-${++instanceCount}`;
    }
    load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = d3.csv(this.root.dataset.source, parseDeni).then((rows) => {
        validateDeni(rows); this.rows = rows; this.ready = true;
        this.root.setAttribute("aria-busy", "false"); this.status.remove(); this.render(true); this.renderSupport();
      }).catch((error) => this.fail(error));
      return this.loadPromise;
    }
    fail(error) {
      console.error("Portland Deni chart data error:", error);
      this.root.setAttribute("aria-busy", "false");
      this.status.className = "portland-chart__status portland-chart__status--error";
      this.status.textContent = "Avdija's offensive development chart could not be displayed. The complete validated values remain available in the table below.";
    }
    render(force = false) {
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (!width || (!force && width === this.lastWidth)) return;
      this.lastWidth = width; this.plot.replaceChildren();
      DENI_METRICS.forEach((metric) => this.renderPanel(metric));
    }
    renderPanel(metric) {
      const panel = document.createElement("section");
      panel.className = "deni-offense__panel";
      const headingId = `${this.instanceId}-${metric.key}`;
      const descId = `${headingId}-desc`;
      panel.innerHTML = `<div class="deni-offense__panel-head"><h4 class="deni-offense__metric" id="${headingId}">${metric.title}</h4>${metric.note ? `<p class="deni-offense__metric-note">${metric.note}</p>` : ""}</div>`;
      this.plot.appendChild(panel);
      const width = Math.max(240, Math.floor(panel.getBoundingClientRect().width));
      const height = 190;
      const margin = { top: 28, right: 12, bottom: 48, left: 34 };
      const x = d3.scalePoint(SEASONS, [margin.left, width - margin.right]).padding(0.32);
      const y = d3.scaleLinear(metric.domain, [height - margin.bottom, margin.top]);
      const svg = d3.select(panel).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-labelledby", `${headingId} ${descId}`);
      svg.append("desc").attr("id", descId).text(`Deni Avdija's ${metric.title.toLowerCase()} across 2023-24 Washington, 2024-25 Portland and 2025-26 Portland. Every value is directly labeled.`);
      const transitionX = (x("2023-24") + x("2024-25")) / 2;
      svg.append("rect").attr("class", "deni-offense__portland-band").attr("x", transitionX).attr("y", 6).attr("width", width - margin.right - transitionX).attr("height", height - 12).attr("rx", 5);
      svg.append("line").attr("class", "deni-offense__transition").attr("x1", transitionX).attr("x2", transitionX).attr("y1", 9).attr("y2", height - 12);
      svg.append("g").selectAll("line").data(metric.ticks).join("line").attr("class", "deni-offense__grid")
        .attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y).attr("y2", y);
      svg.append("g").selectAll("text").data(metric.ticks).join("text").attr("class", "deni-offense__tick")
        .attr("x", margin.left - 6).attr("y", (tick) => y(tick) + 3).attr("text-anchor", "end").text(metric.format);
      svg.append("path").datum(this.rows).attr("class", "deni-offense__line")
        .attr("d", d3.line().x((row) => x(row.season)).y((row) => y(row[metric.key])));
      const marks = svg.append("g").selectAll("g").data(this.rows).join("g")
        .attr("transform", (row) => `translate(${x(row.season)},${y(row[metric.key])})`);
      marks.append((row) => document.createElementNS("http://www.w3.org/2000/svg", row.season === "2025-26" ? "rect" : "circle"))
        .attr("class", (row) => `deni-offense__point${row.season === "2025-26" ? " is-latest" : ""}`)
        .attr("x", (row) => row.season === "2025-26" ? -6 : null).attr("y", (row) => row.season === "2025-26" ? -6 : null)
        .attr("width", (row) => row.season === "2025-26" ? 12 : null).attr("height", (row) => row.season === "2025-26" ? 12 : null)
        .attr("rx", (row) => row.season === "2025-26" ? 2 : null).attr("r", (row) => row.season === "2025-26" ? null : 5.5)
        .append("title").text((row) => `${displaySeason(row.season)} ${row.team}: ${metric.format(row[metric.key])}; ${row.games} games, ${row.mpg.toFixed(1)} MPG.`);
      marks.append("text").attr("class", "deni-offense__value").attr("text-anchor", "middle").attr("y", -13).text((row) => metric.format(row[metric.key]));
      const labels = svg.append("g").selectAll("g").data(this.rows).join("g")
        .attr("transform", (row) => `translate(${x(row.season)},${height - margin.bottom + 17})`);
      labels.append("text").attr("class", "deni-offense__season").attr("text-anchor", "middle").text((row) => displaySeason(row.season));
      labels.append("text").attr("class", "deni-offense__team").attr("text-anchor", "middle").attr("y", 14).text((row) => row.team);
    }
    renderSupport() {
      const support = this.root.querySelector(".deni-offense__support");
      support.replaceChildren(...this.rows.map((row) => {
        const item = document.createElement("div");
        item.className = `deni-offense__support-item${row.season === "2025-26" ? " is-latest" : ""}`;
        item.innerHTML = `<span class="deni-offense__support-season">${displaySeason(row.season)} · ${row.team}</span><span class="deni-offense__support-values"><strong>${fractionalPercent(row.trueShooting)} TS</strong> · ${row.games} games · ${row.mpg.toFixed(1)} MPG</span>`;
        return item;
      }));
    }
  }

  function mount(root) {
    if (!d3) {
      root.querySelector(".portland-chart__status").textContent = "This chart could not load. The complete values remain available in the table below.";
      return;
    }
    if (root.matches("[data-clingan-centers-chart]") && !root.portlandChart) root.portlandChart = new ClinganCentersChart(root);
    if (root.matches("[data-deni-offense-chart]") && !root.portlandChart) root.portlandChart = new DeniOffenseChart(root);
    root.dataset.portlandInitialized = "true";
    root.portlandChart.load();
  }

  document.querySelectorAll("[data-clingan-centers-chart], [data-deni-offense-chart]").forEach((root) => {
    const card = root.closest("details");
    const loadWhenVisible = () => { if (!card || card.open) requestAnimationFrame(() => mount(root)); };
    card?.addEventListener("toggle", loadWhenVisible);
    loadWhenVisible();
  });
  window.validatePortlandCenters = validateCenters;
  window.validatePortlandDeni = validateDeni;
})();
