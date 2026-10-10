(function initializeWembyUnicornModule() {
  "use strict";

  const d3 = window.d3;
  const MIN_MINUTES = 1500;
  const WEMBY_ID = "wembavi01";
  const COMPARISON_IDS = new Set([
    WEMBY_ID,
    "gilgesh01",
    "jokicni01",
    "mobleev01",
    "thompau01",
  ]);
  const SHORT_LABELS = {
    wembavi01: "Wembanyama",
    gilgesh01: "Gilgeous-Alexander",
    jokicni01: "Jokić",
    mobleev01: "Mobley",
    thompau01: "A. Thompson",
  };
  const EXPECTED_WEMBY = {
    pointsPer100: 41.2,
    dbpm: 4.2,
    blockPct: 9.4,
    trueShootingPct: 0.626,
  };
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

  function parseRow(row) {
    return {
      playerId: row.player_id?.trim() || "",
      player: row.player?.trim() || "",
      team: row.team?.trim() || "",
      season: row.season?.trim() || "",
      minutes: Number(row.minutes),
      pointsPer100: Number(row.points_per_100),
      dbpm: Number(row.dbpm),
      blockPct: Number(row.block_pct),
      trueShootingPct: Number(row.true_shooting_pct),
      position: row.position?.trim() || "",
    };
  }

  function validateRows(rows) {
    if (!rows.length) throw new Error("The dataset is empty.");

    const numericFields = ["minutes", "pointsPer100", "dbpm", "blockPct", "trueShootingPct"];
    const identities = new Set();
    rows.forEach((row) => {
      if (!row.playerId || !row.player || !row.team) throw new Error("A player identity is incomplete.");
      if (identities.has(row.playerId)) throw new Error("The dataset contains duplicate players.");
      identities.add(row.playerId);
      if (row.season !== "2025-26") throw new Error("The dataset includes an unexpected season.");
      if (row.minutes < MIN_MINUTES) throw new Error("The dataset includes an unqualified player.");
      if (numericFields.some((field) => !Number.isFinite(row[field]))) {
        throw new Error("The dataset includes an invalid statistical value.");
      }
    });

    const wemby = rows.find((row) => row.playerId === WEMBY_ID);
    if (!wemby) throw new Error("Victor Wembanyama is missing from the dataset.");
    Object.entries(EXPECTED_WEMBY).forEach(([field, expected]) => {
      if (Math.abs(wemby[field] - expected) > 1e-9) {
        throw new Error(`Victor Wembanyama's ${field} value conflicts with the verified source.`);
      }
    });
  }

  function paddedDomain(values, minimumPadding) {
    const [minimum, maximum] = d3.extent(values);
    const padding = Math.max((maximum - minimum) * 0.07, minimumPadding);
    return [minimum - padding, maximum + padding];
  }

  function percent(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function playerDescription(row) {
    return `${row.player}, ${row.team}: ${row.pointsPer100.toFixed(1)} points per 100 possessions, ${row.dbpm.toFixed(1)} defensive box plus-minus, ${row.blockPct.toFixed(1)} percent block rate, ${percent(row.trueShootingPct)} true shooting.`;
  }

  function resolveLabelPositions(labelRows, xScale, yScale, radiusScale, plotBounds, narrow) {
    const labels = labelRows.map((row) => {
      const pointX = xScale(row.pointsPer100);
      const pointY = yScale(row.dbpm);
      const radius = radiusScale(row.blockPct);
      const name = narrow ? SHORT_LABELS[row.playerId] : row.player;
      const estimatedWidth = name.length * (narrow ? 5.8 : 6.4);
      const useLeft = pointX + radius + 12 + estimatedWidth > plotBounds.right;
      const x = useLeft ? pointX - radius - 10 : pointX + radius + 10;
      return {
        row,
        name,
        pointX,
        pointY,
        x,
        y: pointY,
        anchor: useLeft ? "end" : "start",
        left: useLeft ? x - estimatedWidth : x,
        right: useLeft ? x : x + estimatedWidth,
        fixed: row.playerId === WEMBY_ID,
      };
    });

    for (let iteration = 0; iteration < 80; iteration += 1) {
      for (let firstIndex = 0; firstIndex < labels.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < labels.length; secondIndex += 1) {
          const first = labels[firstIndex];
          const second = labels[secondIndex];
          const horizontalOverlap = first.left - 8 < second.right && first.right + 8 > second.left;
          const verticalDistance = Math.abs(first.y - second.y);
          if (!horizontalOverlap || verticalDistance >= 20) continue;

          const direction = first.y <= second.y ? -1 : 1;
          const shift = (20 - verticalDistance) / 2 + 0.35;
          if (!first.fixed) first.y += direction * shift;
          if (!second.fixed) second.y -= direction * shift;
          if (first.fixed && !second.fixed) second.y -= direction * shift;
          if (second.fixed && !first.fixed) first.y += direction * shift;
        }
      }
      labels.forEach((label) => {
        label.y = Math.max(plotBounds.top + 8, Math.min(plotBounds.bottom - 8, label.y));
      });
    }

    return labels;
  }

  class WembyUnicornChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `wemby-unicorn-${++instanceCount}`;
      this.rows = [];
      this.loadPromise = null;
      this.lastWidth = 0;
      this.renderQueued = false;
      this.pinnedPlayerId = null;
      this.activePlayerId = null;
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.chartShell = root.querySelector(".wemby-unicorn__chart-shell");
      this.status = root.querySelector(".wemby-unicorn__status");
      this.keys = root.querySelector(".wemby-unicorn__keys");
      this.tableWrap = root.querySelector(".wemby-unicorn__table-wrap");
      this.inspection = root.querySelector(".wemby-unicorn__inspection");
      this.resizeObserver = new ResizeObserver(() => this.queueRender());
      this.resizeObserver.observe(this.chartShell);
    }

    load() {
      if (this.loadPromise) return this.loadPromise;
      this.root.setAttribute("aria-busy", "true");
      this.loadPromise = d3.csv(this.root.dataset.source, parseRow)
        .then((rows) => {
          validateRows(rows);
          this.rows = rows;
          this.root.setAttribute("aria-busy", "false");
          this.renderKeys();
          this.renderTable();
          this.render(true);
        })
        .catch((error) => {
          console.error("Wembanyama chart data error:", error);
          this.root.setAttribute("aria-busy", "false");
          this.status.className = "wemby-unicorn__status wemby-unicorn__status--error";
          this.status.textContent = "The player comparison data could not be displayed. Please try reloading the page.";
        });
      return this.loadPromise;
    }

    queueRender() {
      if (!this.rows.length || this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        const width = Math.floor(this.chartShell.getBoundingClientRect().width);
        if (width > 0 && Math.abs(width - this.lastWidth) >= 2) this.render();
      });
    }

    renderKeys() {
      const [minimumTs, maximumTs] = d3.extent(this.rows, (row) => row.trueShootingPct);
      const middleTs = (minimumTs + maximumTs) / 2;
      const maximumBlockPct = d3.max(this.rows, (row) => row.blockPct);
      const colorScale = d3.scaleLinear()
        .domain([minimumTs, maximumTs])
        .range(["#dfe5e8", "#1d2429"])
        .interpolate(d3.interpolateRgb.gamma(2.2));
      const gradientId = `${this.instanceId}-ts-gradient`;
      const legendValues = [2, 6, maximumBlockPct];
      const legendRadius = (value) => 15 * Math.sqrt(value / maximumBlockPct);
      const circleXs = [28, 103, 196];

      this.keys.innerHTML = `
        <div class="wemby-unicorn__key">
          <span class="wemby-unicorn__key-title">Color · True shooting percentage</span>
          <svg class="wemby-unicorn__color-ramp" viewBox="0 0 190 10" role="img" aria-label="True shooting percentage from ${percent(minimumTs)} to ${percent(maximumTs)}">
            <defs>
              <linearGradient id="${gradientId}" x1="0%" x2="100%" y1="0%" y2="0%">
                <stop offset="0%" stop-color="${colorScale(minimumTs)}"></stop>
                <stop offset="100%" stop-color="${colorScale(maximumTs)}"></stop>
              </linearGradient>
            </defs>
            <rect width="190" height="10" rx="5" fill="url(#${gradientId})"></rect>
          </svg>
          <span class="wemby-unicorn__color-ticks"><span>${percent(minimumTs)}</span><span>${percent(middleTs)}</span><span>${percent(maximumTs)}</span></span>
        </div>
        <div class="wemby-unicorn__key">
          <span class="wemby-unicorn__key-title">Bubble area · Block percentage</span>
          <svg class="wemby-unicorn__size-key" viewBox="0 0 230 48" role="img" aria-label="Bubble area examples for block percentage">
            ${legendValues.map((value, index) => `<circle cx="${circleXs[index]}" cy="17" r="${legendRadius(value).toFixed(2)}"></circle><text x="${circleXs[index]}" y="46">${value.toFixed(1)}%</text>`).join("")}
          </svg>
        </div>`;
    }

    renderTable() {
      const sortedRows = [...this.rows].sort((a, b) => d3.descending(a.pointsPer100, b.pointsPer100));
      this.tableWrap.innerHTML = `
        <table class="wemby-unicorn__table">
          <caption class="wemby-unicorn__visually-hidden">All ${sortedRows.length} qualified players and the values plotted in the Wembanyama unicorn chart</caption>
          <thead><tr><th scope="col">Player</th><th scope="col">Team</th><th scope="col">Minutes</th><th scope="col">PTS/100</th><th scope="col">DBPM</th><th scope="col">BLK%</th><th scope="col">TS%</th></tr></thead>
          <tbody>${sortedRows.map((row) => `
            <tr${row.playerId === WEMBY_ID ? " data-wemby-row" : ""}>
              <th scope="row">${escapeHtml(row.player)}</th>
              <td>${escapeHtml(row.team)}</td>
              <td>${row.minutes.toLocaleString("en-US")}</td>
              <td>${row.pointsPer100.toFixed(1)}</td>
              <td>${row.dbpm.toFixed(1)}</td>
              <td>${row.blockPct.toFixed(1)}%</td>
              <td>${percent(row.trueShootingPct)}</td>
            </tr>`).join("")}</tbody>
        </table>`;
    }

    render(force = false) {
      const measuredWidth = Math.floor(this.chartShell.getBoundingClientRect().width);
      if (measuredWidth <= 0) return;
      if (!force && measuredWidth === this.lastWidth) return;
      this.lastWidth = measuredWidth;
      const narrow = measuredWidth < 560;
      const width = Math.max(296, measuredWidth);
      const height = narrow ? 570 : 540;
      const margin = narrow
        ? { top: 22, right: 14, bottom: 82, left: 52 }
        : { top: 22, right: 28, bottom: 72, left: 66 };
      const plotBounds = {
        left: margin.left,
        right: width - margin.right,
        top: margin.top,
        bottom: height - margin.bottom,
      };

      this.chartShell.replaceChildren();
      const tooltip = document.createElement("div");
      tooltip.className = "wemby-unicorn__tooltip";
      tooltip.hidden = true;
      tooltip.id = `${this.instanceId}-tooltip`;
      this.chartShell.append(tooltip);
      this.tooltip = tooltip;

      const svg = d3.select(this.chartShell)
        .append("svg")
        .attr("class", "wemby-unicorn__svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", `${this.instanceId}-title ${this.instanceId}-description`);
      svg.append("title")
        .attr("id", `${this.instanceId}-title`)
        .text("Wembanyama's Unicorn Case");
      svg.append("desc")
        .attr("id", `${this.instanceId}-description`)
        .text(`Scatter plot of ${this.rows.length} NBA players with at least 1,500 minutes in 2025-26. Horizontal position is points per 100 possessions, vertical position is defensive box plus-minus, color is true shooting percentage, and bubble area is block percentage. Victor Wembanyama is highlighted.`);

      const clipId = `${this.instanceId}-plot-clip`;
      svg.append("defs")
        .append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("x", plotBounds.left)
        .attr("y", plotBounds.top)
        .attr("width", plotBounds.right - plotBounds.left)
        .attr("height", plotBounds.bottom - plotBounds.top);

      const xScale = d3.scaleLinear()
        .domain(paddedDomain(this.rows.map((row) => row.pointsPer100), 0.8))
        .nice()
        .range([plotBounds.left, plotBounds.right]);
      const yScale = d3.scaleLinear()
        .domain(paddedDomain(this.rows.map((row) => row.dbpm), 0.35))
        .nice()
        .range([plotBounds.bottom, plotBounds.top]);
      const [minimumTs, maximumTs] = d3.extent(this.rows, (row) => row.trueShootingPct);
      const colorScale = d3.scaleLinear()
        .domain([minimumTs, maximumTs])
        .range(["#dfe5e8", "#1d2429"])
        .interpolate(d3.interpolateRgb.gamma(2.2));
      const maximumBlockPct = d3.max(this.rows, (row) => row.blockPct);
      const maximumRadius = narrow ? 12.5 : 16;
      const radiusScale = (value) => maximumRadius * Math.sqrt(value / maximumBlockPct);

      const xTicks = xScale.ticks(narrow ? 5 : 8);
      const yTicks = yScale.ticks(narrow ? 6 : 8);
      const grid = svg.append("g").attr("class", "wemby-unicorn__grid");
      grid.selectAll("line.x-grid")
        .data(xTicks)
        .join("line")
        .attr("x1", (tick) => xScale(tick))
        .attr("x2", (tick) => xScale(tick))
        .attr("y1", plotBounds.top)
        .attr("y2", plotBounds.bottom);
      grid.selectAll("line.y-grid")
        .data(yTicks)
        .join("line")
        .attr("x1", plotBounds.left)
        .attr("x2", plotBounds.right)
        .attr("y1", (tick) => yScale(tick))
        .attr("y2", (tick) => yScale(tick));
      if (yScale.domain()[0] <= 0 && yScale.domain()[1] >= 0) {
        svg.append("line")
          .attr("class", "wemby-unicorn__zero-line")
          .attr("x1", plotBounds.left)
          .attr("x2", plotBounds.right)
          .attr("y1", yScale(0))
          .attr("y2", yScale(0));
      }

      svg.append("g")
        .attr("class", "wemby-unicorn__axis")
        .attr("transform", `translate(0,${plotBounds.bottom})`)
        .call(d3.axisBottom(xScale).ticks(narrow ? 5 : 8).tickSizeOuter(0));
      svg.append("g")
        .attr("class", "wemby-unicorn__axis")
        .attr("transform", `translate(${plotBounds.left},0)`)
        .call(d3.axisLeft(yScale).ticks(narrow ? 6 : 8).tickSizeOuter(0));
      svg.append("text")
        .attr("class", "wemby-unicorn__axis-title")
        .attr("x", (plotBounds.left + plotBounds.right) / 2)
        .attr("y", height - 18)
        .attr("text-anchor", "middle")
        .text("Points per 100 possessions");
      svg.append("text")
        .attr("class", "wemby-unicorn__axis-title")
        .attr("transform", `translate(15 ${(plotBounds.top + plotBounds.bottom) / 2}) rotate(-90)`)
        .attr("text-anchor", "middle")
        .text("Defensive box plus/minus (DBPM)");
      svg.append("text")
        .attr("class", "wemby-unicorn__axis-note")
        .attr("x", plotBounds.left)
        .attr("y", height - 47)
        .text("DBPM is a box-score-based defensive estimate.");

      const orderedRows = [...this.rows].sort((a, b) => {
        if (a.playerId === WEMBY_ID) return 1;
        if (b.playerId === WEMBY_ID) return -1;
        return Number(COMPARISON_IDS.has(a.playerId)) - Number(COMPARISON_IDS.has(b.playerId));
      });
      const pointsLayer = svg.append("g").attr("clip-path", `url(#${clipId})`);
      pointsLayer.selectAll("circle.wemby-unicorn__point")
        .data(orderedRows, (row) => row.playerId)
        .join("circle")
        .attr("class", (row) => `wemby-unicorn__point${row.playerId === WEMBY_ID ? " wemby-unicorn__point--wemby" : COMPARISON_IDS.has(row.playerId) ? " wemby-unicorn__point--comparison" : ""}`)
        .attr("cx", (row) => xScale(row.pointsPer100))
        .attr("cy", (row) => yScale(row.dbpm))
        .attr("r", (row) => radiusScale(row.blockPct))
        .attr("fill", (row) => colorScale(row.trueShootingPct))
        .attr("fill-opacity", (row) => COMPARISON_IDS.has(row.playerId) ? 1 : 0.72)
        .attr("stroke", (row) => COMPARISON_IDS.has(row.playerId) ? null : "rgba(15, 20, 23, 0.28)")
        .attr("stroke-width", (row) => COMPARISON_IDS.has(row.playerId) ? null : 0.8);

      const wemby = this.rows.find((row) => row.playerId === WEMBY_ID);
      const wembyX = xScale(wemby.pointsPer100);
      const wembyY = yScale(wemby.dbpm);
      const wembyRadius = radiusScale(wemby.blockPct);
      const highlightLayer = svg.append("g")
        .attr("class", "wemby-unicorn__highlight")
        .attr("aria-hidden", "true")
        .attr("transform", `translate(${wembyX},${wembyY})`);
      highlightLayer.append("circle")
        .attr("class", "wemby-unicorn__highlight-gap")
        .attr("r", wembyRadius + 3);
      highlightLayer.append("circle")
        .attr("class", "wemby-unicorn__highlight-ring")
        .attr("r", wembyRadius + 6);

      const labelRows = this.rows.filter((row) => COMPARISON_IDS.has(row.playerId));
      const labels = resolveLabelPositions(labelRows, xScale, yScale, radiusScale, plotBounds, narrow);
      const labelsLayer = svg.append("g").attr("aria-hidden", "true");
      labelsLayer.selectAll("line")
        .data(labels)
        .join("line")
        .attr("class", (label) => `wemby-unicorn__label-line${label.row.playerId === WEMBY_ID ? " wemby-unicorn__label-line--wemby" : ""}`)
        .attr("x1", (label) => label.pointX)
        .attr("y1", (label) => label.pointY)
        .attr("x2", (label) => label.x + (label.anchor === "start" ? -3 : 3))
        .attr("y2", (label) => label.y);
      labelsLayer.selectAll("text")
        .data(labels)
        .join("text")
        .attr("class", (label) => `wemby-unicorn__label${label.row.playerId === WEMBY_ID ? " wemby-unicorn__label--wemby" : ""}`)
        .attr("x", (label) => label.x)
        .attr("y", (label) => label.y + 4)
        .attr("text-anchor", (label) => label.anchor)
        .text((label) => label.name);

      const hitLayer = svg.append("g");
      hitLayer.selectAll("circle")
        .data(orderedRows, (row) => row.playerId)
        .join("circle")
        .attr("class", "wemby-unicorn__hit-target")
        .attr("cx", (row) => xScale(row.pointsPer100))
        .attr("cy", (row) => yScale(row.dbpm))
        .attr("r", (row) => Math.max(17, radiusScale(row.blockPct) + 5))
        .attr("fill", "transparent")
        .attr("stroke", "transparent")
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", playerDescription)
        .attr("aria-describedby", `${this.instanceId}-inspection`)
        .on("pointerenter", (event, row) => this.activate(row, event.currentTarget, width, height))
        .on("pointerleave", (event, row) => {
          if (this.pinnedPlayerId !== row.playerId) this.deactivate();
        })
        .on("focus", (event, row) => this.activate(row, event.currentTarget, width, height))
        .on("blur", (event, row) => {
          if (this.pinnedPlayerId !== row.playerId) this.deactivate();
        })
        .on("click", (event, row) => {
          event.preventDefault();
          this.pinnedPlayerId = this.pinnedPlayerId === row.playerId ? null : row.playerId;
          if (this.pinnedPlayerId) this.activate(row, event.currentTarget, width, height);
          else this.deactivate();
        })
        .on("keydown", (event, row) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.pinnedPlayerId = this.pinnedPlayerId === row.playerId ? null : row.playerId;
            if (this.pinnedPlayerId) this.activate(row, event.currentTarget, width, height);
            else this.deactivate();
          } else if (event.key === "Escape") {
            this.pinnedPlayerId = null;
            this.deactivate();
            event.currentTarget.blur();
          }
        });

      this.svgNode = svg.node();
      this.inspection.id = `${this.instanceId}-inspection`;
      this.status = null;
    }

    activate(row, target, viewBoxWidth, viewBoxHeight) {
      this.activePlayerId = row.playerId;
      const cx = Number(target.getAttribute("cx"));
      const cy = Number(target.getAttribute("cy"));
      const svgBox = this.svgNode.getBoundingClientRect();
      const shellBox = this.chartShell.getBoundingClientRect();
      const left = ((cx / viewBoxWidth) * svgBox.width) + svgBox.left - shellBox.left;
      const top = ((cy / viewBoxHeight) * svgBox.height) + svgBox.top - shellBox.top;
      this.tooltip.innerHTML = `<strong>${escapeHtml(row.player)}</strong><span>${escapeHtml(row.team)} · ${row.minutes.toLocaleString("en-US")} minutes</span><span>${row.pointsPer100.toFixed(1)} PTS/100 · ${row.dbpm.toFixed(1)} DBPM</span><span>${row.blockPct.toFixed(1)}% BLK · ${percent(row.trueShootingPct)} TS</span>`;
      this.tooltip.hidden = false;
      this.tooltip.style.left = `${Math.max(0, Math.min(shellBox.width - 220, left))}px`;
      this.tooltip.style.top = `${Math.max(30, Math.min(shellBox.height - 30, top))}px`;
      this.inspection.textContent = playerDescription(row);
    }

    deactivate() {
      this.activePlayerId = null;
      this.tooltip.hidden = true;
      this.inspection.textContent = "Focus, hover, or tap a bubble for exact player values.";
    }
  }

  function initializeCharts() {
    if (!d3) {
      document.querySelectorAll("[data-wemby-unicorn-chart]").forEach((root) => {
        const status = root.querySelector(".wemby-unicorn__status");
        status.className = "wemby-unicorn__status wemby-unicorn__status--error";
        status.textContent = "The chart library could not be loaded. Please try reloading the page.";
      });
      return;
    }

    document.querySelectorAll("[data-wemby-unicorn-chart]").forEach((root) => {
      const chart = new WembyUnicornChart(root);
      const card = root.closest("details");
      const loadWhenVisible = () => {
        if (!card || card.open) requestAnimationFrame(() => chart.load());
      };
      if (card) card.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  initializeCharts();
})();
