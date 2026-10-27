(function initializeVanVleetRocketsCharts() {
  const EXPECTED_KEYS = [
    "2023-24:on", "2023-24:off", "2024-25:on", "2024-25:off",
    "2025-26:team_full_season", "2026-27:on", "2026-27:off",
  ];
  const numberFormat = new Intl.NumberFormat("en-US");

  function requiredNumber(row, field) {
    if (row[field] === "" || row[field] == null) throw new Error(`${row.season} ${row.split}: missing ${field}`);
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`${row.season} ${row.split}: invalid ${field}`);
    return value;
  }

  function near(left, right) {
    return Math.abs(left - right) < 0.051;
  }

  function validateRows(rawRows) {
    const required = [
      "season", "split", "minutes", "team_ortg", "team_tov_pct",
      "comparison_status", "chart_included", "ortg_on_minus_off", "tov_on_minus_off_pp",
    ];
    if (!rawRows.length || required.some((field) => !(field in rawRows[0]))) {
      throw new Error("VanVleet chart data is missing required columns.");
    }
    const keys = rawRows.map((row) => `${row.season}:${row.split}`);
    if (keys.length !== EXPECTED_KEYS.length || keys.some((key, index) => key !== EXPECTED_KEYS[index])) {
      throw new Error("VanVleet data does not contain the expected seven chronological rows.");
    }

    const rows = rawRows.map((row) => {
      const parsed = {
        ...row,
        team_ortg: requiredNumber(row, "team_ortg"),
        team_tov_pct: requiredNumber(row, "team_tov_pct"),
        minutes: row.minutes === "" ? null : requiredNumber(row, "minutes"),
      };
      if (row.season === "2025-26") {
        if (row.split !== "team_full_season" || parsed.minutes !== null || row.chart_included !== "true") {
          throw new Error("2025-26 must be a charted full-season context row with blank minutes.");
        }
      } else if (parsed.minutes == null) {
        throw new Error(`${row.season} ${row.split}: minutes may not be blank.`);
      }
      return parsed;
    });

    ["2023-24", "2024-25"].forEach((season) => {
      const pair = rows.filter((row) => row.season === season);
      if (pair.length !== 2 || pair.filter((row) => row.split === "on").length !== 1 || pair.filter((row) => row.split === "off").length !== 1) {
        throw new Error(`${season}: expected exactly one on and one off row.`);
      }
      const on = pair.find((row) => row.split === "on");
      const off = pair.find((row) => row.split === "off");
      if (!near(Number(on.ortg_on_minus_off), on.team_ortg - off.team_ortg)
        || !near(Number(on.tov_on_minus_off_pp), on.team_tov_pct - off.team_tov_pct)) {
        throw new Error(`${season}: derived differences do not match displayed source rates.`);
      }
    });

    const future = rows.filter((row) => row.season === "2026-27");
    if (future.length !== 2 || future.some((row) => row.chart_included !== "false") || future.find((row) => row.split === "on")?.minutes !== 61) {
      throw new Error("2026-27 must remain in cleaned data but outside the published comparison.");
    }
    return rows;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function renderTable(root, rows) {
    const published = rows.filter((row) => row.chart_included === "true");
    root.querySelector(".vanvleet-chart__table-wrap").innerHTML = `
      <table class="team-graphic__table vanvleet-chart__table">
        <caption>Houston team rates and minutes in the displayed VanVleet splits and full-season context.</caption>
        <thead><tr><th scope="col">Season</th><th scope="col">Context</th><th scope="col">Team ORtg</th><th scope="col">Team TOV%</th><th scope="col">Minutes</th></tr></thead>
        <tbody>${published.map((row) => `
          <tr${row.split === "team_full_season" ? ' class="is-context"' : ""}>
            <th scope="row">${escapeHtml(row.season)}</th>
            <td>${row.split === "on" ? "VanVleet on court" : row.split === "off" ? "VanVleet off court" : "Full season — VanVleet did not play"}</td>
            <td>${row.team_ortg.toFixed(1)} points/100</td>
            <td>${row.team_tov_pct.toFixed(1)}%</td>
            <td>${row.minutes == null ? "Not supplied" : numberFormat.format(row.minutes)}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  }

  function renderPanel(container, rows, config, colors) {
    const width = Math.max(280, Math.round(container.getBoundingClientRect().width));
    const narrow = width < 410;
    const margin = { top: 50, right: narrow ? 20 : 28, bottom: 24, left: narrow ? 52 : 68 };
    const innerRight = width - margin.right;
    const height = narrow ? 292 : 306;
    const yBySeason = { "2023-24": 101, "2024-25": 161, "2025-26": 247 };
    const scale = d3.scaleLinear().domain(config.domain).range([margin.left, innerRight]);
    const svg = d3.select(container).html("").append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", config.ariaLabel);

    svg.append("text").attr("class", "vanvleet-chart__panel-title").attr("x", 0).attr("y", 16).text(config.title);
    svg.append("text").attr("class", "vanvleet-chart__panel-direction").attr("x", 0).attr("y", 34).text(config.direction);
    config.ticks.forEach((tick) => {
      const tickX = scale(tick);
      svg.append("line").attr("class", "vanvleet-chart__grid").attr("x1", tickX).attr("x2", tickX).attr("y1", 58).attr("y2", 268);
      svg.append("text").attr("class", "vanvleet-chart__tick").attr("x", tickX).attr("y", 51).attr("text-anchor", "middle").text(config.tickFormat(tick));
    });

    ["2023-24", "2024-25"].forEach((season) => {
      const pair = rows.filter((row) => row.season === season);
      const on = pair.find((row) => row.split === "on");
      const off = pair.find((row) => row.split === "off");
      const y = yBySeason[season];
      const onX = scale(on[config.field]);
      const offX = scale(off[config.field]);
      svg.append("text").attr("class", "vanvleet-chart__season").attr("x", margin.left - 10).attr("y", y + 4).attr("text-anchor", "end").text(season);
      svg.append("line").attr("class", "vanvleet-chart__connector").attr("x1", onX).attr("x2", offX).attr("y1", y).attr("y2", y);
      [
        { row: on, x: onX, kind: "on", labelY: y - 13 },
        { row: off, x: offX, kind: "off", labelY: y + 21 },
      ].forEach((mark) => {
        svg.append("circle").attr("class", `vanvleet-chart__dot vanvleet-chart__dot--${mark.kind}`)
          .attr("cx", mark.x).attr("cy", y).attr("r", 6);
        svg.append("text").attr("class", `vanvleet-chart__value vanvleet-chart__value--${mark.kind}`)
          .attr("x", mark.x).attr("y", mark.labelY).attr("text-anchor", "middle")
          .text(`${mark.row[config.field].toFixed(1)}${config.unit}`);
      });
    });

    svg.append("line").attr("class", "vanvleet-chart__context-divider").attr("x1", 0).attr("x2", innerRight).attr("y1", 201).attr("y2", 201);
    const context = rows.find((row) => row.season === "2025-26");
    const contextX = scale(context[config.field]);
    const contextY = yBySeason["2025-26"];
    svg.append("text").attr("class", "vanvleet-chart__season vanvleet-chart__season--context")
      .attr("x", margin.left - 10).attr("y", contextY + 4).attr("text-anchor", "end").text("2025-26");
    svg.append("path").attr("class", "vanvleet-chart__context-mark").attr("fill", colors.context)
      .attr("d", d3.symbol().type(d3.symbolDiamond).size(150)()).attr("transform", `translate(${contextX},${contextY})`);
    svg.append("text").attr("class", "vanvleet-chart__value vanvleet-chart__value--context")
      .attr("x", contextX).attr("y", contextY - 14).attr("text-anchor", "middle")
      .text(`${context[config.field].toFixed(1)}${config.unit}`);
    svg.append("text").attr("class", "vanvleet-chart__context-label")
      .attr("x", margin.left).attr("y", 286).text(narrow ? "Full season — VanVleet did not play" : "Full season — VanVleet did not play");
  }

  function renderChart(root, rows) {
    const published = rows.filter((row) => row.chart_included === "true");
    const css = getComputedStyle(root);
    const colors = { context: css.getPropertyValue("--team-secondary").trim() || "#333333" };
    const panels = root.querySelectorAll(".vanvleet-chart__panel");
    renderPanel(panels[0], published, {
      field: "team_ortg", title: "Team offensive rating", direction: "Higher is better · points per 100 possessions",
      unit: " pts/100", domain: [110, 120], ticks: [110, 112, 114, 116, 118, 120], tickFormat: (value) => value,
      ariaLabel: "Houston team offensive rating. In 2023-24 it was 116.4 with VanVleet on court and 112.1 off court. In 2024-25 it was 116.5 on and 114.9 off. The separate 2025-26 full-season point is 118.6; VanVleet did not play.",
    }, colors);
    renderPanel(panels[1], published, {
      field: "team_tov_pct", title: "Team turnover percentage", direction: "Lower is better · percentage of plays",
      unit: "%", domain: [11, 17], ticks: [11, 12, 13, 14, 15, 16, 17], tickFormat: (value) => `${value}%`,
      ariaLabel: "Houston team turnover percentage. In 2023-24 it was 12.4 percent with VanVleet on court and 13.6 percent off court. In 2024-25 it was 12.6 percent on and 15.6 percent off. The separate 2025-26 full-season point is 13.3 percent; VanVleet did not play.",
    }, colors);
  }

  function showError(root, error) {
    root.querySelector(".vanvleet-chart__panels").innerHTML = '<p class="vanvleet-chart__status vanvleet-chart__status--error">The VanVleet chart could not be displayed. The validated CSV and preparation notes remain linked below.</p>';
    root.removeAttribute("aria-busy");
    console.error("VanVleet/Rockets chart could not load:", error);
  }

  async function loadChart(root) {
    if (root.dataset.chartMounted === "loading" || root.dataset.chartMounted === "true") return;
    root.dataset.chartMounted = "loading";
    try {
      const response = await fetch(root.dataset.source, { cache: "no-store" });
      if (!response.ok) throw new Error(`Chart data request returned ${response.status}.`);
      const rows = validateRows(d3.csvParse(await response.text()));
      renderTable(root, rows);
      let frame = 0;
      let lastWidth = 0;
      const render = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const width = Math.round(root.querySelector(".vanvleet-chart__panels").getBoundingClientRect().width);
          if (width <= 0 || width === lastWidth) return;
          lastWidth = width;
          renderChart(root, rows);
        });
      };
      render();
      const observer = new ResizeObserver(render);
      observer.observe(root.querySelector(".vanvleet-chart__panels"));
      root._vanvleetRocketsChart = { rows, render, observer };
      root.dataset.chartMounted = "true";
      root.removeAttribute("aria-busy");
    } catch (error) {
      showError(root, error);
    }
  }

  document.querySelectorAll("[data-vanvleet-rockets-chart]").forEach((root) => {
    const card = root.closest("details");
    const openAndLoad = () => {
      if (card && !card.open) return;
      if (root._vanvleetRocketsChart) root._vanvleetRocketsChart.render();
      else requestAnimationFrame(() => loadChart(root));
    };
    if (card) card.addEventListener("toggle", openAndLoad);
    openAndLoad();
  });

  window.validateVanVleetRocketsRows = validateRows;
})();
