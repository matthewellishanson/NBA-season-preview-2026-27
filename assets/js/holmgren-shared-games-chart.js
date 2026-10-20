(function initializeHolmgrenSharedGamesCharts() {
  "use strict";

  const d3 = window.d3;
  const SAMPLE_ORDER = [
    "all_2025_26_regular_season",
    "career_shared_regular_season",
    "supplied_shared_postseason",
  ];
  const EXPECTED = new Map([
    ["all_2025_26_regular_season", [69, 28.9, 1994.1, 21.30, 11.09, 0.6525]],
    ["career_shared_regular_season", [8, 29.3, 234.4, 16.96, 9.22, 0.6104]],
    ["supplied_shared_postseason", [7, 29.9, 209.3, 12.88, 8.55, 0.5992]],
  ]);
  const SAMPLE_META = {
    all_2025_26_regular_season: {
      short: "2025–26 all",
      title: "2025–26 full regular season",
      detail: "Full-season context; includes any qualifying shared games",
      mark: "season",
    },
    career_shared_regular_season: {
      short: "Shared RS",
      title: "Shared regular-season games",
      detail: "Career aggregate; seasons unspecified",
      mark: "shared-regular",
    },
    supplied_shared_postseason: {
      short: "Shared PO",
      title: "Shared postseason games",
      detail: "Supplied aggregate; season unspecified; no other-opponents baseline",
      mark: "postseason",
    },
  };
  const METRICS = [
    {
      key: "pointsPer36",
      title: "Points per 36 minutes",
      short: "PTS/36",
      domain: [0, 26],
      ticks: [0, 6, 12, 18, 24],
      format: (value) => value.toFixed(1),
      axisFormat: (value) => String(value),
    },
    {
      key: "reboundsPer36",
      title: "Rebounds per 36 minutes",
      short: "REB/36",
      domain: [0, 14],
      ticks: [0, 4, 8, 12],
      format: (value) => value.toFixed(1),
      axisFormat: (value) => String(value),
    },
    {
      key: "trueShooting",
      title: "True shooting percentage",
      short: "TS%",
      domain: [0, 0.75],
      ticks: [0, 0.2, 0.4, 0.6],
      format: (value) => `${(value * 100).toFixed(1)}%`,
      axisFormat: (value) => `${Math.round(value * 100)}%`,
    },
  ];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function numeric(row, field) {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function parseRow(row) {
    return {
      sampleId: row.sample_id?.trim() || "",
      playerId: row.player_id?.trim() || "",
      playerName: row.player_name?.trim() || "",
      seasonType: row.season_type?.trim() || "",
      coverageLabel: row.coverage_label?.trim() || "",
      populationLabel: row.population_label?.trim() || "",
      comparisonStatus: row.comparison_status?.trim() || "",
      games: numeric(row, "games"),
      minutesPerGame: numeric(row, "minutes_per_game"),
      approxTotalMinutes: numeric(row, "approx_total_minutes"),
      pointsPerGame: numeric(row, "points_per_game"),
      fieldGoalAttemptsPerGame: numeric(row, "field_goal_attempts_per_game"),
      freeThrowAttemptsPerGame: numeric(row, "free_throw_attempts_per_game"),
      reboundsPerGame: numeric(row, "rebounds_per_game"),
      pointsPer36: numeric(row, "points_per_36"),
      reboundsPer36: numeric(row, "rebounds_per_36"),
      trueShooting: numeric(row, "true_shooting_pct"),
      sourceFilename: row.source_filename?.trim() || "",
      sourceRowIdentifier: row.source_row_identifier?.trim() || "",
      reconstructed: row.values_reconstructed_from_rounded_per_game_averages === "true",
    };
  }

  function validateRows(rows) {
    if (rows.length !== 3) throw new Error(`Expected three normalized sample rows, found ${rows.length}.`);
    const identities = new Set(rows.map((row) => row.sampleId));
    if (identities.size !== 3 || SAMPLE_ORDER.some((id) => !identities.has(id))) {
      throw new Error("The normalized sample coverage is incomplete or duplicated.");
    }
    rows.forEach((row) => {
      if (row.playerId !== "holmgch01" || row.playerName !== "Chet Holmgren") {
        throw new Error(`${row.sampleId} has an unexpected player identity.`);
      }
      if (!row.sourceFilename || !row.sourceRowIdentifier || !row.reconstructed) {
        throw new Error(`${row.sampleId} is missing provenance or its rounding flag.`);
      }
      const actual = [row.games, row.minutesPerGame, row.approxTotalMinutes, row.pointsPer36, row.reboundsPer36, row.trueShooting];
      const expected = EXPECTED.get(row.sampleId);
      actual.forEach((value, index) => {
        if (Math.abs(value - expected[index]) > 0.0001) {
          throw new Error(`${row.sampleId} conflicts with the verified processed values.`);
        }
      });
      const recalculatedTs = row.pointsPerGame /
        (2 * (row.fieldGoalAttemptsPerGame + 0.44 * row.freeThrowAttemptsPerGame));
      if (Math.abs(recalculatedTs - row.trueShooting) > 0.0001) {
        throw new Error(`${row.sampleId} has an inconsistent true-shooting denominator.`);
      }
    });
  }

  function sampleAria(row, metric) {
    const meta = SAMPLE_META[row.sampleId];
    return `${meta.title}: ${metric.title} ${metric.format(row[metric.key])}; ${row.games} games; approximately ${Math.round(row.approxTotalMinutes).toLocaleString("en-US")} total minutes; ${row.minutesPerGame.toFixed(1)} minutes per game. ${meta.detail}.`;
  }

  class HolmgrenSharedGamesChart {
    constructor(root) {
      this.root = root;
      this.rows = [];
      this.byId = new Map();
      this.loadPromise = null;
      this.lastWidth = 0;
      this.renderQueued = false;
      this.plot = root.querySelector(".holmgren-chart__plot");
      this.status = root.querySelector(".holmgren-chart__status");
      this.samples = root.querySelector(".holmgren-chart__samples");
      this.tableBody = root.querySelector(".holmgren-chart__table-body");
      this.resizeObserver = new ResizeObserver(() => this.queueRender());
      this.resizeObserver.observe(this.plot);
    }

    load() {
      if (this.loadPromise) return this.loadPromise;
      this.root.setAttribute("aria-busy", "true");
      this.loadPromise = d3.csv(this.root.dataset.source, parseRow)
        .then((rows) => {
          validateRows(rows);
          this.rows = SAMPLE_ORDER.map((id) => rows.find((row) => row.sampleId === id));
          this.byId = new Map(this.rows.map((row) => [row.sampleId, row]));
          this.root.setAttribute("aria-busy", "false");
          this.renderSamples();
          this.renderTable();
          this.render(true);
        })
        .catch((error) => {
          console.error("Holmgren shared-games chart data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "holmgren-chart__status holmgren-chart__status--error";
          this.status.textContent = "Holmgren's supplied-sample profile could not be displayed. The validated processed CSV remains available.";
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

    renderSamples() {
      this.samples.innerHTML = this.rows.map((row) => {
        const meta = SAMPLE_META[row.sampleId];
        return `<article class="holmgren-chart__sample holmgren-chart__sample--${escapeHtml(meta.mark)}">
          <p><i aria-hidden="true"></i><strong>${escapeHtml(meta.title)}</strong></p>
          <span>${row.games} games &middot; &asymp;${Math.round(row.approxTotalMinutes).toLocaleString("en-US")} minutes &middot; ${row.minutesPerGame.toFixed(1)} MPG</span>
          <small>${escapeHtml(meta.detail)}</small>
        </article>`;
      }).join("");
    }

    renderTable() {
      this.tableBody.innerHTML = this.rows.map((row) => {
        const meta = SAMPLE_META[row.sampleId];
        const cells = [
          ["Sample", meta.title],
          ["Coverage", row.coverageLabel],
          ["Games", row.games],
          ["Approx. minutes", `≈${row.approxTotalMinutes.toFixed(1)}`],
          ["Minutes/game", row.minutesPerGame.toFixed(1)],
          ["Points/36", row.pointsPer36.toFixed(1)],
          ["Rebounds/36", row.reboundsPer36.toFixed(1)],
          ["True shooting", `${(row.trueShooting * 100).toFixed(1)}%`],
        ];
        return `<tr class="holmgren-chart__table-row">${cells.map(([label, value], index) => {
          const tag = index === 0 ? "th" : "td";
          const scope = index === 0 ? ' scope="row"' : "";
          return `<${tag}${scope} data-label="${escapeHtml(label)}">${escapeHtml(value)}</${tag}>`;
        }).join("")}</tr>`;
      }).join("");
    }

    render(force = false) {
      if (!this.rows.length) return;
      const plotWidth = Math.floor(this.plot.getBoundingClientRect().width);
      if (!force && (plotWidth <= 0 || Math.abs(plotWidth - this.lastWidth) < 2)) return;
      if (plotWidth <= 0) return;
      this.lastWidth = plotWidth;
      this.plot.innerHTML = "";

      METRICS.forEach((metric) => {
        const panel = document.createElement("section");
        panel.className = "holmgren-chart__panel";
        panel.innerHTML = `<h4>${escapeHtml(metric.title)}</h4><p>${escapeHtml(metric.short)} &middot; separate scale</p>`;
        this.plot.append(panel);
        this.renderPanel(panel, metric);
      });
    }

    renderPanel(panel, metric) {
      const styles = getComputedStyle(this.root);
      const colors = {
        ink: styles.getPropertyValue("--team-ink").trim() || "#005c91",
        secondary: styles.getPropertyValue("--team-secondary").trim() || "#ef3b24",
        comparison: styles.getPropertyValue("--team-comparison").trim() || "#565b65",
        plot: styles.getPropertyValue("--team-plot").trim() || "#fff",
      };
      const width = Math.max(250, Math.floor(panel.getBoundingClientRect().width) - 18);
      const height = 215;
      const margin = { top: 14, right: 44, bottom: 31, left: 92 };
      const x = d3.scaleLinear().domain(metric.domain).range([margin.left, width - margin.right]);
      const y = d3.scaleBand().domain(SAMPLE_ORDER).range([margin.top, height - margin.bottom]).padding(0.4);
      const svg = d3.select(panel).append("svg")
        .attr("class", "holmgren-chart__svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", `${metric.title} across three supplied samples. The samples have incompatible coverage windows and are not a same-season comparison.`);

      svg.append("g")
        .attr("class", "holmgren-chart__grid")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues(metric.ticks).tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));
      svg.append("g")
        .attr("class", "holmgren-chart__axis holmgren-chart__axis--x")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues(metric.ticks).tickFormat(metric.axisFormat).tickSizeOuter(0));
      svg.append("g")
        .attr("class", "holmgren-chart__axis holmgren-chart__axis--y")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).tickFormat((id) => SAMPLE_META[id].short).tickSize(0).tickPadding(8));

      const rows = svg.selectAll(".holmgren-chart__row")
        .data(this.rows)
        .join("g")
        .attr("class", (row) => `holmgren-chart__row holmgren-chart__row--${SAMPLE_META[row.sampleId].mark}`)
        .attr("tabindex", 0)
        .attr("role", "img")
        .attr("aria-label", (row) => sampleAria(row, metric));

      rows.append("line")
        .attr("class", "holmgren-chart__stem")
        .attr("x1", x(0))
        .attr("x2", (row) => x(row[metric.key]))
        .attr("y1", (row) => y(row.sampleId) + y.bandwidth() / 2)
        .attr("y2", (row) => y(row.sampleId) + y.bandwidth() / 2);

      rows.filter((row) => row.sampleId !== "supplied_shared_postseason")
        .append("circle")
        .attr("class", "holmgren-chart__mark")
        .attr("cx", (row) => x(row[metric.key]))
        .attr("cy", (row) => y(row.sampleId) + y.bandwidth() / 2)
        .attr("r", 6)
        .attr("fill", (row) => row.sampleId === "all_2025_26_regular_season" ? colors.ink : colors.plot)
        .attr("stroke", (row) => row.sampleId === "all_2025_26_regular_season" ? colors.ink : colors.comparison);

      rows.filter((row) => row.sampleId === "supplied_shared_postseason")
        .append("path")
        .attr("class", "holmgren-chart__mark")
        .attr("d", d3.symbol().type(d3.symbolSquare).size(122))
        .attr("transform", (row) => `translate(${x(row[metric.key])},${y(row.sampleId) + y.bandwidth() / 2})`)
        .attr("fill", colors.secondary)
        .attr("stroke", colors.secondary);

      rows.append("text")
        .attr("class", "holmgren-chart__value")
        .attr("x", (row) => x(row[metric.key]) + 9)
        .attr("y", (row) => y(row.sampleId) + y.bandwidth() / 2 + 3.5)
        .text((row) => metric.format(row[metric.key]));
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-holmgren-shared-games-chart]");
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".holmgren-chart__status");
        status.className = "holmgren-chart__status holmgren-chart__status--error";
        status.textContent = "The chart library could not be loaded. The normalized CSV remains available.";
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.holmgrenInitialized === "true") return;
      root.dataset.holmgrenInitialized = "true";
      const chart = new HolmgrenSharedGamesChart(root);
      root.holmgrenSharedGamesChart = chart;
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
