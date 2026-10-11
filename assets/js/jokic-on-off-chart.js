(function initializeJokicOnOffChartModule() {
  "use strict";

  const EXPECTED = [
    { season: "2021-22", on: 118.8, off: 108.8, gap: 10.0 },
    { season: "2022-23", on: 125.6, off: 106.8, gap: 18.8 },
    { season: "2023-24", on: 123.9, off: 107.9, gap: 16.0 },
    { season: "2024-25", on: 127.1, off: 107.0, gap: 20.1 },
    { season: "2025-26", on: 128.3, off: 115.1, gap: 13.2 },
  ];
  const SPLITS = ["on_court", "off_court", "on_minus_off"];
  const SPLIT_LABELS = {
    on_court: "Jokic on court",
    off_court: "Jokic off court",
  };
  const numberFormat = new Intl.NumberFormat("en-US");
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

  function numericField(row, field, context, options = {}) {
    if (row[field] === undefined || row[field] === null || row[field].trim() === "") {
      throw new Error(`Missing ${field} for ${context}.`);
    }
    const value = Number(row[field]);
    if (!Number.isFinite(value) || (options.positive && value <= 0)) {
      throw new Error(`Invalid ${field} for ${context}.`);
    }
    return value;
  }

  function validateRows(data) {
    if (!Array.isArray(data) || data.length !== EXPECTED.length * SPLITS.length) {
      throw new Error(`Expected exactly 15 Jokic on/off rows; found ${data?.length ?? 0}.`);
    }

    const expectedSeasons = new Set(EXPECTED.map((row) => row.season));
    data.forEach((row) => {
      if (!expectedSeasons.has(row.season)) throw new Error(`Unexpected season identity: ${row.season || "blank"}.`);
      if (!SPLITS.includes(row.split)) throw new Error(`Unexpected split for ${row.season}: ${row.split || "blank"}.`);
      if (row.team !== "DEN") throw new Error(`Expected DEN team rows; found ${row.team || "blank"} in ${row.season}.`);
    });

    return EXPECTED.map((expected) => {
      const seasonRows = data.filter((row) => row.season === expected.season);
      const bySplit = {};
      SPLITS.forEach((split) => {
        const matches = seasonRows.filter((row) => row.split === split);
        if (matches.length !== 1) {
          throw new Error(`Expected one ${split} row for ${expected.season}; found ${matches.length}.`);
        }
        bySplit[split] = matches[0];
      });

      const onRating = numericField(bySplit.on_court, "team_ortg", `${expected.season} on court`);
      const offRating = numericField(bySplit.off_court, "team_ortg", `${expected.season} off court`);
      const gap = numericField(bySplit.on_minus_off, "team_ortg", `${expected.season} on minus off`);
      const onMinutes = numericField(bySplit.on_court, "minutes", `${expected.season} on court`, { positive: true });
      const offMinutes = numericField(bySplit.off_court, "minutes", `${expected.season} off court`, { positive: true });
      numericField(bySplit.on_minus_off, "on_court_minutes_share", `${expected.season} on minus off`);

      [bySplit.on_court, bySplit.off_court, bySplit.on_minus_off].forEach((row) => {
        if (!row.source_url || !/^https:\/\//.test(row.source_url)) {
          throw new Error(`Missing or invalid source_url for ${expected.season}, ${row.split}.`);
        }
      });

      const supplied = [onRating, offRating, gap];
      const expectedValues = [expected.on, expected.off, expected.gap];
      supplied.forEach((value, index) => {
        if (Math.abs(value - expectedValues[index]) > 0.0001) {
          throw new Error(`Unexpected offensive rating value for ${expected.season}, ${SPLITS[index]}.`);
        }
      });

      return {
        season: expected.season,
        on_court: { rating: onRating, minutes: onMinutes },
        off_court: { rating: offRating, minutes: offMinutes },
        gap,
        sourceUrl: bySplit.on_minus_off.source_url,
      };
    });
  }

  function displaySeason(season) {
    const [start, end] = season.split("-");
    return `${start.slice(2)}\u2013${end}`;
  }

  function signed(value) {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  }

  class JokicOnOffChart {
    constructor(root, data) {
      this.root = root;
      this.rows = validateRows(data);
      this.instanceId = `jokic-on-off-${++instanceCount}`;
      this.plot = root.querySelector(".jokic-on-off__plot");
      this.inspection = root.querySelector(".jokic-on-off__inspection");
      this.tableWrap = root.querySelector(".jokic-on-off__table-wrap");
      this.inspection.id = `${this.instanceId}-inspection`;
      this.selected = { seasonIndex: this.rows.length - 1, split: "on_court" };
      this.lastWidth = 0;
      this.resizeFrame = 0;
      this.bindEvents();
      this.renderTable();
      this.render(true);
      this.root.removeAttribute("aria-busy");
    }

    bindEvents() {
      ["click", "pointerover", "focusin"].forEach((eventName) => {
        this.plot.addEventListener(eventName, (event) => this.activateMark(event));
      });
      this.plot.addEventListener("keydown", (event) => this.handleKeydown(event));

      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
        this.resizeObserver.observe(this.plot);
      } else {
        this.fallbackResize = () => this.scheduleResize();
        window.addEventListener("resize", this.fallbackResize);
      }
    }

    activateMark(event) {
      const target = event.target.closest("[data-jokic-mark]");
      if (!target || !this.plot.contains(target)) return;
      this.select(Number(target.dataset.seasonIndex), target.dataset.split);
    }

    handleKeydown(event) {
      const target = event.target.closest("[data-jokic-mark]");
      if (!target) return;
      const marks = [...this.plot.querySelectorAll("[data-jokic-mark]")];
      const currentIndex = marks.indexOf(target);
      let nextIndex = currentIndex;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex += 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex -= 1;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = marks.length - 1;
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.activateMark(event);
        return;
      } else return;

      event.preventDefault();
      marks[Math.max(0, Math.min(marks.length - 1, nextIndex))].focus();
    }

    select(seasonIndex, split) {
      const row = this.rows[seasonIndex];
      if (!row || !SPLIT_LABELS[split]) return;
      this.selected = { seasonIndex, split };
      const value = row[split];
      this.inspection.textContent = `${row.season} · ${SPLIT_LABELS[split]} · ${value.rating.toFixed(1)} team points per 100 possessions · ${numberFormat.format(value.minutes)} minutes.`;
      this.plot.querySelectorAll("[data-jokic-mark]").forEach((mark) => {
        const active = Number(mark.dataset.seasonIndex) === seasonIndex && mark.dataset.split === split;
        mark.classList.toggle("is-active", active);
        mark.setAttribute("aria-pressed", String(active));
      });
    }

    scheduleResize() {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => {
        const width = Math.round(this.plot.getBoundingClientRect().width);
        if (width > 0 && width !== this.lastWidth) this.render(true);
      });
    }

    render(force = false) {
      const measuredWidth = Math.round(this.plot.getBoundingClientRect().width);
      if (measuredWidth <= 0 || (!force && measuredWidth === this.lastWidth)) return;
      this.lastWidth = measuredWidth;
      this.plot.innerHTML = this.buildSvg(measuredWidth);
      this.select(this.selected.seasonIndex, this.selected.split);
    }

    buildSvg(measuredWidth) {
      const width = Math.max(270, measuredWidth);
      const narrow = width < 420;
      const height = narrow ? 306 : 316;
      const left = narrow ? 43 : 55;
      const plotRight = width - (narrow ? 59 : 76);
      const gapX = width - (narrow ? 5 : 12);
      const axisY = 48;
      const firstRowY = 84;
      const rowGap = 46;
      const lastRowY = firstRowY + rowGap * (this.rows.length - 1);
      const x = window.d3.scaleLinear()
        .domain([100, 135])
        .range([left, plotRight]);
      const ticks = narrow
        ? [100, 110, 120, 130, 135]
        : [100, 105, 110, 115, 120, 125, 130, 135];

      const grid = ticks.map((tick) => {
        const tickX = x(tick);
        return `
          <line class="jokic-on-off__grid" x1="${tickX}" x2="${tickX}" y1="${axisY}" y2="${lastRowY + 17}"></line>
          <text class="jokic-on-off__tick" x="${tickX}" y="${axisY - 7}" text-anchor="middle">${escapeXml(tick)}</text>
        `;
      }).join("");

      const rows = this.rows.map((row, seasonIndex) => {
        const y = firstRowY + seasonIndex * rowGap;
        const offX = x(row.off_court.rating);
        const onX = x(row.on_court.rating);
        const mark = (split, pointX, modifier) => {
          const value = row[split];
          const label = `${row.season}, ${SPLIT_LABELS[split]}, team offensive rating ${value.rating.toFixed(1)}, ${numberFormat.format(value.minutes)} minutes`;
          return `
            <g class="jokic-on-off__mark jokic-on-off__mark--${modifier}" data-jokic-mark
              data-season-index="${seasonIndex}" data-split="${split}" tabindex="0" role="button"
              aria-pressed="false" aria-describedby="${this.instanceId}-inspection" aria-label="${escapeXml(label)}">
              <circle class="jokic-on-off__hit" cx="${pointX}" cy="${y}" r="22"></circle>
              <circle class="jokic-on-off__selection-ring" cx="${pointX}" cy="${y}" r="9.5"></circle>
              <circle class="jokic-on-off__dot" cx="${pointX}" cy="${y}" r="5.5"></circle>
            </g>
            <text class="jokic-on-off__value jokic-on-off__value--${modifier}" x="${pointX}" y="${y - 10}" text-anchor="middle">${value.rating.toFixed(1)}</text>
          `;
        };
        return `
          <g class="jokic-on-off__row">
            <text class="jokic-on-off__season" x="${left - 9}" y="${y + 4}" text-anchor="end">${displaySeason(row.season)}</text>
            <line class="jokic-on-off__connector" x1="${offX}" x2="${onX}" y1="${y}" y2="${y}"></line>
            ${mark("off_court", offX, "off")}
            ${mark("on_court", onX, "on")}
            <text class="jokic-on-off__gap" x="${gapX}" y="${y + 4}" text-anchor="end">${signed(row.gap)}</text>
          </g>
        `;
      }).join("");

      return `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${this.instanceId}-svg-title ${this.instanceId}-svg-desc">
          <title id="${this.instanceId}-svg-title">Denver offensive rating with and without Jokic, 2021–22 through 2025–26</title>
          <desc id="${this.instanceId}-svg-desc">Five horizontal dumbbells compare Denver's team points scored per 100 possessions with Jokic on court and off court. Every endpoint and on/off gap is labeled. The on-court rating is higher in every season; the largest gap is plus 20.1 in 2024–25.</desc>
          <text class="jokic-on-off__axis-label" x="${left}" y="13">${narrow ? "Denver points / 100 possessions" : "Denver points scored per 100 possessions"}</text>
          <text class="jokic-on-off__gap-heading" x="${gapX}" y="13" text-anchor="end">OFF. GAP</text>
          ${grid}
          <line class="jokic-on-off__axis" x1="${left}" x2="${plotRight}" y1="${axisY}" y2="${axisY}"></line>
          ${rows}
        </svg>
      `;
    }

    renderTable() {
      this.tableWrap.innerHTML = `
        <table class="jokic-on-off__table">
          <caption>Denver team offensive rating and supplied minutes during Jokic’s on/off splits</caption>
          <thead>
            <tr>
              <th scope="col">Season</th>
              <th scope="col">On rating</th>
              <th scope="col">On min.</th>
              <th scope="col">Off rating</th>
              <th scope="col">Off min.</th>
              <th scope="col">Gap</th>
            </tr>
          </thead>
          <tbody>
            ${this.rows.map((row) => `
              <tr>
                <th scope="row"><a href="${escapeHtml(row.sourceUrl)}">${escapeHtml(displaySeason(row.season))}</a></th>
                <td>${row.on_court.rating.toFixed(1)}</td>
                <td>${numberFormat.format(row.on_court.minutes)}</td>
                <td>${row.off_court.rating.toFixed(1)}</td>
                <td>${numberFormat.format(row.off_court.minutes)}</td>
                <td>${signed(row.gap)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  }

  function showError(root, error) {
    root.dataset.chartMounted = "error";
    root.removeAttribute("aria-busy");
    const plot = root.querySelector(".jokic-on-off__plot");
    const inspection = root.querySelector(".jokic-on-off__inspection");
    plot.innerHTML = '<p class="jokic-on-off__status jokic-on-off__status--error">Jokic’s on/off ratings are unavailable. Serve this repository over HTTP and reopen the card to retry.</p>';
    inspection.textContent = "The chart could not be loaded or its source data did not pass validation.";
    console.error("Jokic on/off chart could not load:", error);
  }

  async function loadChart(root) {
    if (root.dataset.chartMounted === "loading" || root.dataset.chartMounted === "true") return;
    root.dataset.chartMounted = "loading";
    root.setAttribute("aria-busy", "true");
    root.querySelector(".jokic-on-off__plot").innerHTML = '<p class="jokic-on-off__status">Loading Jokic on/off ratings…</p>';
    try {
      const response = await fetch(root.dataset.source, { cache: "no-store" });
      if (!response.ok) throw new Error(`On/off data request returned ${response.status}.`);
      const data = window.d3.csvParse(await response.text());
      const chart = new JokicOnOffChart(root, data);
      root._jokicOnOffChart = chart;
      root.dataset.chartMounted = "true";
    } catch (error) {
      showError(root, error);
    }
  }

  function initializeCharts() {
    document.querySelectorAll("[data-jokic-on-off-chart]").forEach((root) => {
      if (!window.d3) {
        showError(root, new Error("D3 is unavailable."));
        return;
      }
      const card = root.closest("details");
      const openAndLoad = () => {
        if (card && !card.open) return;
        if (root._jokicOnOffChart) root._jokicOnOffChart.scheduleResize();
        else requestAnimationFrame(() => loadChart(root));
      };
      if (card) card.addEventListener("toggle", openAndLoad);
      openAndLoad();
    });
  }

  window.validateJokicOnOffRows = validateRows;
  initializeCharts();
})();
