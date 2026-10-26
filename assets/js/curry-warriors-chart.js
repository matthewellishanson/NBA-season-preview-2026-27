(function initializeCurryWarriorsCharts() {
  const REQUIRED_FIELDS = [
    "season", "observation_status", "on_minutes", "off_minutes", "on_ortg",
    "off_ortg", "on_drtg", "off_drtg", "league_ortg", "on_relative_ortg",
    "off_relative_ortg", "offensive_on_off_gap",
  ];
  const EXPECTED_SEASONS = [
    "2015-16", "2016-17", "2017-18", "2018-19", "2019-20", "2020-21",
    "2021-22", "2022-23", "2023-24", "2024-25", "2025-26",
  ];
  const numberFormat = new Intl.NumberFormat("en-US");

  function requiredNumber(row, field) {
    if (row[field] === "" || row[field] == null) throw new Error(`${row.season}: missing ${field}`);
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`${row.season}: invalid ${field}`);
    return value;
  }

  function near(left, right) {
    return Math.abs(left - right) < 0.051;
  }

  function validateRows(rawRows) {
    if (!rawRows.length || REQUIRED_FIELDS.some((field) => !(field in rawRows[0]))) {
      throw new Error("Curry chart data is missing required columns.");
    }
    if (rawRows.length !== EXPECTED_SEASONS.length || rawRows.some((row, index) => row.season !== EXPECTED_SEASONS[index])) {
      throw new Error("Curry chart data must contain the complete chronological 2015-16 to 2025-26 axis.");
    }
    if (rawRows.some((row) => row.season === "2026-27")) throw new Error("Incomplete 2026-27 data must not be charted.");

    const rows = rawRows.map((row) => {
      const observed = row.observation_status === "observed";
      if (!observed) {
        if (row.season !== "2019-20" || row.observation_status !== "ratings_omitted_small_sample") {
          throw new Error(`Unexpected missing observation: ${row.season}`);
        }
        const onMinutes = requiredNumber(row, "on_minutes");
        const leagueOrtg = requiredNumber(row, "league_ortg");
        if (onMinutes !== 139) throw new Error("2019-20 must retain Curry's known 139 on-court minutes.");
        return { ...row, observed: false, on_minutes: onMinutes, league_ortg: leagueOrtg };
      }
      const parsed = { ...row, observed: true };
      ["on_minutes", "off_minutes", "on_ortg", "off_ortg", "on_drtg", "off_drtg", "league_ortg", "on_relative_ortg", "off_relative_ortg", "offensive_on_off_gap"].forEach((field) => {
        parsed[field] = requiredNumber(row, field);
      });
      if (!near(parsed.on_relative_ortg, parsed.on_ortg - parsed.league_ortg)
        || !near(parsed.off_relative_ortg, parsed.off_ortg - parsed.league_ortg)
        || !near(parsed.offensive_on_off_gap, parsed.on_ortg - parsed.off_ortg)) {
        throw new Error(`${row.season}: derived ratings do not match displayed source values.`);
      }
      return parsed;
    });
    if (rows.filter((row) => row.observed).length !== 10) throw new Error("Expected ten observed Curry seasons.");
    return rows;
  }

  function signed(value) {
    if (value > 0) return `+${value.toFixed(1)}`;
    if (value < 0) return `\u2212${Math.abs(value).toFixed(1)}`;
    return "0.0";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function shortSeason(season) {
    return `${season.slice(2, 4)}\u2013${season.slice(5)}`;
  }

  function renderTable(root, rows) {
    const wrap = root.querySelector(".curry-chart__table-wrap");
    wrap.innerHTML = `
      <table class="team-graphic__table curry-chart__table">
        <caption>Golden State team ratings and minutes in Curry's on-court and off-court splits. Relative ratings and the gap are calculated from source values displayed to one decimal.</caption>
        <thead><tr><th scope="col">Season</th><th scope="col">On ORtg</th><th scope="col">Off ORtg</th><th scope="col">NBA ORtg</th><th scope="col">On rel.</th><th scope="col">Off rel.</th><th scope="col">Gap</th><th scope="col">On MIN</th><th scope="col">Off MIN</th></tr></thead>
        <tbody>${rows.map((row) => row.observed ? `
          <tr class="is-ratings-observed${row.season === "2025-26" ? " is-latest" : ""}"><th scope="row">${escapeHtml(row.season)}</th><td>${row.on_ortg.toFixed(1)}</td><td>${row.off_ortg.toFixed(1)}</td><td>${row.league_ortg.toFixed(1)}</td><td>${signed(row.on_relative_ortg)}</td><td>${signed(row.off_relative_ortg)}</td><td>${signed(row.offensive_on_off_gap)}</td><td>${numberFormat.format(row.on_minutes)}</td><td>${numberFormat.format(row.off_minutes)}</td></tr>` : `
          <tr class="is-ratings-omitted"><th scope="row">${escapeHtml(row.season)}</th><td>Omitted &mdash; small sample</td><td>Omitted &mdash; small sample</td><td>${row.league_ortg.toFixed(1)}</td><td>Not calculated</td><td>Not calculated</td><td>Not calculated</td><td>${numberFormat.format(row.on_minutes)}</td><td>Not supplied</td></tr>`).join("")}
        </tbody>
      </table>`;
  }

  function renderChart(root, rows) {
    const plot = root.querySelector(".curry-chart__plot");
    const inspection = root.querySelector(".curry-chart__inspection");
    const bounds = plot.getBoundingClientRect();
    const width = Math.max(300, Math.round(bounds.width));
    const narrow = width < 560;
    const css = getComputedStyle(root);
    const onColor = css.getPropertyValue("--team-secondary").trim() || "#1d428a";
    const offColor = css.getPropertyValue("--team-comparison").trim() || "#565b65";
    const panels = [
      { id: "early", label: "2015\u201316 to 2018\u201319", seasons: EXPECTED_SEASONS.slice(0, 4) },
      { id: "recent", label: "2020\u201321 to 2025\u201326", seasons: EXPECTED_SEASONS.slice(5) },
    ];

    plot.innerHTML = '<div class="curry-chart__panels"></div>';
    const panelGrid = plot.querySelector(".curry-chart__panels");
    if (!narrow) {
      const gutter = 18;
      const horizontalMargins = 76;
      const spacing = (width - gutter - horizontalMargins * 2) / 8;
      panelGrid.style.gridTemplateColumns = `${Math.round(spacing * 3 + horizontalMargins)}px ${Math.round(spacing * 5 + horizontalMargins)}px`;
    }

    panels.forEach((panel) => {
      const panelRows = rows.filter((row) => panel.seasons.includes(row.season));
      const panelNode = document.createElement("section");
      panelNode.className = `curry-chart__panel curry-chart__panel--${panel.id}`;
      panelGrid.append(panelNode);
      const panelWidth = Math.max(260, Math.round(panelNode.getBoundingClientRect().width));
      const margin = { top: 38, right: 38, bottom: 27, left: 38 };
      const ratingBottom = narrow ? 238 : 254;
      const minutesTop = ratingBottom + 53;
      const minutesBottom = minutesTop + 88;
      const totalHeight = minutesBottom + margin.bottom;
      const innerRight = panelWidth - margin.right;
      const x = d3.scalePoint().domain(panel.seasons).range([margin.left, innerRight]);
      const y = d3.scaleLinear().domain([-8, 16]).range([ratingBottom, margin.top]);
      const minutes = d3.scaleLinear().domain([0, 3000]).range([minutesBottom, minutesTop]);
      const step = x.step();
      const svg = d3.select(panelNode).append("svg")
        .attr("viewBox", `0 0 ${panelWidth} ${totalHeight}`)
        .attr("role", "img")
        .attr("aria-label", `${panel.label}: Golden State offensive rating relative to NBA average with Curry on and off court, with Curry's on-court minutes below.`);

      svg.append("text").attr("class", "curry-chart__panel-title").attr("x", margin.left).attr("y", 14).text(panel.label);
      svg.append("text").attr("class", "curry-chart__axis-title").attr("x", margin.left).attr("y", 29).text("POINTS PER 100 VS. NBA AVG.");

      if (panel.id === "recent") {
        const latestX = x("2025-26");
        svg.append("rect").attr("class", "curry-chart__latest-band")
          .attr("x", latestX - step * 0.43).attr("y", margin.top - 5)
          .attr("width", Math.min(step * 0.86, panelWidth - latestX))
          .attr("height", minutesBottom - margin.top + 11);
      }

      [-5, 0, 5, 10, 15].forEach((tick) => {
        svg.append("line").attr("class", tick === 0 ? "curry-chart__zero" : "curry-chart__grid")
          .attr("x1", margin.left).attr("x2", innerRight).attr("y1", y(tick)).attr("y2", y(tick));
        svg.append("text").attr("class", "curry-chart__tick").attr("x", margin.left - 7).attr("y", y(tick) + 3)
          .attr("text-anchor", "end").text(tick > 0 ? `+${tick}` : tick);
      });
      svg.append("text").attr("class", "curry-chart__zero-label").attr("x", margin.left + 5).attr("y", y(0) - 6).text("NBA average");

      const line = (field) => d3.line().x((row) => x(row.season)).y((row) => y(row[field]))(panelRows);
      svg.append("path").attr("class", "curry-chart__line curry-chart__line--on").attr("stroke", onColor).attr("d", line("on_relative_ortg"));
      svg.append("path").attr("class", "curry-chart__line curry-chart__line--off").attr("stroke", offColor).attr("d", line("off_relative_ortg"));

      const marks = svg.selectAll(".curry-chart__season-mark").data(panelRows).join("g")
        .attr("class", (row) => `curry-chart__season-mark${row.season === "2025-26" ? " is-latest" : ""}`)
        .attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", (row) => `${row.season}: Curry on court ${signed(row.on_relative_ortg)}, Curry off court ${signed(row.off_relative_ortg)} points per 100 relative to NBA average; gap ${signed(row.offensive_on_off_gap)}; Curry on-court minutes ${numberFormat.format(row.on_minutes)}.`)
        .on("mouseenter focus", function handleInspect(event, row) {
          d3.select(root).selectAll(".curry-chart__season-mark").classed("is-active", (candidate) => candidate === row);
          inspection.innerHTML = `<strong>${escapeHtml(row.season)}:</strong> on court ${signed(row.on_relative_ortg)}, off court ${signed(row.off_relative_ortg)} vs. NBA average; ${signed(row.offensive_on_off_gap)} offensive gap; ${numberFormat.format(row.on_minutes)} on-court minutes.`;
        })
        .on("mouseleave blur", function clearInspect() {
          d3.select(root).selectAll(".curry-chart__season-mark").classed("is-active", false);
          inspection.textContent = "Focus or tap a season for exact values; the full data table is available below.";
        });
      marks.append("circle").attr("class", "curry-chart__hit").attr("cx", (row) => x(row.season)).attr("cy", (row) => y((row.on_relative_ortg + row.off_relative_ortg) / 2)).attr("r", narrow ? 15 : 18);
      marks.append("circle").attr("class", "curry-chart__dot curry-chart__dot--on").attr("stroke", onColor).attr("fill", onColor).attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row.on_relative_ortg)).attr("r", 4.2);
      marks.append("circle").attr("class", "curry-chart__dot curry-chart__dot--off").attr("stroke", offColor).attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row.off_relative_ortg)).attr("r", 4.2);

      if (panel.id === "recent") {
        const latest = panelRows.at(-1);
        const latestX = x(latest.season);
        svg.append("text").attr("class", "curry-chart__direct-label curry-chart__direct-label--on").attr("fill", onColor)
          .attr("x", latestX - 7).attr("y", y(latest.on_relative_ortg) - 9).attr("text-anchor", "end").text(narrow ? "ON" : `Curry on  ${signed(latest.on_relative_ortg)}`);
        svg.append("text").attr("class", "curry-chart__direct-label curry-chart__direct-label--off").attr("fill", offColor)
          .attr("x", latestX - 7).attr("y", y(latest.off_relative_ortg) + 15).attr("text-anchor", "end").text(narrow ? "OFF" : `Curry off  ${signed(latest.off_relative_ortg)}`);
      }

      svg.append("line").attr("class", "curry-chart__minutes-baseline").attr("x1", margin.left).attr("x2", innerRight).attr("y1", minutesBottom).attr("y2", minutesBottom);
      svg.append("text").attr("class", "curry-chart__axis-title").attr("x", margin.left).attr("y", minutesTop - 14).text("CURRY ON-COURT MINUTES");
      svg.selectAll(".curry-chart__minutes-bar").data(panelRows).join("rect")
        .attr("class", (row) => `curry-chart__minutes-bar${row.season === "2025-26" ? " is-latest" : ""}`)
        .attr("x", (row) => x(row.season) - Math.max(6, step * 0.23)).attr("width", Math.max(12, step * 0.46))
        .attr("y", (row) => minutes(row.on_minutes)).attr("height", (row) => minutesBottom - minutes(row.on_minutes));
      panelRows.forEach((row) => {
        svg.append("text").attr("class", "curry-chart__minutes-value").attr("x", x(row.season)).attr("y", minutes(row.on_minutes) - 5).attr("text-anchor", "middle").text(numberFormat.format(row.on_minutes));
        svg.append("text").attr("class", `curry-chart__season${row.season === "2025-26" ? " is-latest" : ""}`).attr("x", x(row.season)).attr("y", minutesBottom + 18).attr("text-anchor", "middle").text(shortSeason(row.season));
      });
    });
  }

  function showError(root, error) {
    root.querySelector(".curry-chart__plot").innerHTML = '<p class="curry-chart__status curry-chart__status--error">The Curry on/off chart could not be displayed. The validated CSV and accessible table remain available below.</p>';
    root.removeAttribute("aria-busy");
    console.error("Curry/Warriors chart could not load:", error);
  }

  async function loadChart(root) {
    try {
      const response = await fetch(root.dataset.source);
      if (!response.ok) throw new Error(`Chart data request returned ${response.status}.`);
      const rows = validateRows(d3.csvParse(await response.text()));
      renderTable(root, rows);
      let frame = 0;
      const render = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => renderChart(root, rows));
      };
      render();
      const observer = new ResizeObserver(render);
      observer.observe(root.querySelector(".curry-chart__plot"));
      root._curryWarriorsChart = { rows, render, observer };
      root.dataset.chartMounted = "true";
      root.removeAttribute("aria-busy");
    } catch (error) {
      showError(root, error);
    }
  }

  document.querySelectorAll("[data-curry-warriors-chart]").forEach((root) => {
    const card = root.closest("details");
    const openAndLoad = () => {
      if (card && !card.open) return;
      if (root._curryWarriorsChart) root._curryWarriorsChart.render();
      else requestAnimationFrame(() => loadChart(root));
    };
    if (card) card.addEventListener("toggle", openAndLoad);
    openAndLoad();
  });

  window.validateCurryWarriorsRows = validateRows;
})();
