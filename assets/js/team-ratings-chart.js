(function () {
  "use strict";

  const METRICS = {
    record: {
      button: "Record",
      valueField: "win_pct",
      rankField: "record_rank",
      plotTitle: "Actual win percentage",
      axisLabel: "Win percentage",
      tableValue: "Win percentage",
      note: "Win percentage accounts for unequal season lengths; the reference line marks .500.",
      axis: (value) => `${Math.round(value * 100)}%`,
      point: (row) => `${row.wins}\u2013${row.losses}`,
      table: (row) => `${(Number(row.win_pct) * 100).toFixed(1)}%`,
      fixedBounds: [0, 1],
      ticks: [0, 0.25, 0.5, 0.75, 1],
      reference: 0.5,
      referenceLabel: ".500",
    },
    offense: {
      button: "Offense",
      valueField: "ortg",
      rankField: "ortg_rank",
      plotTitle: "Actual offensive rating",
      axisLabel: "Points scored / 100 · higher is better",
      tableValue: "Points scored per 100 possessions",
      note: "Offensive rating is points scored per 100 possessions; higher values are better.",
      axis: formatRoundedTick,
      point: (row) => Number(row.ortg).toFixed(1),
      table: (row) => Number(row.ortg).toFixed(2),
    },
    defense: {
      button: "Defense",
      valueField: "drtg",
      rankField: "drtg_rank",
      plotTitle: "Actual defensive rating",
      axisLabel: "Points allowed / 100 · lower is better",
      tableValue: "Points allowed per 100 possessions",
      note: "Defensive rating is points allowed per 100 possessions; lower values rise on the left axis.",
      axis: formatRoundedTick,
      point: (row) => Number(row.drtg).toFixed(1),
      table: (row) => Number(row.drtg).toFixed(2),
      lowerIsBetter: true,
    },
    net: {
      button: "Net rating",
      valueField: "netrtg",
      rankField: "netrtg_rank",
      plotTitle: "Actual net rating",
      axisLabel: "Net rating / 100 · higher is better",
      tableValue: "Points per 100 possessions",
      note: "Net rating is point differential per 100 possessions; the reference line marks zero.",
      axis: formatSignedTick,
      point: (row) => formatSigned(Number(row.netrtg), 1),
      table: (row) => formatSigned(Number(row.netrtg), 2),
      includeZero: true,
      reference: 0,
      referenceLabel: "0",
    },
  };

  const EXPECTED_SEASONS = [
    "2016-17", "2017-18", "2018-19", "2019-20", "2020-21",
    "2021-22", "2022-23", "2023-24", "2024-25", "2025-26",
  ];

  let instanceCount = 0;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function escapeXml(value) {
    return escapeHtml(value);
  }

  function formatSigned(value, digits) {
    if (value > 0) return `+${value.toFixed(digits)}`;
    return value.toFixed(digits);
  }

  function formatRoundedTick(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function formatSignedTick(value) {
    if (value > 0) return `+${formatRoundedTick(value)}`;
    return formatRoundedTick(value);
  }

  function shortSeason(season, abbreviated = false) {
    const [start, end] = season.split("-");
    if (abbreviated) return `\u2019${start.slice(2)}`;
    return `${start.slice(2)}\u2013${end}`;
  }

  function possessive(name) {
    return /s$/i.test(name) ? `${name}\u2019` : `${name}\u2019s`;
  }

  function parseCsv(text) {
    const matrix = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          cell += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(cell);
        cell = "";
      } else if (character === "\n") {
        row.push(cell.replace(/\r$/, ""));
        if (row.some((value) => value !== "")) matrix.push(row);
        row = [];
        cell = "";
      } else {
        cell += character;
      }
    }

    if (quoted) throw new Error("The ratings CSV contains an unterminated quoted field.");
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value !== "")) matrix.push(row);
    if (matrix.length < 2) throw new Error("The ratings CSV has no data rows.");

    const headers = matrix[0];
    return matrix.slice(1).map((values) => Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    ));
  }

  function niceScale(values, includeZero) {
    const working = includeZero ? [...values, 0] : values;
    const rawMin = Math.min(...working);
    const rawMax = Math.max(...working);
    const span = Math.max(rawMax - rawMin, 1);
    const roughStep = span / 4;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const normalized = roughStep / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    let min = Math.floor(rawMin / step) * step;
    let max = Math.ceil(rawMax / step) * step;
    if (min === max) max = min + step;

    const ticks = [];
    for (let value = min; value <= max + step / 100; value += step) {
      ticks.push(Number(value.toFixed(10)));
    }
    return { min, max, ticks };
  }

  function validateTeamRows(data, teamName) {
    const rows = data
      .filter((row) => row.team === teamName)
      .sort((a, b) => Number(a.season_start_year) - Number(b.season_start_year));

    if (rows.length !== 10) {
      throw new Error(`Expected 10 rows for ${teamName}; found ${rows.length}.`);
    }
    const seasons = rows.map((row) => row.season);
    if (seasons.some((season, index) => season !== EXPECTED_SEASONS[index])) {
      throw new Error(`The ${teamName} rows do not cover the expected 2016-17 through 2025-26 sequence.`);
    }

    const required = [
      "wins", "losses", "games", "win_pct", "record_rank", "ortg", "ortg_rank",
      "drtg", "drtg_rank", "netrtg", "netrtg_rank",
    ];
    rows.forEach((row) => {
      required.forEach((field) => {
        if (row[field] === "" || !Number.isFinite(Number(row[field]))) {
          throw new Error(`Missing or invalid ${field} for ${teamName}, ${row.season}.`);
        }
      });
      ["record_rank", "ortg_rank", "drtg_rank", "netrtg_rank"].forEach((field) => {
        const rank = Number(row[field]);
        if (!Number.isInteger(rank) || rank < 1 || rank > 30) {
          throw new Error(`Invalid leaguewide rank in ${field} for ${teamName}, ${row.season}.`);
        }
      });
      const games = Number(row.games);
      const calculatedWinPct = Number(row.wins) / games;
      if (Number(row.wins) + Number(row.losses) !== games || Math.abs(Number(row.win_pct) - calculatedWinPct) > 0.000001) {
        throw new Error(`Record fields are inconsistent for ${teamName}, ${row.season}.`);
      }
    });
    return rows;
  }

  class TeamRatingsChart {
    constructor(root, options) {
      this.root = root;
      this.teamName = options.teamName;
      this.accent = options.accent || "#002b5c";
      this.rankAccent = options.rankAccent || "";
      this.positiveColorName = options.positiveColorName || "Team-color";
      this.rows = validateTeamRows(options.data, this.teamName);
      this.title = options.title || "";
      this.subtitle = options.subtitle || "";
      this.annotation = options.annotation && this.rows.some((row) => row.season === options.annotation.season)
        ? options.annotation
        : null;
      this.selectedMetric = METRICS[options.initialMetric] ? options.initialMetric : "record";
      this.inspectedIndex = this.rows.length - 1;
      this.instanceId = `team-ratings-${++instanceCount}`;
      this.lastWidth = 0;
      this.resizeFrame = 0;
      this.build();
    }

    build() {
      const displayName = this.teamName === "Washington Wizards" ? "Washington" : this.teamName;
      const title = this.title || `${possessive(displayName)} decade in the standings and efficiency rankings`;
      const subtitle = this.subtitle || "Regular-season record and team ratings, 2016\u201317 through 2025\u201326.";
      this.root.style.setProperty("--chart-accent", this.accent);
      if (this.rankAccent) {
        this.root.style.setProperty("--chart-rank", this.rankAccent);
        this.root.style.setProperty("--chart-rank-ink", this.rankAccent);
      }
      this.root.innerHTML = `
        <header class="ratings-chart__header">
          <p class="ratings-chart__eyebrow">Ten-season trend</p>
          <h3 class="ratings-chart__title" id="${this.instanceId}-title">${escapeHtml(title)}</h3>
          <p class="ratings-chart__intro">${escapeHtml(subtitle)}</p>
        </header>
        <fieldset class="ratings-chart__controls" aria-label="Choose a metric">
          <legend>Metric</legend>
          ${Object.entries(METRICS).map(([key, metric]) => `
            <button class="ratings-chart__metric-button" type="button" data-metric="${key}"
              aria-pressed="${key === this.selectedMetric}" aria-controls="${this.instanceId}-panel">
              ${metric.button}
            </button>
          `).join("")}
        </fieldset>
        <section class="ratings-chart__panel" id="${this.instanceId}-panel" aria-live="polite" aria-labelledby="${this.instanceId}-metric-heading">
          <h4 class="ratings-chart__metric-heading" id="${this.instanceId}-metric-heading"></h4>
          <p class="ratings-chart__metric-note"></p>
          <p class="ratings-chart__inspection-detail" id="${this.instanceId}-inspection" aria-live="polite"></p>
          <p class="ratings-chart__scale-note">Actual values use the left axis; league ranks use the right axis. Line crossings do not compare equal values.</p>
          <div class="ratings-chart__plot"></div>
          <details class="ratings-chart__table-details">
            <summary class="ratings-chart__table-toggle">View accessible data table</summary>
            <div class="ratings-chart__table-wrap"></div>
          </details>
        </section>
        <footer class="ratings-chart__notes">
          <p>Basketball Reference, Team Ratings tables, 2016-17 through 2025-26.</p>
          <p>Unadjusted ratings; leaguewide ranks. Competition ranking for ties: 1, 2, 2, 4.</p>
          <p>Win percentage accommodates unequal season lengths.</p>
        </footer>
      `;

      this.heading = this.root.querySelector(".ratings-chart__metric-heading");
      this.metricNote = this.root.querySelector(".ratings-chart__metric-note");
      this.inspectionDetail = this.root.querySelector(".ratings-chart__inspection-detail");
      this.plot = this.root.querySelector(".ratings-chart__plot");
      this.tableWrap = this.root.querySelector(".ratings-chart__table-wrap");
      this.buttons = [...this.root.querySelectorAll("[data-metric]")];
      this.buttons.forEach((button) => {
        button.addEventListener("click", () => this.selectMetric(button.dataset.metric));
      });
      this.plot.addEventListener("click", (event) => this.activateInspection(event));
      this.plot.addEventListener("focusin", (event) => this.activateInspection(event));
      this.plot.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target.closest("[data-season-index]");
        if (!target) return;
        event.preventDefault();
        this.showInspection(Number(target.dataset.seasonIndex));
      });

      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
        this.resizeObserver.observe(this.plot);
      } else {
        this.fallbackResize = () => this.scheduleResize();
        window.addEventListener("resize", this.fallbackResize);
      }
      this.render(true);
    }

    selectMetric(metricKey) {
      if (!METRICS[metricKey] || metricKey === this.selectedMetric) return;
      this.selectedMetric = metricKey;
      this.render(true);
    }

    scheduleResize() {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => {
        const width = Math.round(this.plot.getBoundingClientRect().width);
        if (width > 0 && width !== this.lastWidth) this.render(true);
      });
    }

    render(force) {
      const metric = METRICS[this.selectedMetric];
      const width = Math.round(this.plot.getBoundingClientRect().width);
      this.buttons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.metric === this.selectedMetric));
      });
      this.heading.textContent = metric.button;
      this.metricNote.textContent = this.selectedMetric === "net"
        ? `${metric.note} ${this.positiveColorName} dots are positive; red dots are negative.`
        : metric.note;
      this.renderTable(metric);
      if (width <= 0) return;
      if (!force && width === this.lastWidth) return;
      this.lastWidth = width;
      this.plot.innerHTML = this.buildSvg(metric, width);
      this.showInspection(this.inspectedIndex);
    }

    activateInspection(event) {
      const target = event.target.closest("[data-season-index]");
      if (!target) return;
      this.showInspection(Number(target.dataset.seasonIndex));
    }

    showInspection(index) {
      const row = this.rows[index];
      const metric = METRICS[this.selectedMetric];
      if (!row || !metric) return;
      this.inspectedIndex = index;
      const actual = this.selectedMetric === "record"
        ? `${row.wins}\u2013${row.losses} (${metric.table(row)})`
        : `${metric.table(row)} ${metric.tableValue.toLowerCase()}`;
      this.inspectionDetail.textContent = `${row.season}: ${actual}; league rank No. ${row[metric.rankField]}.`;
      this.plot.querySelectorAll("[data-season-index]").forEach((target) => {
        const active = Number(target.dataset.seasonIndex) === index;
        target.classList.toggle("is-active", active);
        target.setAttribute("aria-pressed", String(active));
      });
    }

    buildSvg(metric, measuredWidth) {
      const width = Math.max(280, measuredWidth);
      const narrow = width < 520;
      const annotationIndex = this.annotation
        ? this.rows.findIndex((row) => row.season === this.annotation.season)
        : -1;
      const annotationOffset = annotationIndex >= 0 ? 28 : 0;
      const height = (narrow ? 408 : 396) + annotationOffset;
      const left = narrow ? 48 : 58;
      const right = narrow ? 47 : 68;
      const plotRight = width - right;
      const plotWidth = plotRight - left;
      const plotTop = (narrow ? 112 : 88) + annotationOffset;
      const plotBottom = (narrow ? 342 : 332) + annotationOffset;
      const values = this.rows.map((row) => Number(row[metric.valueField]));
      const bounds = metric.fixedBounds
        ? { min: metric.fixedBounds[0], max: metric.fixedBounds[1], ticks: metric.ticks }
        : niceScale(values, metric.includeZero);
      const x = (index) => left + (plotWidth * index) / (this.rows.length - 1);
      const yActual = (value) => {
        const ratio = (value - bounds.min) / (bounds.max - bounds.min);
        return metric.lowerIsBetter
          ? plotTop + ratio * (plotBottom - plotTop)
          : plotBottom - ratio * (plotBottom - plotTop);
      };
      const yRank = (rank) => plotTop + ((rank - 1) / 29) * (plotBottom - plotTop);
      const actualPoints = this.rows.map((row, index) => [x(index), yActual(Number(row[metric.valueField]))]);
      const rankPoints = this.rows.map((row, index) => [x(index), yRank(Number(row[metric.rankField]))]);
      const path = (points) => points.map(([pointX, pointY], index) => `${index ? "L" : "M"}${pointX.toFixed(2)},${pointY.toFixed(2)}`).join(" ");
      const boundedLabelY = (value) => Math.max(plotTop + 13, Math.min(plotBottom - 6, value));
      const labelAnchor = (index) => index === 0 ? "start" : index === this.rows.length - 1 ? "end" : "middle";
      const labelX = (index) => x(index) + (index === 0 ? 6 : index === this.rows.length - 1 ? -6 : 0);
      const valueLabelX = (index) => index === annotationIndex ? x(index) - 8 : labelX(index);
      const valueLabelAnchor = (index) => index === annotationIndex ? "end" : labelAnchor(index);
      const rankLabelX = (index) => index === annotationIndex ? x(index) + 8 : labelX(index);
      const rankLabelAnchor = (index) => index === annotationIndex ? "start" : labelAnchor(index);
      const labeledIndexes = new Set(narrow ? [0, 3, 6, 9] : this.rows.map((_, index) => index));
      const actualLabelY = actualPoints.map(([, pointY]) => boundedLabelY(
        pointY - plotTop < 20 ? pointY + 18 : pointY - 10,
      ));
      const rankLabelY = rankPoints.map(([, pointY], index) => {
        if (!labeledIndexes.has(index)) return null;
        const isAnnotatedSeason = index === annotationIndex;
        const candidates = (isAnnotatedSeason ? [-20, 30, -40, 48, 60] : [-18, 26, -36, 42])
          .map((offset) => boundedLabelY(pointY + offset))
          .filter((candidate, candidateIndex, all) => all.indexOf(candidate) === candidateIndex);
        return candidates.find((candidate) => (
          Math.abs(candidate - actualLabelY[index]) >= (isAnnotatedSeason ? 24 : 18)
          && Math.abs(candidate - pointY) >= 15
        )) ?? null;
      });
      const diamondPoints = (pointX, pointY, size = 5) => [
        `${pointX},${pointY - size}`,
        `${pointX + size},${pointY}`,
        `${pointX},${pointY + size}`,
        `${pointX - size},${pointY}`,
      ].join(" ");
      const inspectionActual = (row) => this.selectedMetric === "record"
        ? `${row.wins}\u2013${row.losses}, ${metric.table(row)}`
        : `${metric.table(row)} ${metric.tableValue.toLowerCase()}`;
      const seasonZone = (index) => ({
        left: index === 0 ? left : (x(index - 1) + x(index)) / 2,
        right: index === this.rows.length - 1 ? plotRight : (x(index) + x(index + 1)) / 2,
      });
      const inspectionZones = this.rows.map((row, index) => {
        const zone = seasonZone(index);
        return `
          <g class="ratings-chart__inspection" data-season-index="${index}" tabindex="0" role="button"
            aria-pressed="false" aria-describedby="${this.instanceId}-inspection"
            aria-label="${escapeXml(`${row.season}: ${inspectionActual(row)}; league rank No. ${row[metric.rankField]}`)}">
            <rect class="ratings-chart__inspection-hit" x="${zone.left}" y="${plotTop}"
              width="${zone.right - zone.left}" height="${plotBottom - plotTop}"></rect>
          </g>
        `;
      }).join("");
      const annotation = annotationIndex < 0 ? "" : (() => {
        const zone = seasonZone(annotationIndex);
        return `
          <g class="ratings-chart__annotation" aria-label="${escapeXml(`${this.annotation.season}: ${this.annotation.label}`)}">
            <rect class="ratings-chart__annotation-band" x="${zone.left}" y="${plotTop}"
              width="${zone.right - zone.left}" height="${plotBottom - plotTop}"></rect>
            <line class="ratings-chart__annotation-line" x1="${x(annotationIndex)}" x2="${x(annotationIndex)}"
              y1="${plotTop}" y2="${plotBottom}"></line>
            <text class="ratings-chart__annotation-label" x="${x(annotationIndex)}" y="${plotTop - 10}"
              text-anchor="middle">${escapeXml(this.annotation.label)}</text>
          </g>
        `;
      })();

      const legend = narrow ? `
        <line class="ratings-chart__legend-actual" x1="${left}" x2="${left + 27}" y1="20" y2="20"></line>
        <circle class="ratings-chart__point ratings-chart__legend-point" cx="${left + 13.5}" cy="20" r="4"></circle>
        <text class="ratings-chart__legend-label" x="${left + 36}" y="24">Actual value — left axis</text>
        <line class="ratings-chart__legend-rank" x1="${left}" x2="${left + 27}" y1="46" y2="46"></line>
        <polygon class="ratings-chart__rank-point ratings-chart__legend-point" points="${diamondPoints(left + 13.5, 46, 4)}"></polygon>
        <text class="ratings-chart__legend-label ratings-chart__legend-label--rank" x="${left + 36}" y="50">League rank — right axis</text>
      ` : `
        <line class="ratings-chart__legend-actual" x1="${left}" x2="${left + 28}" y1="23" y2="23"></line>
        <circle class="ratings-chart__point ratings-chart__legend-point" cx="${left + 14}" cy="23" r="4"></circle>
        <text class="ratings-chart__legend-label" x="${left + 38}" y="27">Actual value — left axis</text>
        <line class="ratings-chart__legend-rank" x1="${left + 220}" x2="${left + 248}" y1="23" y2="23"></line>
        <polygon class="ratings-chart__rank-point ratings-chart__legend-point" points="${diamondPoints(left + 234, 23, 4)}"></polygon>
        <text class="ratings-chart__legend-label ratings-chart__legend-label--rank" x="${left + 258}" y="27">League rank — right axis</text>
      `;

      const actualGrid = bounds.ticks.map((tick) => {
        const tickY = yActual(tick);
        return `
          <line class="ratings-chart__grid" x1="${left}" x2="${plotRight}" y1="${tickY}" y2="${tickY}"></line>
          <text class="ratings-chart__tick" x="${left - 7}" y="${tickY + 4}" text-anchor="end">${escapeXml(metric.axis(tick))}</text>
        `;
      }).join("");
      const rankTicks = [1, 10, 20, 30].map((rank) => {
        const tickY = yRank(rank);
        return `
          <line class="ratings-chart__rank-tick" x1="${plotRight}" x2="${plotRight + 5}" y1="${tickY}" y2="${tickY}"></line>
          <text class="ratings-chart__rank-tick-label" x="${plotRight + 9}" y="${tickY + 4}" text-anchor="start">${rank}</text>
        `;
      }).join("");
      const seasonGrid = this.rows.map((row, index) => `
        <line class="ratings-chart__season-grid" x1="${x(index)}" x2="${x(index)}" y1="${plotTop}" y2="${plotBottom}"></line>
        <text class="ratings-chart__season-label" x="${labelX(index)}" y="${plotBottom + 23}"
          text-anchor="${labelAnchor(index)}">${shortSeason(row.season, narrow)}</text>
      `).join("");
      const reference = metric.reference === undefined ? "" : `
        <line class="ratings-chart__reference" x1="${left}" x2="${plotRight}"
          y1="${yActual(metric.reference)}" y2="${yActual(metric.reference)}"></line>
        <text class="ratings-chart__reference-label" x="${plotRight - 4}" y="${yActual(metric.reference) - 5}" text-anchor="end">${metric.referenceLabel}</text>
      `;
      const actualMarks = this.rows.map((row, index) => {
        const value = Number(row[metric.valueField]);
        const netClass = this.selectedMetric === "net"
          ? value >= 0 ? " ratings-chart__point--positive" : " ratings-chart__point--negative"
          : "";
        const labelClass = this.selectedMetric === "net"
          ? value >= 0 ? " ratings-chart__value-label--positive" : " ratings-chart__value-label--negative"
          : "";
        const label = metric.point(row);
        return `
          <circle class="ratings-chart__point${netClass}" cx="${actualPoints[index][0]}" cy="${actualPoints[index][1]}" r="4.5">
            <title>${escapeXml(`${row.season}: ${label}`)}</title>
          </circle>
          ${labeledIndexes.has(index) ? `<text class="ratings-chart__value-label${labelClass}" data-label-season="${row.season}"
            x="${valueLabelX(index)}" y="${actualLabelY[index]}" text-anchor="${valueLabelAnchor(index)}">${escapeXml(label)}</text>` : ""}
        `;
      }).join("");
      const rankMarks = this.rows.map((row, index) => {
        const rank = Number(row[metric.rankField]);
        const plottedRank = narrow ? `#${rank}` : `No. ${rank}`;
        return `
          <polygon class="ratings-chart__rank-point" points="${diamondPoints(rankPoints[index][0], rankPoints[index][1])}">
            <title>${escapeXml(`${row.season}: No. ${rank}`)}</title>
          </polygon>
          ${rankLabelY[index] === null ? "" : `<text class="ratings-chart__rank-label" data-label-season="${row.season}"
            x="${rankLabelX(index)}" y="${rankLabelY[index]}" text-anchor="${rankLabelAnchor(index)}">${plottedRank}</text>`}
        `;
      }).join("");

      return `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${this.instanceId}-svg-title ${this.instanceId}-svg-desc">
          <title id="${this.instanceId}-svg-title">${escapeXml(`${this.teamName} ${metric.button.toLowerCase()}, 2016-17 through 2025-26`)}</title>
          <desc id="${this.instanceId}-svg-desc">One shared plot shows ${escapeXml(metric.plotTitle.toLowerCase())} as a solid team-color line using the left axis and leaguewide rank as a dashed line using the independent right axis. Rank 1 is at the top and rank 30 at the bottom. Crossings do not indicate equal values.${this.annotation ? ` ${escapeXml(this.annotation.season)} is highlighted: ${escapeXml(this.annotation.label)}.` : ""} Focus or select a season for exact details.</desc>
          ${legend}
          <text class="ratings-chart__axis-label" x="${left}" y="${narrow ? 78 : 67}">${escapeXml(metric.axisLabel)}</text>
          <text class="ratings-chart__axis-label ratings-chart__rank-axis-label" x="${plotRight}" y="${narrow ? 97 : 67}" text-anchor="end">League rank · 1 is best</text>
          ${annotation}
          ${actualGrid}
          ${seasonGrid}
          ${reference}
          <line class="ratings-chart__axis" x1="${left}" x2="${left}" y1="${plotTop}" y2="${plotBottom}"></line>
          <line class="ratings-chart__axis ratings-chart__rank-axis" x1="${plotRight}" x2="${plotRight}" y1="${plotTop}" y2="${plotBottom}"></line>
          ${rankTicks}
          ${inspectionZones}
          <path class="ratings-chart__rank-line" d="${path(rankPoints)}"></path>
          ${rankMarks}
          <path class="ratings-chart__line" d="${path(actualPoints)}"></path>
          ${actualMarks}
          <text class="ratings-chart__plot-subtitle" x="${left + plotWidth / 2}" y="${plotBottom + 48}" text-anchor="middle">Season</text>
        </svg>
      `;
    }

    renderTable(metric) {
      const isRecord = this.selectedMetric === "record";
      this.tableWrap.innerHTML = `
        <table class="ratings-chart__table">
          <caption>${escapeHtml(`${this.teamName}: ${metric.button.toLowerCase()}, 2016-17 through 2025-26`)}</caption>
          <thead>
            <tr>
              <th scope="col">Season</th>
              ${isRecord ? '<th scope="col">Record</th>' : ""}
              <th scope="col">${escapeHtml(metric.tableValue)}</th>
              <th scope="col">Leaguewide rank</th>
            </tr>
          </thead>
          <tbody>
            ${this.rows.map((row) => `
              <tr>
                <th scope="row">${escapeHtml(row.season)}</th>
                ${isRecord ? `<td>${escapeHtml(`${row.wins}\u2013${row.losses}`)}</td>` : ""}
                <td>${escapeHtml(metric.table(row))}</td>
                <td>No. ${escapeHtml(row[metric.rankField])}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  }

  function createTeamRatingsChart(root, options) {
    return new TeamRatingsChart(root, options);
  }

  async function loadChart(root) {
    if (root.dataset.chartMounted === "true") return;
    root.dataset.chartMounted = "true";
    root.setAttribute("aria-busy", "true");
    root.innerHTML = '<p class="ratings-chart__status">Loading historical team ratings\u2026</p>';
    try {
      const response = await fetch(root.dataset.source, { cache: "no-store" });
      if (!response.ok) throw new Error(`Ratings request returned ${response.status}.`);
      const data = parseCsv(await response.text());
      createTeamRatingsChart(root, {
        teamName: root.dataset.teamName,
        data,
        accent: root.dataset.accent,
        rankAccent: root.dataset.rankAccent,
        positiveColorName: root.dataset.positiveColorName,
        title: root.dataset.title,
        subtitle: root.dataset.subtitle,
        initialMetric: root.dataset.initialMetric,
        annotation: root.dataset.annotationSeason && root.dataset.annotationLabel ? {
          season: root.dataset.annotationSeason,
          label: root.dataset.annotationLabel,
        } : null,
      });
      root.setAttribute("aria-busy", "false");
    } catch (error) {
      root.setAttribute("aria-busy", "false");
      root.innerHTML = `
        <p class="ratings-chart__status ratings-chart__status--error">
          Historical team ratings are unavailable. Serve this repository over HTTP and reload the page; see the README for the local preview command.
        </p>
      `;
      console.error("Team ratings chart could not load:", error);
    }
  }

  function initializeCharts() {
    document.querySelectorAll("[data-team-ratings-chart]").forEach((root) => {
      const card = root.closest("details");
      const openAndLoad = () => {
        if (!card || card.open) requestAnimationFrame(() => loadChart(root));
      };
      if (card) card.addEventListener("toggle", openAndLoad);
      openAndLoad();
    });
  }

  window.createTeamRatingsChart = createTeamRatingsChart;
  initializeCharts();
})();
