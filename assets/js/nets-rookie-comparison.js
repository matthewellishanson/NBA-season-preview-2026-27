(function initializeNetsRookieComparison() {
  "use strict";

  const d3 = window.d3;
  const PLAYER_ORDER = ["wolfda01", "demineg01", "traorno01", "sarafbe01", "poweldr01"];
  const EXPECTED = {
    wolfda01: ["Danny Wolf", 57, 20.8, 21.2, 5.3, 0.521],
    demineg01: ["Egor Demin", 52, 25.2, 20.3, 6.5, 0.561],
    traorno01: ["Nolan Traore", 56, 22.2, 19.9, 8.5, 0.479],
    sarafbe01: ["Ben Saraf", 44, 20.8, 17.9, 7.8, 0.486],
    poweldr01: ["Drake Powell", 63, 21.0, 15.3, 3.4, 0.521],
  };
  const EXPECTED_MEDIAN = [57, 20.3, 17.9, 4.05, 0.548];
  const METRICS = [
    { key: "minutesPerGame", label: "Minutes/game", short: "MPG", min: 0, max: 36, format: oneDecimal },
    { key: "pointsPer100", label: "Points/100 poss.", short: "PTS/100", min: 0, max: 30, format: oneDecimal },
    { key: "assistsPer100", label: "Assists/100 poss.", short: "AST/100", min: 0, max: 10, format: oneDecimal },
    { key: "trueShooting", label: "True shooting", short: "TS%", min: 0.4, max: 0.65, format: percent, mark: "dot" },
  ];

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
      recordType: text(row, "record_type"),
      playerId: text(row, "player_id"),
      playerName: text(row, "player_name"),
      season: text(row, "season"),
      team: row.team?.trim() || "",
      games: number(row, "games"),
      minutesPerGame: number(row, "minutes_per_game"),
      pointsPer100: number(row, "points_per_100"),
      assistsPer100: number(row, "assists_per_100"),
      trueShooting: number(row, "true_shooting_pct"),
      turnoversPer100: number(row, "turnovers_per_100"),
      usage: number(row, "usage_pct"),
      benchmarkPopulation: row.benchmark_population?.trim() || "",
    };
  }

  function oneDecimal(value) {
    return (Math.round((value + Number.EPSILON) * 10) / 10).toFixed(1);
  }

  function percent(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function nearlyEqual(left, right) {
    return Math.abs(left - right) < 1e-9;
  }

  function validateRows(rows) {
    if (rows.length !== 6) throw new Error(`Expected six chart rows, found ${rows.length}.`);
    const players = rows.filter((row) => row.recordType === "featured_player");
    const benchmarks = rows.filter((row) => row.recordType === "benchmark_median");
    if (players.length !== 5 || benchmarks.length !== 1) {
      throw new Error("Expected five featured players and one benchmark median.");
    }
    players.forEach((row, index) => {
      const playerId = PLAYER_ORDER[index];
      const expected = EXPECTED[playerId];
      const actual = [row.playerName, row.games, row.minutesPerGame, row.pointsPer100, row.assistsPer100, row.trueShooting];
      if (row.playerId !== playerId || row.season !== "2025-26" || row.team !== "BRK") {
        throw new Error(`${row.playerName}: unexpected identity, season, or team.`);
      }
      expected.forEach((value, valueIndex) => {
        const matches = typeof value === "number" ? nearlyEqual(actual[valueIndex], value) : actual[valueIndex] === value;
        if (!matches) throw new Error(`${row.playerName}: source-value check failed.`);
      });
      if (row.games < 15 || row.minutesPerGame < 10 || row.trueShooting < 0 || row.trueShooting > 1) {
        throw new Error(`${row.playerName}: invalid qualification or percentage units.`);
      }
    });
    const benchmark = benchmarks[0];
    [benchmark.games, benchmark.minutesPerGame, benchmark.pointsPer100, benchmark.assistsPer100, benchmark.trueShooting]
      .forEach((value, index) => {
        if (!nearlyEqual(value, EXPECTED_MEDIAN[index])) throw new Error("Benchmark median check failed.");
      });
    if (!benchmark.benchmarkPopulation.startsWith("Median of 138 qualified rookie player-seasons")) {
      throw new Error("Benchmark population label is missing or imprecise.");
    }
  }

  function position(value, metric) {
    const ratio = (value - metric.min) / (metric.max - metric.min);
    return Math.max(0, Math.min(100, ratio * 100));
  }

  function metricCell(row, benchmark, metric) {
    const value = metric.format(row[metric.key]);
    const benchmarkValue = metric.format(benchmark[metric.key]);
    return `<div class="nets-rookies__metric${metric.mark === "dot" ? " nets-rookies__metric--dot" : ""}" data-metric="${escapeHtml(metric.key)}">
      <div class="nets-rookies__metric-heading"><span>${escapeHtml(metric.short)}</span><strong>${escapeHtml(value)}</strong></div>
      <div class="nets-rookies__track" style="--nets-value:${position(row[metric.key], metric).toFixed(3)}%;--nets-median:${position(benchmark[metric.key], metric).toFixed(3)}%" aria-hidden="true">
        ${metric.mark === "dot" ? '<span class="nets-rookies__dot"></span>' : '<span class="nets-rookies__bar"></span>'}<i class="nets-rookies__median"></i>
      </div>
      <span class="nets-rookies__scale" aria-hidden="true"><i>${escapeHtml(metric.format(metric.min))}</i><i>${escapeHtml(metric.format(metric.max))}</i></span>
      <span class="nets-rookies__visually-hidden">${escapeHtml(metric.label)}: ${escapeHtml(value)}. Qualified rookie median: ${escapeHtml(benchmarkValue)}.</span>
    </div>`;
  }

  function renderTable(root, players, benchmark) {
    const tableWrap = root.querySelector(".nets-rookies__table-wrap");
    const tableRows = [...players, benchmark].map((row) => {
      const isBenchmark = row.recordType === "benchmark_median";
      return `<tr class="${isBenchmark ? "nets-rookies__table-benchmark" : ""}">
        <th scope="row">${escapeHtml(row.playerName)}</th>
        <td>${escapeHtml(isBenchmark ? "3-season pool" : "2025-26")}</td>
        <td>${row.games.toFixed(0)}</td>
        <td>${oneDecimal(row.minutesPerGame)}</td>
        <td>${oneDecimal(row.pointsPer100)}</td>
        <td>${oneDecimal(row.assistsPer100)}</td>
        <td>${percent(row.trueShooting)}</td>
      </tr>`;
    }).join("");
    tableWrap.innerHTML = `<table class="team-graphic__table nets-rookies__table">
      <caption>Brooklyn's five 2025-26 rookies and the median of 138 qualified rookie player-seasons.</caption>
      <thead><tr><th scope="col">Player or benchmark</th><th scope="col">Season</th><th scope="col">G</th><th scope="col">MPG</th><th scope="col">PTS/100</th><th scope="col">AST/100</th><th scope="col">TS%</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
  }

  function render(root, rows) {
    validateRows(rows);
    const players = rows.filter((row) => row.recordType === "featured_player");
    const benchmark = rows.find((row) => row.recordType === "benchmark_median");
    const plot = root.querySelector(".nets-rookies__plot");
    const playerRows = players.map((row) => `<article class="nets-rookies__row" role="listitem" aria-label="${escapeHtml(row.playerName)}: ${row.games.toFixed(0)} games, ${oneDecimal(row.minutesPerGame)} minutes per game, ${oneDecimal(row.pointsPer100)} points and ${oneDecimal(row.assistsPer100)} assists per 100 possessions, ${percent(row.trueShooting)} true shooting.">
      <div class="nets-rookies__player"><strong>${escapeHtml(row.playerName)}</strong><span>${row.games.toFixed(0)} games</span></div>
      ${METRICS.map((metric) => metricCell(row, benchmark, metric)).join("")}
    </article>`).join("");
    plot.innerHTML = `<div class="nets-rookies__column-headings" aria-hidden="true">
      <span>Player <i>Games</i></span>
      ${METRICS.map((metric) => `<span>${escapeHtml(metric.label)}</span>`).join("")}
    </div>
    <div class="nets-rookies__rows" role="list">${playerRows}</div>
    <div class="nets-rookies__benchmark" aria-label="Median benchmark values">
      <strong>138-season median &middot; ${benchmark.games.toFixed(0)} G</strong>
      <span>${oneDecimal(benchmark.minutesPerGame)} MPG</span>
      <span>${oneDecimal(benchmark.pointsPer100)} PTS/100</span>
      <span>${oneDecimal(benchmark.assistsPer100)} AST/100</span>
      <span>${percent(benchmark.trueShooting)} TS</span>
    </div>`;
    renderTable(root, players, benchmark);
    root.setAttribute("aria-busy", "false");
    root.netsRookieComparison = { rows, players, benchmark, metrics: METRICS };
  }

  if (!d3) {
    document.querySelectorAll("[data-nets-rookie-chart]").forEach((root) => {
      root.setAttribute("aria-busy", "false");
      const status = root.querySelector(".nets-rookies__status");
      if (status) status.textContent = "The rookie comparison could not load because its chart dependency is unavailable.";
    });
    return;
  }

  document.querySelectorAll("[data-nets-rookie-chart]").forEach((root) => {
    root.setAttribute("aria-busy", "true");
    d3.csv(root.dataset.source, parseRow)
      .then((rows) => render(root, rows))
      .catch((error) => {
        console.error("Nets rookie comparison data error:", error);
        root.setAttribute("aria-busy", "false");
        const status = root.querySelector(".nets-rookies__status");
        status.className = "nets-rookies__status nets-rookies__status--error";
        status.textContent = "The rookie comparison could not be displayed. The validated chart-ready CSV remains available below.";
      });
  });
})();
