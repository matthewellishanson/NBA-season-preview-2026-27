(function initializeMpjBrooklynComparison() {
  "use strict";

  const d3 = window.d3;
  const SEASON_ORDER = ["2024-25", "2025-26"];
  const ROLE_METRICS = [
    { key: "pointsPer100", label: "Points per 100 possessions", short: "PTS/100", min: 20, max: 40, format: decimal },
    { key: "usage", label: "Usage rate", short: "USG%", min: 15, max: 35, format: percentPoints },
    { key: "assistsPer100", label: "Assists per 100 possessions", short: "AST/100", min: 0, max: 6, format: decimal },
    { key: "turnoversPer100", label: "Turnovers per 100 possessions", short: "TOV/100", min: 0, max: 5, format: decimal },
    { key: "trueShooting", label: "True shooting percentage", short: "TS%", min: 0.55, max: 0.65, format: fractionPercent },
  ];
  const ASSISTED_METRICS = [
    { key: "madeTwosAssisted", label: "Made two-pointers assisted", short: "Made 2P assisted", min: 0.5, max: 1, format: fractionPercent },
    { key: "madeThreesAssisted", label: "Made three-pointers assisted", short: "Made 3P assisted", min: 0.5, max: 1, format: fractionPercent },
  ];
  const EXPECTED = {
    "2024-25": ["DEN", 77, 33.7, 25.9, 20.2, 3.1, 1.9, 0.617, 0.740, 0.922],
    "2025-26": ["BRK", 52, 32.5, 36.9, 30.5, 4.6, 3.6, 0.595, 0.653, 0.858],
  };

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
      season: text(row, "season"),
      team: text(row, "team"),
      teamName: text(row, "team_name"),
      games: number(row, "games"),
      minutesPerGame: number(row, "minutes_per_game"),
      pointsPer100: number(row, "points_per_100"),
      usage: number(row, "usage_pct"),
      assistsPer100: number(row, "assists_per_100"),
      turnoversPer100: number(row, "turnovers_per_100"),
      trueShooting: number(row, "true_shooting_pct"),
      madeTwosAssisted: number(row, "made_twos_assisted_pct"),
      madeThreesAssisted: number(row, "made_threes_assisted_pct"),
    };
  }

  function decimal(value) { return value.toFixed(1); }
  function percentPoints(value) { return `${value.toFixed(1)}%`; }
  function fractionPercent(value) { return `${(value * 100).toFixed(1)}%`; }
  function nearlyEqual(left, right) { return Math.abs(left - right) < 1e-9; }

  function validateRows(rows) {
    if (rows.length !== 2) throw new Error(`Expected two MPJ season rows, found ${rows.length}.`);
    rows.forEach((row, index) => {
      const season = SEASON_ORDER[index];
      const expected = EXPECTED[season];
      const actual = [row.team, row.games, row.minutesPerGame, row.pointsPer100, row.usage, row.assistsPer100, row.turnoversPer100, row.trueShooting, row.madeTwosAssisted, row.madeThreesAssisted];
      if (row.season !== season) throw new Error(`Unexpected season order: ${row.season}.`);
      expected.forEach((value, valueIndex) => {
        const matches = typeof value === "number" ? nearlyEqual(actual[valueIndex], value) : actual[valueIndex] === value;
        if (!matches) throw new Error(`${season}: displayed-value validation failed.`);
      });
      [row.trueShooting, row.madeTwosAssisted, row.madeThreesAssisted].forEach((value) => {
        if (value < 0 || value > 1) throw new Error(`${season}: fractional percentage outside [0, 1].`);
      });
    });
  }

  function position(value, metric) {
    return Math.max(0, Math.min(100, ((value - metric.min) / (metric.max - metric.min)) * 100));
  }

  function metricCard(metric, denver, brooklyn, assisted = false) {
    const denverValue = metric.format(denver[metric.key]);
    const brooklynValue = metric.format(brooklyn[metric.key]);
    const denverPosition = position(denver[metric.key], metric);
    const brooklynPosition = position(brooklyn[metric.key], metric);
    return `<article class="mpj-shift__metric${assisted ? " mpj-shift__metric--assisted" : ""}" data-metric="${escapeHtml(metric.key)}">
      <header><h5>${escapeHtml(metric.label)}</h5><p><span>DEN <b>${escapeHtml(denverValue)}</b></span><i aria-hidden="true">&rarr;</i><span>BRK <b>${escapeHtml(brooklynValue)}</b></span></p></header>
      <div class="mpj-shift__track" style="--mpj-denver:${denverPosition.toFixed(3)}%;--mpj-brooklyn:${brooklynPosition.toFixed(3)}%;--mpj-left:${Math.min(denverPosition, brooklynPosition).toFixed(3)}%;--mpj-width:${Math.abs(brooklynPosition - denverPosition).toFixed(3)}%" aria-hidden="true">
        <span class="mpj-shift__connector"></span><i class="mpj-shift__mark mpj-shift__mark--denver"></i><i class="mpj-shift__mark mpj-shift__mark--brooklyn"></i>
      </div>
      <div class="mpj-shift__scale" aria-hidden="true"><span>${escapeHtml(metric.format(metric.min))}</span><span>${escapeHtml(metric.format(metric.max))}</span></div>
      <span class="mpj-shift__visually-hidden">${escapeHtml(metric.label)}: Denver ${escapeHtml(denverValue)}; Brooklyn ${escapeHtml(brooklynValue)}.</span>
    </article>`;
  }

  function renderTable(root, rows) {
    const body = rows.map((row) => `<tr>
      <th scope="row">${escapeHtml(row.season)}</th><td>${escapeHtml(row.team)}</td><td>${row.games}</td><td>${decimal(row.minutesPerGame)}</td>
      <td>${decimal(row.pointsPer100)}</td><td>${percentPoints(row.usage)}</td><td>${decimal(row.assistsPer100)}</td><td>${decimal(row.turnoversPer100)}</td>
      <td>${fractionPercent(row.trueShooting)}</td><td>${fractionPercent(row.madeTwosAssisted)}</td><td>${fractionPercent(row.madeThreesAssisted)}</td>
    </tr>`).join("");
    root.querySelector(".mpj-shift__table-wrap").innerHTML = `<table class="team-graphic__table mpj-shift__table">
      <caption>Michael Porter Jr.'s final Denver season and first Brooklyn season.</caption>
      <thead><tr><th scope="col">Season</th><th scope="col">Team</th><th scope="col">G</th><th scope="col">MPG</th><th scope="col">PTS/100</th><th scope="col">USG%</th><th scope="col">AST/100</th><th scope="col">TOV/100</th><th scope="col">TS%</th><th scope="col">Made 2P ast.</th><th scope="col">Made 3P ast.</th></tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function render(root, rows) {
    validateRows(rows);
    const [denver, brooklyn] = rows;
    root.querySelector(".mpj-shift__status")?.remove();
    root.querySelector(".mpj-shift__role-grid").innerHTML = ROLE_METRICS.map((metric) => metricCard(metric, denver, brooklyn)).join("");
    root.querySelector(".mpj-shift__assisted-grid").innerHTML = ASSISTED_METRICS.map((metric) => metricCard(metric, denver, brooklyn, true)).join("");
    root.querySelector(".mpj-shift__season-context").innerHTML = rows.map((row) => `<p class="mpj-shift__season mpj-shift__season--${row.team.toLowerCase()}"><i aria-hidden="true"></i><strong>${escapeHtml(row.season)} ${escapeHtml(row.team)}</strong><span>${row.games} games &middot; ${decimal(row.minutesPerGame)} MPG</span></p>`).join("");
    renderTable(root, rows);
    root.setAttribute("aria-busy", "false");
    root.mpjComparison = { rows, roleMetrics: ROLE_METRICS, assistedMetrics: ASSISTED_METRICS };
  }

  if (!d3) return;
  document.querySelectorAll("[data-mpj-brooklyn-chart]").forEach((root) => {
    d3.csv(root.dataset.source, parseRow)
      .then((rows) => render(root, rows))
      .catch((error) => {
        console.error("MPJ Brooklyn comparison data error:", error);
        root.setAttribute("aria-busy", "false");
        const status = root.querySelector(".mpj-shift__status");
        status.className = "mpj-shift__status mpj-shift__status--error";
        status.textContent = "The Porter comparison could not be displayed. The validated chart-ready CSV remains linked below.";
      });
  });
})();
