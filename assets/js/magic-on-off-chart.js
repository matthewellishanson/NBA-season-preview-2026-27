(function initializeMagicOnOffCharts() {
  "use strict";

  const ORDER = ["both_playing", "banchero_only", "wagner_only", "neither_playing"];
  const EXPECTED_TOTAL_MINUTES = 10797;
  const DOMAIN = 8;
  const numberFormat = new Intl.NumberFormat("en-US");

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function numeric(row, field) {
    if (row[field] === undefined || row[field] === null || row[field].trim() === "") {
      throw new Error(`Missing ${field} for ${row.group_id || "unknown group"}.`);
    }
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field} for ${row.group_id || "unknown group"}.`);
    return value;
  }

  function parseRow(row) {
    return {
      id: row.group_id?.trim() || "",
      label: row.group_label?.trim() || "",
      playersOn: row.players_on?.trim() || "",
      playersOff: row.players_off?.trim() || "",
      minutes: numeric(row, "minutes"),
      net: numeric(row, "net_rating"),
      offense: numeric(row, "offensive_rating"),
      defense: numeric(row, "defensive_rating"),
      twoPoint: numeric(row, "two_point_fg_pct"),
      threePoint: numeric(row, "three_point_fg_pct"),
      opponentTwoPoint: numeric(row, "opponent_two_point_fg_pct"),
      opponentThreePoint: numeric(row, "opponent_three_point_fg_pct"),
      coverage: row.coverage_label?.trim() || "",
      sourceFilename: row.source_filename?.trim() || "",
      sourceRow: numeric(row, "source_row"),
    };
  }

  function validateRows(rows) {
    if (rows.length !== 4) throw new Error(`Expected four lineup groups; found ${rows.length}.`);
    const identities = new Set(rows.map((row) => row.id));
    if (identities.size !== 4 || ORDER.some((identity) => !identities.has(identity))) {
      throw new Error("Lineup groups are incomplete or duplicated.");
    }
    rows.forEach((row) => {
      if (row.minutes <= 0 || !Number.isInteger(row.minutes)) throw new Error(`${row.label} has invalid minutes.`);
      if (Math.abs((row.offense - row.defense) - row.net) > 0.011) {
        throw new Error(`${row.label} does not reconcile OffRtg, DefRtg and NetRtg.`);
      }
      [row.twoPoint, row.threePoint, row.opponentTwoPoint, row.opponentThreePoint].forEach((value) => {
        if (value < 0 || value > 1) throw new Error(`${row.label} has an incorrectly scaled percentage.`);
      });
      if (row.coverage !== "PBP Stats selection beginning in 2022-23") {
        throw new Error(`${row.label} has unexpected coverage metadata.`);
      }
      if (row.sourceFilename !== "Wagner&Paolo_OnOff_Career.csv") {
        throw new Error(`${row.label} has unexpected source provenance.`);
      }
    });
    if (rows.reduce((total, row) => total + row.minutes, 0) !== EXPECTED_TOTAL_MINUTES) {
      throw new Error("Lineup-group minutes do not total 10,797.");
    }
    return ORDER.map((identity) => rows.find((row) => row.id === identity));
  }

  function signed(value) {
    return `${value >= 0 ? "+" : "\u2212"}${Math.abs(value).toFixed(2)}`;
  }

  function percentage(value) {
    return `${(value * 100).toFixed(2)}%`;
  }

  function bar(row) {
    const width = Math.abs(row.net) / DOMAIN * 50;
    const style = row.net >= 0
      ? `left:50%;width:${width}%`
      : `left:${50 - width}%;width:${width}%`;
    return `<div class="magic-on-off__bar-track" aria-hidden="true"><span class="magic-on-off__bar magic-on-off__bar--${row.net >= 0 ? "positive" : "negative"}" style="${style}"></span></div>`;
  }

  function renderChart(root, rows) {
    const plot = root.querySelector(".magic-on-off__plot");
    const tableWrap = root.querySelector(".magic-on-off__table-wrap");
    plot.innerHTML = `
      <div class="magic-on-off__columns" aria-hidden="true">
        <span>Lineup group</span>
        <span class="magic-on-off__scale"><span>\u22128</span><span>0</span><span>+8</span></span>
        <span>Minutes</span><span>OffRtg</span><span>DefRtg</span><span>Net</span>
      </div>
      ${rows.map((row) => `
        <div class="magic-on-off__row${row.net < 0 ? " magic-on-off__row--negative" : ""}">
          <div class="magic-on-off__group">${escapeHtml(row.label)}</div>
          ${bar(row)}
          <div class="magic-on-off__metric magic-on-off__minutes">${numberFormat.format(row.minutes)}</div>
          <div class="magic-on-off__metric magic-on-off__offense">${row.offense.toFixed(2)}</div>
          <div class="magic-on-off__metric magic-on-off__defense">${row.defense.toFixed(2)}</div>
          <div class="magic-on-off__metric magic-on-off__net">${signed(row.net)}</div>
        </div>
      `).join("")}
      <p class="magic-on-off__legend" aria-hidden="true">
        <span><i class="magic-on-off__swatch"></i> Positive net rating</span>
        <span><i class="magic-on-off__swatch magic-on-off__swatch--negative"></i> Negative net rating</span>
        <span>One shared scale: \u22128 to +8</span>
      </p>`;

    tableWrap.innerHTML = `
      <table class="magic-on-off__table">
        <caption>Complete chart-ready table, including all shooting columns from the supplied source.</caption>
        <thead><tr><th scope="col">Group</th><th scope="col">Minutes</th><th scope="col">NetRtg</th><th scope="col">OffRtg</th><th scope="col">DefRtg</th><th scope="col">2PT%</th><th scope="col">3PT%</th><th scope="col">Opp. 2PT%</th><th scope="col">Opp. 3PT%</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${numberFormat.format(row.minutes)}</td><td>${signed(row.net)}</td><td>${row.offense.toFixed(2)}</td><td>${row.defense.toFixed(2)}</td><td>${percentage(row.twoPoint)}</td><td>${percentage(row.threePoint)}</td><td>${percentage(row.opponentTwoPoint)}</td><td>${percentage(row.opponentThreePoint)}</td></tr>`).join("")}</tbody>
      </table>`;
    root.removeAttribute("aria-busy");
    root.dataset.chartMounted = "true";
  }

  function showError(root, error) {
    root.removeAttribute("aria-busy");
    root.dataset.chartMounted = "error";
    root.querySelector(".magic-on-off__plot").innerHTML = '<p class="magic-on-off__status magic-on-off__status--error">The Orlando on/off chart could not be displayed. The validated CSV remains available below.</p>';
    console.error("Orlando on/off chart could not load:", error);
  }

  async function loadChart(root) {
    if (["loading", "true"].includes(root.dataset.chartMounted)) return;
    root.dataset.chartMounted = "loading";
    try {
      const response = await fetch(root.dataset.source, { cache: "no-store" });
      if (!response.ok) throw new Error(`On/off data request returned ${response.status}.`);
      const rows = validateRows(window.d3.csvParse(await response.text()).map(parseRow));
      renderChart(root, rows);
    } catch (error) {
      showError(root, error);
    }
  }

  document.querySelectorAll("[data-magic-on-off-chart]").forEach((root) => {
    if (!window.d3) {
      showError(root, new Error("D3 is unavailable."));
      return;
    }
    const card = root.closest("details");
    const loadWhenVisible = () => {
      if (!card || card.open) requestAnimationFrame(() => loadChart(root));
    };
    card?.addEventListener("toggle", loadWhenVisible);
    loadWhenVisible();
  });

  window.validateMagicOnOffRows = validateRows;
})();
