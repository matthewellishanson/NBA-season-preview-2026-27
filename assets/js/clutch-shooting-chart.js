(function () {
  "use strict";

  const d3 = window.d3;
  const BRUNSON_ID = "brunsja01";
  const LABEL_PRIORITIES = {
    playoffs: ["brunsja01", "leonaka01", "onealsh01", "butleji01", "iversal01", "paulch01", "curryst01"],
    regular_season: ["brunsja01", "curryst01", "jamesle01", "howardw01", "onealsh01", "boozeca01"],
  };
  const VIEW_CONFIG = {
    playoffs: {
      label: "Playoffs",
      subtitle: "25 qualifying players · Minimum 100 clutch attempts",
      yDomain: [0.28, 0.56],
      yTicks: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55],
    },
    regular_season: {
      label: "Regular season",
      subtitle: "Top 25 qualifying players by eFG% · Minimum 300 clutch attempts",
      yDomain: [0.5, 0.61],
      yTicks: [0.5, 0.52, 0.54, 0.56, 0.58, 0.6],
    },
  };
  let instanceCount = 0;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function percent(value) {
    return value == null ? "Undefined" : `${(value * 100).toFixed(1)}%`;
  }

  function parseRow(row) {
    const parsed = {
      view: row.view,
      sourceRank: Number(row.source_rank),
      playerId: row.player_id,
      playerName: row.player_name,
      games: Number(row.games),
      fg: Number(row.fg),
      fga: Number(row.fga),
      fgPct: Number(row.fg_pct),
      fg3: Number(row.fg3),
      fg3a: Number(row.fg3a),
      fg3Pct: row.fg3_pct === "" ? null : Number(row.fg3_pct),
      efgPct: Number(row.efg_pct),
      assistedMakes: Number(row.assisted_makes),
      assistedShare: Number(row.assisted_share),
      unassistedMakes: Number(row.unassisted_makes),
      unassistedShare: Number(row.unassisted_share),
    };
    const numericValues = Object.entries(parsed).filter(([key]) => !["view", "playerId", "playerName", "fg3Pct"].includes(key));
    if (!parsed.playerId || !parsed.playerName || numericValues.some(([, value]) => !Number.isFinite(value))) {
      throw new Error("The normalized clutch-shooting data has an invalid row.");
    }
    if (parsed.fg3Pct != null && !Number.isFinite(parsed.fg3Pct)) {
      throw new Error("The normalized clutch-shooting data has an invalid 3-point percentage.");
    }
    return parsed;
  }

  function playerDescription(row) {
    const threePct = row.fg3Pct == null ? "3-point percentage undefined because he attempted no threes" : `${percent(row.fg3Pct)} from three`;
    return `${row.playerName}, source rank ${row.sourceRank}. ${row.games} games. ${row.fg} of ${row.fga} field goals, ${percent(row.fgPct)}. ${row.fg3} of ${row.fg3a} three-pointers, ${threePct}. ${percent(row.efgPct)} effective field-goal percentage. ${percent(row.assistedShare)} of made baskets assisted and ${percent(row.unassistedShare)} unassisted.`;
  }

  function paddedDomain(values, fraction) {
    const [minimum, maximum] = d3.extent(values);
    const span = maximum - minimum || Math.abs(maximum) || 1;
    const padding = span * fraction;
    return [minimum - padding, maximum + padding];
  }

  function overlapArea(a, b) {
    const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return width * height;
  }

  function shortName(name, narrow) {
    if (!narrow) return name;
    const parts = name.split(" ");
    return parts.length > 1 ? parts.at(-1) : name;
  }

  function resolveLabels(rows, view, x, y, bounds, narrow) {
    const byId = new Map(rows.map((row) => [row.playerId, row]));
    const placed = [];
    const candidates = [
      { dx: 11, dy: -11, anchor: "start" },
      { dx: 11, dy: 15, anchor: "start" },
      { dx: -11, dy: -11, anchor: "end" },
      { dx: -11, dy: 15, anchor: "end" },
      { dx: 13, dy: 2, anchor: "start" },
      { dx: -13, dy: 2, anchor: "end" },
      { dx: 0, dy: -17, anchor: "middle" },
      { dx: 0, dy: 21, anchor: "middle" },
    ];

    return LABEL_PRIORITIES[view]
      .map((playerId) => byId.get(playerId))
      .filter(Boolean)
      .map((row) => {
        const name = shortName(row.playerName, narrow);
        const pointX = x(row.fga);
        const pointY = y(row.efgPct);
        const width = Math.max(34, name.length * (narrow ? 6.1 : 7));
        const height = 15;
        let best = null;

        if (view === "playoffs" && row.playerId === "iversal01") {
          const labelX = Math.min(bounds.right - width, pointX + 12);
          const labelY = Math.min(bounds.bottom - 7, pointY + 31);
          const box = { left: labelX - 4, right: labelX + width + 4, top: labelY - 13, bottom: labelY + 6 };
          best = { row, name, pointX, pointY, x: labelX, y: labelY, anchor: "start", box, score: 0 };
          placed.push(best);
          return best;
        }

        if (view === "regular_season" && row.playerId === BRUNSON_ID) {
          const labelX = Math.min(bounds.right - width, pointX + (narrow ? 62 : 86));
          const labelY = Math.min(bounds.bottom - 7, pointY + (narrow ? 27 : 32));
          const box = { left: labelX - 4, right: labelX + width + 4, top: labelY - 13, bottom: labelY + 6 };
          best = { row, name, pointX, pointY, x: labelX, y: labelY, anchor: "start", box, score: 0, displaced: true };
          placed.push(best);
          return best;
        }

        for (const candidate of candidates) {
          let labelX = pointX + candidate.dx;
          const labelY = Math.max(bounds.top + 10, Math.min(bounds.bottom - 7, pointY + candidate.dy));
          if (candidate.anchor === "start") labelX = Math.min(labelX, bounds.right - width);
          if (candidate.anchor === "end") labelX = Math.max(labelX, bounds.left + width);
          if (candidate.anchor === "middle") labelX = Math.max(bounds.left + width / 2, Math.min(bounds.right - width / 2, labelX));
          const left = candidate.anchor === "start" ? labelX : candidate.anchor === "end" ? labelX - width : labelX - width / 2;
          const box = { left: left - 4, right: left + width + 4, top: labelY - 13, bottom: labelY + 6 };
          const score = placed.reduce((total, label) => total + overlapArea(box, label.box), 0);
          if (!best || score < best.score) best = { row, name, pointX, pointY, x: labelX, y: labelY, anchor: candidate.anchor, box, score };
          if (score === 0) break;
        }
        placed.push(best);
        return best;
      });
  }

  class ClutchShootingChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `clutch-shooting-${++instanceCount}`;
      this.source = root.dataset.source;
      this.activeView = root.dataset.activeView || "playoffs";
      this.plot = root.querySelector(".clutch-shooting__plot");
      this.inspection = root.querySelector(".clutch-shooting__inspection");
      this.callout = root.querySelector(".clutch-shooting__callout");
      this.subtitle = root.querySelector(".clutch-shooting__subtitle");
      this.tableWrap = root.querySelector(".clutch-shooting__table-wrap");
      this.buttons = [...root.querySelectorAll("[data-clutch-view]")];
      this.rows = [];
      this.loaded = false;
      this.loading = false;
      this.selectedPlayerId = null;
      this.renderQueued = false;
      this.prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

      this.buttons.forEach((button) => {
        button.addEventListener("click", () => this.setView(button.dataset.clutchView));
      });
      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(() => this.queueRender());
        this.resizeObserver.observe(this.plot);
      } else {
        this.windowResize = () => this.queueRender();
        addEventListener("resize", this.windowResize, { passive: true });
      }
    }

    async load() {
      if (this.loaded || this.loading) return;
      this.loading = true;
      try {
        const response = await fetch(this.source, { cache: "no-store" });
        if (!response.ok) throw new Error(`Data request failed (${response.status}).`);
        const rows = d3.csvParse(await response.text(), parseRow);
        const groups = d3.group(rows, (row) => row.view);
        if (rows.length !== 50 || groups.get("playoffs")?.length !== 25 || groups.get("regular_season")?.length !== 25) {
          throw new Error("The normalized file must contain 25 players in each view.");
        }
        for (const viewRows of groups.values()) {
          if (new Set(viewRows.map((row) => row.playerId)).size !== viewRows.length) {
            throw new Error("Player IDs must be unique within each view.");
          }
        }
        this.rows = rows;
        for (const [view, config] of Object.entries(VIEW_CONFIG)) {
          const outsideDomain = groups.get(view).some((row) => row.efgPct < config.yDomain[0] || row.efgPct > config.yDomain[1]);
          if (outsideDomain) throw new Error(`${config.label} contains an eFG% outside its configured Y domain.`);
        }
        this.loaded = true;
        this.loading = false;
        this.root.setAttribute("aria-busy", "false");
        this.update();
      } catch (error) {
        this.loading = false;
        this.root.setAttribute("aria-busy", "false");
        this.plot.innerHTML = `<p class="clutch-shooting__status clutch-shooting__status--error">The clutch-shooting chart could not load. ${escapeHtml(error.message)}</p>`;
        this.inspection.textContent = "Chart data unavailable.";
      }
    }

    setView(view) {
      if (!this.loaded || view === this.activeView || !["playoffs", "regular_season"].includes(view)) return;
      this.activeView = view;
      this.root.dataset.activeView = view;
      this.selectedPlayerId = null;
      this.update();
    }

    update() {
      this.buttons.forEach((button) => {
        const active = button.dataset.clutchView === this.activeView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      const brunson = this.viewRows().find((row) => row.playerId === BRUNSON_ID);
      const config = VIEW_CONFIG[this.activeView];
      this.subtitle.textContent = config.subtitle;
      this.callout.innerHTML = `
        <strong>Jalen Brunson · ${config.label}</strong>
        <span><b>${percent(brunson.efgPct)}</b> eFG</span>
        <span><b>${brunson.fga.toLocaleString("en-US")}</b> attempts</span>
        <span><b>${percent(brunson.unassistedShare)}</b> of made baskets unassisted</span>
      `;
      this.inspection.textContent = "Focus, hover, or tap any point for its complete shooting line.";
      this.renderTable();
      this.render();
    }

    viewRows() {
      return this.rows.filter((row) => row.view === this.activeView);
    }

    queueRender() {
      if (!this.loaded || this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render();
      });
    }

    renderTable() {
      const label = VIEW_CONFIG[this.activeView].label;
      const rows = this.viewRows()
        .map((row) => `
          <tr${row.playerId === BRUNSON_ID ? ' data-brunson-row="true"' : ""}>
            <td>${row.sourceRank}</td>
            <th scope="row">${escapeHtml(row.playerName)}</th>
            <td>${row.games}</td>
            <td>${row.fg}/${row.fga}</td>
            <td>${percent(row.fgPct)}</td>
            <td>${row.fg3}/${row.fg3a}</td>
            <td>${row.fg3Pct == null ? '<span class="clutch-shooting__undefined">Undefined</span>' : percent(row.fg3Pct)}</td>
            <td>${percent(row.efgPct)}</td>
            <td>${percent(row.assistedShare)}</td>
            <td>${percent(row.unassistedShare)}</td>
          </tr>`)
        .join("");
      this.tableWrap.innerHTML = `
        <table class="clutch-shooting__table">
          <caption>${label}: selected top 25 in supplied eFG% rank order. Assisted and unassisted percentages are shares of made baskets.</caption>
          <thead><tr><th scope="col">Rk</th><th scope="col">Player</th><th scope="col">G</th><th scope="col">FG/FGA</th><th scope="col">FG%</th><th scope="col">3P/3PA</th><th scope="col">3P%</th><th scope="col">eFG%</th><th scope="col">Assisted</th><th scope="col">Unassisted</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    render() {
      if (!this.loaded) return;
      const width = Math.floor(this.plot.getBoundingClientRect().width);
      if (width < 240) return;
      const narrow = width < 520;
      const height = narrow ? 440 : 510;
      const margin = narrow
        ? { top: 24, right: 14, bottom: 62, left: 52 }
        : { top: 32, right: 26, bottom: 66, left: 64 };
      const bounds = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom };
      const rows = this.viewRows();
      const config = VIEW_CONFIG[this.activeView];
      const x = d3.scaleLinear().domain(paddedDomain(rows.map((row) => row.fga), 0.06)).range([bounds.left, bounds.right]);
      const y = d3.scaleLinear().domain(config.yDomain).range([bounds.bottom, bounds.top]);
      const xTicks = x.ticks(narrow ? 4 : 6);
      const yTicks = config.yTicks;
      const viewLabel = this.activeView === "playoffs" ? "playoff" : "regular-season";

      this.plot.replaceChildren();
      const svg = d3
        .select(this.plot)
        .append("svg")
        .attr("class", "clutch-shooting__svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "group")
        .attr("aria-labelledby", `${this.instanceId}-svg-title ${this.instanceId}-svg-desc`);
      svg.append("title").attr("id", `${this.instanceId}-svg-title`).text(`Brunson among the ${viewLabel} clutch-shooting leaders`);
      svg
        .append("desc")
        .attr("id", `${this.instanceId}-svg-desc`)
        .text(`Scatterplot of 25 selected players. The horizontal axis is cumulative clutch field-goal attempts and the vertical axis is clutch effective field-goal percentage. Jalen Brunson is highlighted in orange and labeled. Use the focusable points or data table for exact values.`);

      const grid = svg.append("g").attr("class", "clutch-shooting__grid").attr("aria-hidden", "true");
      grid.selectAll("line.x-grid").data(xTicks).join("line").attr("x1", x).attr("x2", x).attr("y1", bounds.top).attr("y2", bounds.bottom);
      grid.selectAll("line.y-grid").data(yTicks).join("line").attr("x1", bounds.left).attr("x2", bounds.right).attr("y1", y).attr("y2", y);

      svg
        .append("g")
        .attr("class", "clutch-shooting__axis")
        .attr("transform", `translate(0,${bounds.bottom})`)
        .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d3.format(",d")).tickSizeOuter(0).tickPadding(7));
      svg
        .append("g")
        .attr("class", "clutch-shooting__axis")
        .attr("transform", `translate(${bounds.left},0)`)
        .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(d3.format(".0%")).tickSizeOuter(0).tickPadding(7));

      svg
        .append("text")
        .attr("class", "clutch-shooting__axis-title")
        .attr("x", (bounds.left + bounds.right) / 2)
        .attr("y", height - 17)
        .attr("text-anchor", "middle")
        .text("Cumulative clutch field-goal attempts");
      svg
        .append("text")
        .attr("class", "clutch-shooting__axis-title")
        .attr("transform", `translate(15 ${(bounds.top + bounds.bottom) / 2}) rotate(-90)`)
        .attr("text-anchor", "middle")
        .text("Clutch effective field-goal percentage");

      const pointLayer = svg.append("g").attr("aria-hidden", "true");
      pointLayer
        .selectAll("circle")
        .data(rows, (row) => row.playerId)
        .join("circle")
        .attr("class", (row) => `clutch-shooting__point${row.playerId === BRUNSON_ID ? " clutch-shooting__point--brunson" : ""}`)
        .attr("cx", (row) => x(row.fga))
        .attr("cy", (row) => y(row.efgPct))
        .attr("r", 5.5);
      const brunson = rows.find((row) => row.playerId === BRUNSON_ID);
      pointLayer
        .append("circle")
        .attr("class", "clutch-shooting__brunson-ring")
        .attr("cx", x(brunson.fga))
        .attr("cy", y(brunson.efgPct))
        .attr("r", 9.5);

      const labels = resolveLabels(rows, this.activeView, x, y, bounds, narrow);
      const labelLayer = svg.append("g").attr("class", "clutch-shooting__labels").attr("aria-hidden", "true");
      labelLayer
        .selectAll("line")
        .data(labels)
        .join("line")
        .attr("class", (label) => `clutch-shooting__leader${label.row.playerId === BRUNSON_ID ? " clutch-shooting__leader--brunson" : ""}${label.displaced ? " clutch-shooting__leader--displaced" : ""}`)
        .attr("x1", (label) => label.pointX)
        .attr("y1", (label) => label.pointY)
        .attr("x2", (label) => label.x + (label.anchor === "start" ? -3 : label.anchor === "end" ? 3 : 0))
        .attr("y2", (label) => label.y - 4);
      labelLayer
        .selectAll("text")
        .data(labels)
        .join("text")
        .attr("class", (label) => `clutch-shooting__label${label.row.playerId === BRUNSON_ID ? " clutch-shooting__label--brunson" : ""}${label.displaced ? " clutch-shooting__label--displaced" : ""}`)
        .attr("x", (label) => label.x)
        .attr("y", (label) => label.y)
        .attr("text-anchor", (label) => label.anchor)
        .text((label) => label.name);

      const targetLayer = svg.append("g").attr("class", "clutch-shooting__targets");
      const targets = targetLayer
        .selectAll("circle")
        .data(rows, (row) => row.playerId)
        .join("circle")
        .attr("class", "clutch-shooting__target")
        .attr("cx", (row) => x(row.fga))
        .attr("cy", (row) => y(row.efgPct))
        .attr("r", narrow ? 22 : 17)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-pressed", "false")
        .attr("aria-label", playerDescription)
        .on("pointerenter focus", (event, row) => this.activate(row, event.currentTarget, width, height))
        .on("pointerleave blur", (event, row) => {
          if (this.selectedPlayerId !== row.playerId) this.deactivate();
        })
        .on("click", (event, row) => {
          event.preventDefault();
          this.toggleSelection(row, event.currentTarget, width, height, targets);
        })
        .on("keydown", (event, row) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.toggleSelection(row, event.currentTarget, width, height, targets);
          }
          if (event.key === "Escape") {
            this.selectedPlayerId = null;
            targets.attr("aria-pressed", "false");
            this.deactivate();
            event.currentTarget.blur();
          }
        });

      this.tooltip = document.createElement("div");
      this.tooltip.className = "clutch-shooting__tooltip";
      this.tooltip.hidden = true;
      this.tooltip.setAttribute("aria-hidden", "true");
      this.plot.append(this.tooltip);
      this.svgNode = svg.node();
    }

    toggleSelection(row, target, width, height, targets) {
      this.selectedPlayerId = this.selectedPlayerId === row.playerId ? null : row.playerId;
      targets.attr("aria-pressed", (targetRow) => String(targetRow.playerId === this.selectedPlayerId));
      if (this.selectedPlayerId) this.activate(row, target, width, height);
      else this.deactivate();
    }

    activate(row, target, viewBoxWidth, viewBoxHeight) {
      const cx = Number(target.getAttribute("cx"));
      const cy = Number(target.getAttribute("cy"));
      const svgBox = this.svgNode.getBoundingClientRect();
      const plotBox = this.plot.getBoundingClientRect();
      const left = (cx / viewBoxWidth) * svgBox.width + svgBox.left - plotBox.left;
      const top = (cy / viewBoxHeight) * svgBox.height + svgBox.top - plotBox.top;
      const threePct = row.fg3Pct == null ? "Undefined (0 attempts)" : percent(row.fg3Pct);
      this.tooltip.innerHTML = `
        <strong>${escapeHtml(row.playerName)} <span>· Rk ${row.sourceRank}</span></strong>
        <span>${row.games} games · FG ${row.fg}/${row.fga} (${percent(row.fgPct)})</span>
        <span>3P ${row.fg3}/${row.fg3a} (${threePct}) · eFG ${percent(row.efgPct)}</span>
        <span>Made baskets: ${percent(row.assistedShare)} assisted · ${percent(row.unassistedShare)} unassisted</span>`;
      this.tooltip.hidden = false;
      this.tooltip.style.left = `${Math.max(4, Math.min(plotBox.width - Math.min(278, plotBox.width - 8), left + 10))}px`;
      this.tooltip.style.top = `${Math.max(6, Math.min(plotBox.height - 116, top - 56))}px`;
      this.inspection.textContent = playerDescription(row);
    }

    deactivate() {
      if (this.tooltip) this.tooltip.hidden = true;
      this.inspection.textContent = "Focus, hover, or tap any point for its complete shooting line.";
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-clutch-shooting-chart]");
    if (!d3) {
      roots.forEach((root) => {
        root.setAttribute("aria-busy", "false");
        root.querySelector(".clutch-shooting__plot").innerHTML = '<p class="clutch-shooting__status clutch-shooting__status--error">The chart library could not load.</p>';
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.clutchInitialized === "true") return;
      root.dataset.clutchInitialized = "true";
      const chart = new ClutchShootingChart(root);
      const card = root.closest("details.team-card");
      const openAndLoad = () => {
        if (!card || card.open) {
          if (chart.loaded) chart.queueRender();
          else chart.load();
        }
      };
      if (card) card.addEventListener("toggle", openAndLoad);
      openAndLoad();
    });
  }

  initialize();
})();
