(() => {
  "use strict";

  const d3 = window.d3;
  const displaySeason = (season) => season.replace("-", "–");
  const shortSeason = (season) => `${season.slice(2, 4)}–${season.slice(5, 7)}`;
  const percent = (value) => `${(value * 100).toFixed(1)}%`;
  const ordinal = (value) => {
    const number = Number(value);
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    return `${number}${({ 1: "st", 2: "nd", 3: "rd" })[number % 10] || "th"}`;
  };
  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  let chartInstance = 0;

  function paddedDomain(values, ratio = 0.06) {
    const [minimum, maximum] = d3.extent(values);
    const span = maximum - minimum || Math.max(Math.abs(maximum), 1);
    const padding = span * ratio;
    return [minimum - padding, maximum + padding];
  }

  function theme(root) {
    const styles = getComputedStyle(root);
    return {
      ink: styles.getPropertyValue("--team-ink").trim() || "#69522a",
      identity: styles.getPropertyValue("--team-identity").trim() || "#b4975a",
      secondary: styles.getPropertyValue("--team-secondary").trim() || "#0c2340",
      muted: styles.getPropertyValue("--team-muted").trim() || "#4c5260",
      comparison: styles.getPropertyValue("--team-comparison").trim() || "#565b65",
      plot: styles.getPropertyValue("--team-plot").trim() || "#ffffff",
      border: styles.getPropertyValue("--team-border").trim() || "#d2c19c",
    };
  }

  function observeWidth(root, callback) {
    if (!window.ResizeObserver) return;
    let lastWidth = 0;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width || 0);
      if (!width || Math.abs(width - lastWidth) < 2) return;
      lastWidth = width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(callback);
    });
    observer.observe(root);
  }

  class RookieContextChart {
    constructor(root) {
      this.root = root;
      this.panels = [...root.querySelectorAll("[data-rookie-panel]")];
      this.tableWrap = root.querySelector(".pelicans-rookies__table-wrap");
      this.status = root.querySelector(".pelicans-chart__status");
      this.rows = [];
      this.loaded = false;
      this.instanceId = `pelicans-rookies-${++chartInstance}`;
      this.panelGeometry = [];
      observeWidth(root, () => { if (this.loaded && this.root.offsetParent) this.render(); });
    }

    async load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = d3.csv(this.root.dataset.source, (row) => ({
        id: row.player_id,
        name: row.player_name,
        season: row.season,
        team: row.team,
        age: Number(row.age),
        position: row.position,
        games: Number(row.games),
        mpg: Number(row.minutes_per_game),
        minutes: row.total_minutes ? Number(row.total_minutes) : null,
        points: Number(row.points_per_100),
        assists: Number(row.assists_per_100),
        turnovers: Number(row.turnovers_per_100),
        ts: Number(row.true_shooting_pct),
        featured: row.featured === "true",
      })).then((rows) => {
        this.rows = rows;
        this.loaded = true;
        this.status.remove();
        this.renderTable();
        this.render();
        this.root.setAttribute("aria-busy", "false");
        this.root.dataset.chartReady = "true";
        return rows;
      }).catch((error) => this.fail(error));
      return this.loadPromise;
    }

    fail(error) {
      console.error("Pelicans rookie chart failed", error);
      this.status.className = "pelicans-chart__status pelicans-chart__status--error";
      this.status.textContent = "The rookie comparison could not load. The chart-ready CSV and methods remain linked below.";
      this.root.setAttribute("aria-busy", "false");
      throw error;
    }

    render() {
      const palette = theme(this.root);
      const configs = [
        {
          key: "scoring",
          xKey: "points", yKey: "ts",
          xLabel: "Points per 100 possessions", yLabel: "True shooting",
          xFormat: d3.format(".0f"), yFormat: d3.format(".0%"),
          description: "Points per 100 possessions and true shooting percentage for 138 qualifying rookie player-seasons. Jeremiah Fears and Derik Queen are highlighted.",
        },
        {
          key: "creation",
          xKey: "assists", yKey: "turnovers",
          xLabel: "Assists per 100 possessions", yLabel: "Turnovers per 100 possessions",
          xFormat: d3.format(".0f"), yFormat: d3.format(".0f"),
          description: "Assists and turnovers per 100 possessions for 138 qualifying rookie player-seasons. More assists and fewer turnovers are favorable directions.",
        },
      ];
      this.panelGeometry = [];
      this.panels.forEach((panel, index) => this.renderPanel(panel, configs[index], palette));
    }

    renderPanel(panel, config, palette) {
      panel.querySelector("svg")?.remove();
      const width = Math.max(286, Math.floor(panel.clientWidth));
      const narrow = width < 460;
      const height = narrow ? 326 : 350;
      const margin = { top: 24, right: 18, bottom: 50, left: narrow ? 48 : 56 };
      const xDomain = paddedDomain(this.rows.map((row) => row[config.xKey]));
      const yDomain = paddedDomain(this.rows.map((row) => row[config.yKey]));
      const x = d3.scaleLinear(xDomain, [margin.left, width - margin.right]);
      const y = d3.scaleLinear(yDomain, [height - margin.bottom, margin.top]);
      const plot = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom };
      const clipId = `${this.instanceId}-${config.key}-clip`;
      const svg = d3.select(panel).append("svg")
        .attr("class", "pelicans-rookies__svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("data-panel-key", config.key)
        .attr("data-x-domain", xDomain.join(","))
        .attr("data-y-domain", yDomain.join(","))
        .attr("data-plot-bounds", [plot.left, plot.right, plot.top, plot.bottom].join(","))
        .attr("role", "img")
        .attr("aria-label", config.description);
      svg.append("defs").append("clipPath").attr("id", clipId).append("rect")
        .attr("x", plot.left).attr("y", plot.top)
        .attr("width", plot.right - plot.left).attr("height", plot.bottom - plot.top);
      this.panelGeometry.push({ key: config.key, xDomain, yDomain, plot });

      svg.append("g").attr("class", "pelicans-chart__grid")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(narrow ? 4 : 5).tickSize(-(height - margin.top - margin.bottom)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("g").attr("class", "pelicans-chart__grid")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-(width - margin.left - margin.right)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("g").attr("class", "pelicans-chart__axis")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(narrow ? 4 : 5).tickSizeOuter(0).tickPadding(7).tickFormat(config.xFormat));
      svg.append("g").attr("class", "pelicans-chart__axis")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSizeOuter(0).tickPadding(7).tickFormat(config.yFormat));
      svg.append("text").attr("class", "pelicans-chart__axis-title")
        .attr("x", (margin.left + width - margin.right) / 2).attr("y", height - 7)
        .attr("text-anchor", "middle").text(config.xLabel);
      svg.append("text").attr("class", "pelicans-chart__axis-title")
        .attr("transform", `translate(13,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
        .attr("text-anchor", "middle").text(config.yLabel);

      const marks = svg.append("g").attr("class", "pelicans-rookies__marks").attr("clip-path", `url(#${clipId})`);
      const context = this.rows.filter((row) => !row.featured);
      marks.append("g").selectAll("circle").data(context, (row) => `${row.id}-${row.season}`).join("circle")
        .attr("class", "pelicans-rookies__peer")
        .attr("cx", (row) => x(row[config.xKey])).attr("cy", (row) => y(row[config.yKey])).attr("r", 3.1)
        .attr("data-x", (row) => x(row[config.xKey])).attr("data-y", (row) => y(row[config.yKey]))
        .append("title").text((row) => `${row.name}, ${displaySeason(row.season)}: ${row[config.xKey].toFixed(1)} ${config.xLabel.toLowerCase()}, ${config.yKey === "ts" ? percent(row.ts) : row.turnovers.toFixed(1)} ${config.yLabel.toLowerCase()}. ${row.games} games, ${row.mpg.toFixed(1)} minutes per game.`);

      const featured = this.rows.filter((row) => row.featured);
      const symbols = { fearsje01: d3.symbolCircle, queende01: d3.symbolDiamond };
      const classes = { fearsje01: "is-fears", queende01: "is-queen" };
      marks.append("g").selectAll("path").data(featured, (row) => row.id).join("path")
        .attr("class", (row) => `pelicans-rookies__featured ${classes[row.id]}`)
        .attr("transform", (row) => `translate(${x(row[config.xKey])},${y(row[config.yKey])})`)
        .attr("data-x", (row) => x(row[config.xKey])).attr("data-y", (row) => y(row[config.yKey]))
        .attr("d", (row) => d3.symbol().type(symbols[row.id]).size(row.id === "fearsje01" ? 142 : 164)())
        .attr("fill", (row) => row.id === "fearsje01" ? palette.secondary : palette.identity)
        .attr("stroke", (row) => row.id === "fearsje01" ? palette.plot : palette.ink)
        .append("title").text((row) => `${row.name}: ${row.points.toFixed(1)} points, ${row.assists.toFixed(1)} assists and ${row.turnovers.toFixed(1)} turnovers per 100 possessions, ${percent(row.ts)} true shooting; ${row.games} games and ${row.minutes.toLocaleString("en-US")} total minutes.`);

      const labelPosition = (row) => {
        if (config.key === "scoring") return row.id === "fearsje01"
          ? { dx: 9, dy: 16, anchor: "start" } : { dx: 9, dy: -9, anchor: "start" };
        return row.id === "fearsje01"
          ? { dx: -9, dy: -10, anchor: "end" } : { dx: 9, dy: 17, anchor: "start" };
      };
      svg.append("g").selectAll("text").data(featured, (row) => row.id).join("text")
        .attr("class", (row) => `pelicans-rookies__direct-label ${classes[row.id]}`)
        .attr("x", (row) => x(row[config.xKey]) + labelPosition(row).dx)
        .attr("y", (row) => y(row[config.yKey]) + labelPosition(row).dy)
        .attr("text-anchor", (row) => labelPosition(row).anchor)
        .text((row) => row.name.replace("Jeremiah ", "").replace("Derik ", ""));

      this.addInspection(panel, svg, config, x, y, plot);
    }

    addInspection(panel, svg, config, x, y, plot) {
      let inspection = panel.querySelector(`.pelicans-rookies__inspection[data-panel-key="${config.key}"]`);
      if (!inspection) {
        inspection = document.createElement("div");
        inspection.className = "pelicans-rookies__inspection";
        inspection.dataset.panelKey = config.key;
        inspection.setAttribute("aria-hidden", "true");
        panel.append(inspection);
      }
      const ordered = [...this.rows].sort((a, b) => d3.ascending(a[config.xKey], b[config.xKey]) || d3.ascending(a[config.yKey], b[config.yKey]));
      let keyboardIndex = 0;
      let sticky = false;
      const describe = (row) => config.key === "scoring"
        ? `${row.name}, ${displaySeason(row.season)} rookie: ${row.points.toFixed(1)} points per 100 possessions and ${percent(row.ts)} true shooting.`
        : `${row.name}, ${displaySeason(row.season)} rookie: ${row.assists.toFixed(1)} assists and ${row.turnovers.toFixed(1)} turnovers per 100 possessions.`;
      const show = (row) => {
        inspection.innerHTML = `<strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(displaySeason(row.season))} rookie</span><span>${escapeHtml(config.key === "scoring" ? `${row.points.toFixed(1)} PTS/100 · ${percent(row.ts)} TS` : `${row.assists.toFixed(1)} AST/100 · ${row.turnovers.toFixed(1)} TOV/100`)}</span>`;
        inspection.classList.add("is-visible");
        inspection.setAttribute("aria-hidden", "false");
        hit.attr("aria-label", `${describe(row)} Use arrow keys to inspect another rookie season.`);
      };
      const hide = () => {
        inspection.classList.remove("is-visible");
        inspection.setAttribute("aria-hidden", "true");
      };
      const nearest = (event) => {
        const [px, py] = d3.pointer(event, svg.node());
        return d3.least(this.rows, (row) => Math.hypot(x(row[config.xKey]) - px, y(row[config.yKey]) - py));
      };
      const hit = svg.append("rect")
        .attr("class", "pelicans-rookies__hit")
        .attr("x", plot.left).attr("y", plot.top)
        .attr("width", plot.right - plot.left).attr("height", plot.bottom - plot.top)
        .attr("tabindex", 0).attr("role", "group")
        .attr("aria-roledescription", "interactive scatterplot")
        .attr("aria-label", "Inspect 138 rookie player-seasons. Use arrow keys to move through players; the complete table follows the chart.")
        .on("pointermove", (event) => { if (event.pointerType !== "touch") show(nearest(event)); })
        .on("pointerleave", () => { if (!sticky && document.activeElement !== hit.node()) hide(); })
        .on("click", (event) => { sticky = true; const row = nearest(event); keyboardIndex = ordered.indexOf(row); show(row); })
        .on("focus", () => show(ordered[keyboardIndex]))
        .on("blur", () => { if (!sticky) hide(); })
        .on("keydown", (event) => {
          if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) event.preventDefault();
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") keyboardIndex = (keyboardIndex - 1 + ordered.length) % ordered.length;
          else if (event.key === "ArrowRight" || event.key === "ArrowDown") keyboardIndex = (keyboardIndex + 1) % ordered.length;
          else if (event.key === "Home") keyboardIndex = 0;
          else if (event.key === "End") keyboardIndex = ordered.length - 1;
          else if (event.key === "Escape") { sticky = false; hide(); return; }
          else return;
          sticky = true;
          show(ordered[keyboardIndex]);
        });
    }

    renderTable() {
      const rows = [...this.rows].sort((a, b) => d3.ascending(a.season, b.season) || d3.descending(a.points, b.points));
      this.tableWrap.innerHTML = `<table class="team-graphic__table pelicans-chart__table">
        <caption>All 138 qualifying rookie player-seasons used in the two scatterplots.</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Season</th><th scope="col">Team</th><th scope="col">G</th><th scope="col">MPG</th><th scope="col">PTS/100</th><th scope="col">AST/100</th><th scope="col">TOV/100</th><th scope="col">TS%</th></tr></thead>
        <tbody>${rows.map((row) => `<tr${row.featured ? ' class="is-featured"' : ""}><th scope="row">${escapeHtml(row.name)}</th><td>${escapeHtml(displaySeason(row.season))}</td><td>${escapeHtml(row.team)}</td><td>${row.games}</td><td>${row.mpg.toFixed(1)}</td><td>${row.points.toFixed(1)}</td><td>${row.assists.toFixed(1)}</td><td>${row.turnovers.toFixed(1)}</td><td>${percent(row.ts)}</td></tr>`).join("")}</tbody>
      </table>`;
    }
  }

  class ZionRoleChart {
    constructor(root) {
      this.root = root;
      this.plot = root.querySelector(".pelicans-zion__career-plot");
      this.summary = root.querySelector(".pelicans-zion__current-summary");
      this.onoff = root.querySelector(".pelicans-zion__onoff-plot");
      this.tableWrap = root.querySelector(".pelicans-zion__table-wrap");
      this.status = root.querySelector(".pelicans-chart__status");
      this.rows = [];
      this.loaded = false;
      observeWidth(root, () => { if (this.loaded && this.root.offsetParent) this.render(); });
    }

    async load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = d3.csv(this.root.dataset.source, (row) => ({
        season: row.season,
        status: row.sample_status,
        games: Number(row.games),
        minutes: Number(row.total_minutes),
        mpg: row.minutes_per_game ? Number(row.minutes_per_game) : null,
        usage: row.usage_pct ? Number(row.usage_pct) : null,
        assists: row.assists_per_100 ? Number(row.assists_per_100) : null,
        ts: row.true_shooting_pct ? Number(row.true_shooting_pct) : null,
        assistedTwo: row.assisted_two_pct ? Number(row.assisted_two_pct) : null,
        onOrtg: row.team_ortg_on ? Number(row.team_ortg_on) : null,
        onMinutes: row.team_ortg_on_minutes ? Number(row.team_ortg_on_minutes) : null,
        offOrtg: row.team_ortg_off ? Number(row.team_ortg_off) : null,
        offMinutes: row.team_ortg_off_minutes ? Number(row.team_ortg_off_minutes) : null,
      })).then((rows) => {
        this.rows = rows;
        this.loaded = true;
        this.status.remove();
        this.renderTable();
        this.render();
        this.root.setAttribute("aria-busy", "false");
        this.root.dataset.chartReady = "true";
        return rows;
      }).catch((error) => this.fail(error));
      return this.loadPromise;
    }

    fail(error) {
      console.error("Pelicans Zion chart failed", error);
      this.status.className = "pelicans-chart__status pelicans-chart__status--error";
      this.status.textContent = "Zion’s role graphic could not load. The chart-ready CSV and methods remain linked below.";
      this.root.setAttribute("aria-busy", "false");
      throw error;
    }

    render() {
      this.renderCareer();
      this.renderOnOff();
    }

    renderCareer() {
      this.plot.querySelector("svg")?.remove();
      const palette = theme(this.root);
      const completedRows = this.rows.filter((row) => row.status === "completed");
      const currentRow = this.rows.find((row) => row.status.startsWith("current"));
      const width = Math.max(286, Math.floor(this.plot.clientWidth));
      const narrow = width < 520;
      const height = narrow ? 520 : 500;
      const margin = { top: 32, right: 18, bottom: 72, left: narrow ? 47 : 58 };
      const panelGap = 26;
      const panelHeight = (height - margin.top - margin.bottom - panelGap * 2) / 3;
      const x = d3.scalePoint(completedRows.map((row) => row.season), [margin.left, width - margin.right]).padding(0.32);
      const svg = d3.select(this.plot).append("svg")
        .attr("class", "pelicans-zion__career-svg").attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "Three aligned career panels show Zion Williamson's usage percentage, assists per 100 possessions and true shooting percentage across six completed played seasons. Adjacent displayed seasons are joined with solid navy lines and hollow circles. A separate summary gives the current 2026-27 values. Williamson missed 2021-22.");

      const plotBottom = height - margin.bottom;
      const configs = [
        { key: "usage", title: "Usage percentage", summary: "Usage", domain: [20, 38], ticks: [20, 25, 30, 35], format: (value) => `${value}%`, value: (value) => `${value.toFixed(1)}%` },
        { key: "assists", title: "Assists per 100 possessions", summary: "Assists per 100", domain: [3, 10], ticks: [4, 6, 8, 10], format: d3.format("d"), value: (value) => value.toFixed(1) },
        { key: "ts", title: "True shooting percentage", summary: "True shooting", domain: [0.58, 0.72], ticks: [0.60, 0.65, 0.70], format: d3.format(".0%"), value: percent },
      ];
      this.summary.innerHTML = `<h5>${displaySeason(currentRow.season)} · ${currentRow.games} games</h5>
        <div class="pelicans-zion__current-values">${configs.map((config) => `<p><span>${config.summary}</span><strong>${config.value(currentRow[config.key])}</strong></p>`).join("")}</div>`;
      configs.forEach((config, index) => {
        const top = margin.top + index * (panelHeight + panelGap);
        const bottom = top + panelHeight;
        const y = d3.scaleLinear(config.domain, [bottom, top]);
        svg.append("text").attr("class", "pelicans-zion__panel-title")
          .attr("x", margin.left).attr("y", top - 9).text(config.title);
        svg.append("g").attr("class", "pelicans-chart__grid")
          .attr("transform", `translate(${margin.left},0)`)
          .call(d3.axisLeft(y).tickValues(config.ticks).tickSize(-(width - margin.left - margin.right)).tickFormat(""))
          .call((group) => group.select(".domain").remove());
        svg.append("g").attr("class", "pelicans-chart__axis")
          .attr("transform", `translate(${margin.left},0)`)
          .call(d3.axisLeft(y).tickValues(config.ticks).tickSizeOuter(0).tickPadding(7).tickFormat(config.format));
        const line = d3.line().x((row) => x(row.season)).y((row) => y(row[config.key]));
        svg.append("path").datum(completedRows)
          .attr("class", "pelicans-zion__career-line pelicans-zion__career-line--completed").attr("d", line);
        svg.append("g").selectAll("path").data(completedRows, (row) => row.season).join("path")
          .attr("class", "pelicans-zion__career-point")
          .attr("transform", (row) => `translate(${x(row.season)},${y(row[config.key])})`)
          .attr("d", d3.symbol().type(d3.symbolCircle).size(74)())
          .attr("fill", palette.plot)
          .attr("stroke", palette.secondary);
        svg.append("g").selectAll("text").data(completedRows, (row) => row.season).join("text")
          .attr("class", "pelicans-zion__career-value")
          .attr("x", (row) => x(row.season) + (narrow ? (completedRows.indexOf(row) % 2 ? 3 : -3) : 0))
          .attr("y", (row) => y(row[config.key]) - 10)
          .attr("text-anchor", (row) => narrow ? (completedRows.indexOf(row) % 2 ? "start" : "end") : "middle")
          .text((row) => config.value(row[config.key]));
      });
      const seasonAxis = svg.append("g").attr("class", "pelicans-chart__axis pelicans-zion__season-axis")
        .attr("transform", `translate(0,${plotBottom})`)
        .call(d3.axisBottom(x).tickSize(4).tickSizeOuter(0).tickPadding(7).tickFormat((season) => narrow ? shortSeason(season) : displaySeason(season)));
      seasonAxis.selectAll(".tick text").each(function(season) {
        const row = completedRows.find((candidate) => candidate.season === season);
        const label = d3.select(this);
        label.text(null).append("tspan").attr("x", 0).attr("y", 9).text(narrow ? shortSeason(season) : displaySeason(season));
        label.append("tspan").attr("class", "pelicans-zion__games-label").attr("x", 0).attr("dy", 14).text(`${row.games} G`);
      });
      svg.append("text").attr("class", "pelicans-chart__axis-title pelicans-zion__played-axis-title")
        .attr("x", (margin.left + width - margin.right) / 2).attr("y", height - 5).attr("text-anchor", "middle")
        .text("Played seasons");
    }

    renderOnOff() {
      this.onoff.querySelector("svg")?.remove();
      const current = this.rows.find((row) => row.status.startsWith("current"));
      const width = Math.max(286, Math.floor(this.onoff.clientWidth));
      const height = 160;
      const margin = { top: 28, right: 18, bottom: 38, left: 18 };
      const x = d3.scaleLinear([100, 122], [margin.left, width - margin.right]);
      const markY = 72;
      const rows = [
        { split: "Off court", value: current.offOrtg, minutes: current.offMinutes, current: false },
        { split: "On court", value: current.onOrtg, minutes: current.onMinutes, current: true },
      ];
      const svg = d3.select(this.onoff).append("svg")
        .attr("class", "pelicans-zion__onoff-svg").attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "New Orleans scored 119.2 points per 100 possessions in Zion Williamson's 360 on-court minutes and 104.2 in 231 off-court minutes in the current 12-game team snapshot.");
      svg.append("g").attr("class", "pelicans-chart__grid")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues([100, 105, 110, 115, 120]).tickSize(-(height - margin.top - margin.bottom)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("line").attr("class", "pelicans-zion__onoff-connector")
        .attr("x1", x(current.offOrtg)).attr("x2", x(current.onOrtg)).attr("y1", markY).attr("y2", markY);
      const marks = svg.append("g").selectAll("g").data(rows).join("g")
        .attr("class", "pelicans-zion__onoff-endpoint")
        .attr("data-x", (row) => x(row.value)).attr("data-y", markY)
        .attr("transform", (row) => `translate(${x(row.value)},${markY})`);
      marks.each(function(row) {
        const group = d3.select(this);
        if (row.current) group.append("circle").attr("class", "pelicans-zion__onoff-mark is-on").attr("r", 6.5);
        else group.append("rect").attr("class", "pelicans-zion__onoff-mark is-off").attr("x", -6).attr("y", -6).attr("width", 12).attr("height", 12);
      });
      marks.append("text").attr("class", "pelicans-zion__onoff-label")
        .attr("x", (row) => row.current ? 30 : -30).attr("y", (row) => row.current ? -14 : 23)
        .attr("text-anchor", (row) => row.current ? "end" : "start")
        .text((row) => `${row.split}: ${row.value.toFixed(1)} · ${row.minutes} minutes`);
      svg.append("text").attr("class", "pelicans-zion__onoff-difference")
        .attr("x", (x(current.offOrtg) + x(current.onOrtg)) / 2).attr("y", 28).attr("text-anchor", "middle")
        .text("15.0-point offensive-rating difference");
      svg.append("g").attr("class", "pelicans-chart__axis")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues([100, 105, 110, 115, 120]).tickSizeOuter(0).tickPadding(7));
      svg.append("text").attr("class", "pelicans-chart__axis-title")
        .attr("x", width / 2).attr("y", height - 4).attr("text-anchor", "middle")
        .text("Team offensive rating");
    }

    renderTable() {
      this.tableWrap.innerHTML = `<table class="team-graphic__table pelicans-chart__table">
        <caption>Zion Williamson career role, efficiency, games and current New Orleans on/off offense.</caption>
        <thead><tr><th scope="col">Season</th><th scope="col">Status</th><th scope="col">G</th><th scope="col">MP</th><th scope="col">USG%</th><th scope="col">AST/100</th><th scope="col">TS%</th><th scope="col">Assisted 2P%</th><th scope="col">Team ORtg on (min)</th><th scope="col">Team ORtg off (min)</th></tr></thead>
        <tbody>${this.rows.map((row) => `<tr><th scope="row">${displaySeason(row.season)}</th><td>${row.status === "did_not_play" ? "Did not play" : row.status.startsWith("current") ? "Current snapshot" : "Completed"}</td><td>${row.status === "did_not_play" ? "—" : row.games}</td><td>${row.status === "did_not_play" ? "—" : row.minutes.toLocaleString("en-US")}</td><td>${row.usage == null ? "—" : `${row.usage.toFixed(1)}%`}</td><td>${row.assists == null ? "—" : row.assists.toFixed(1)}</td><td>${row.ts == null ? "—" : percent(row.ts)}</td><td>${row.assistedTwo == null ? "—" : percent(row.assistedTwo)}</td><td>${row.onOrtg == null ? "—" : `${row.onOrtg.toFixed(1)} (${row.onMinutes})`}</td><td>${row.offOrtg == null ? "—" : `${row.offOrtg.toFixed(1)} (${row.offMinutes})`}</td></tr>`).join("")}</tbody>
      </table>`;
    }
  }

  class TeamStyleChart {
    constructor(root) {
      this.root = root;
      this.rankRows = root.querySelector(".pelicans-team__rank-rows");
      this.styleRows = root.querySelector(".pelicans-team__style-rows");
      this.tableWrap = root.querySelector(".pelicans-team__table-wrap");
      this.status = root.querySelector(".pelicans-chart__status");
      this.rows = [];
    }

    async load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = d3.csv(this.root.dataset.source, (row) => ({
        season: row.season,
        current: row.sample_status.startsWith("current"),
        games: Number(row.games), wins: Number(row.wins), losses: Number(row.losses),
        ortg: Number(row.offensive_rating), ortgRank: Number(row.offensive_rating_rank),
        drtg: Number(row.defensive_rating), drtgRank: Number(row.defensive_rating_rank),
        oppTwo: Number(row.opponent_two_point_pct), oppTwoRank: Number(row.opponent_two_point_defensive_rank),
        drb: Number(row.defensive_rebound_pct), drbRank: Number(row.defensive_rebound_pct_rank),
        threePar: Number(row.three_point_attempt_rate), threeParRank: Number(row.three_point_attempt_rate_most_rank),
        ftr: Number(row.free_throw_attempt_rate), ftrRank: Number(row.free_throw_attempt_rate_most_rank),
      })).then((rows) => {
        this.rows = rows;
        this.status.remove();
        this.render();
        this.renderTable();
        this.root.setAttribute("aria-busy", "false");
        this.root.dataset.chartReady = "true";
        return rows;
      }).catch((error) => this.fail(error));
      return this.loadPromise;
    }

    fail(error) {
      console.error("Pelicans team chart failed", error);
      this.status.className = "pelicans-chart__status pelicans-chart__status--error";
      this.status.textContent = "The team comparison could not load. The chart-ready CSV and methods remain linked below.";
      this.root.setAttribute("aria-busy", "false");
      throw error;
    }

    render() {
      const metrics = [
        { title: "Offensive rating", key: "ortg", rank: "ortgRank", format: (value) => value.toFixed(1), note: "Higher is better" },
        { title: "Defensive rating", key: "drtg", rank: "drtgRank", format: (value) => value.toFixed(1), note: "Lower is better" },
        { title: "Opponent two-point percentage", key: "oppTwo", rank: "oppTwoRank", format: percent, note: "Lower is better · all 2PA" },
        { title: "Defensive rebound percentage", key: "drb", rank: "drbRank", format: (value) => `${value.toFixed(1)}%`, note: "Higher is better" },
      ];
      this.rankRows.innerHTML = metrics.map((metric) => `<section class="pelicans-team__rank-row">
        <header><h5>${metric.title}</h5><p>${metric.note}</p></header>
        <div class="pelicans-team__rank-geometry" aria-hidden="true">
          <div class="pelicans-team__rank-scale"><span>1 · best</span><span>10th</span><span>20th</span><span>30th</span></div>
          <div class="pelicans-team__track">
            ${this.rows.map((row) => `<i class="pelicans-team__rank-marker${row.current ? " is-current" : ""}" data-season="${row.season}" data-rank="${row[metric.rank]}" style="--rank-position:${((row[metric.rank] - 1) / 29) * 100}%"></i>`).join("")}
          </div>
        </div>
        <div class="pelicans-team__rank-values">
          ${this.rows.map((row) => `<p class="${row.current ? "is-current" : ""}"><span class="pelicans-team__marker-key" aria-hidden="true"></span><strong>${displaySeason(row.season)}</strong> ${metric.format(row[metric.key])} · ${ordinal(row[metric.rank])}</p>`).join("")}
        </div>
      </section>`).join("");

      const styles = [
        { title: "Three-point attempt share", unit: "Share of field-goal attempts", key: "threePar", rank: "threeParRank", format: percent },
        { title: "Free-throw attempt rate", unit: "FTA per 100 FGA", key: "ftr", rank: "ftrRank", format: (value) => `${(value * 100).toFixed(1)} FTA` },
      ];
      this.styleRows.innerHTML = styles.map((metric) => `<section class="pelicans-team__style-row">
        <header><h5>${metric.title}</h5><p>${metric.unit}</p></header>
        <div class="pelicans-team__style-scale" aria-hidden="true"><span>0</span><span>20</span><span>40</span></div>
        ${this.rows.map((row) => {
          const lowRank = 31 - row[metric.rank];
          const volume = metric.key === "threePar"
            ? row[metric.rank] === 30 ? "Lowest attempt share" : lowRank === 5 ? "Fifth-lowest attempt share" : `${ordinal(lowRank)}-lowest attempt share`
            : row[metric.rank] === 1 ? "Highest FTA rate" : row[metric.rank] === 8 ? "Eighth-highest FTA rate" : `${ordinal(row[metric.rank])}-highest FTA rate`;
          return `<div class="pelicans-team__style-season${row.current ? " is-current" : ""}">
            <span class="pelicans-team__season-label">${displaySeason(row.season)}</span>
            <span class="pelicans-team__style-track" data-domain="0,40"><i data-value="${(row[metric.key] * 100).toFixed(1)}" style="--style-position:${row[metric.key] * 250}%"></i></span>
            <span class="pelicans-team__style-value"><strong>${metric.format(row[metric.key])}</strong><small>${volume}</small></span>
          </div>`;
        }).join("")}
      </section>`).join("");
    }

    renderTable() {
      this.tableWrap.innerHTML = `<table class="team-graphic__table pelicans-chart__table">
        <caption>New Orleans team results, supplied league quality ranks and offensive-style volume ranks.</caption>
        <thead><tr><th scope="col">Season</th><th scope="col">Window</th><th scope="col">Record</th><th scope="col">ORtg (rank)</th><th scope="col">DRtg (rank)</th><th scope="col">Opp. 2P% (def. rank)</th><th scope="col">DRB% (rank)</th><th scope="col">3PAr (most rank)</th><th scope="col">FTr (most rank)</th></tr></thead>
        <tbody>${this.rows.map((row) => `<tr><th scope="row">${displaySeason(row.season)}</th><td>${row.current ? "12 games" : "82 games"}</td><td>${row.wins}–${row.losses}</td><td>${row.ortg.toFixed(1)} (${ordinal(row.ortgRank)})</td><td>${row.drtg.toFixed(1)} (${ordinal(row.drtgRank)})</td><td>${percent(row.oppTwo)} (${ordinal(row.oppTwoRank)})</td><td>${row.drb.toFixed(1)}% (${ordinal(row.drbRank)})</td><td>${row.threePar.toFixed(3)} (${ordinal(row.threeParRank)}-most)</td><td>${row.ftr.toFixed(3)} (${ordinal(row.ftrRank)}-most)</td></tr>`).join("")}</tbody>
      </table>`;
    }
  }

  function initialize() {
    const roots = [
      ...document.querySelectorAll("[data-pelicans-rookie-chart]"),
      ...document.querySelectorAll("[data-pelicans-zion-chart]"),
      ...document.querySelectorAll("[data-pelicans-team-chart]"),
    ];
    if (!d3) {
      roots.forEach((root) => {
        const status = root.querySelector(".pelicans-chart__status");
        status.className = "pelicans-chart__status pelicans-chart__status--error";
        status.textContent = "The chart library could not load. The accessible source tables remain available below.";
        root.setAttribute("aria-busy", "false");
      });
      return;
    }
    roots.forEach((root) => {
      if (root.dataset.pelicansInitialized === "true") return;
      root.dataset.pelicansInitialized = "true";
      const chart = root.matches("[data-pelicans-rookie-chart]")
        ? new RookieContextChart(root)
        : root.matches("[data-pelicans-zion-chart]")
          ? new ZionRoleChart(root)
          : new TeamStyleChart(root);
      if (root.matches("[data-pelicans-rookie-chart]")) root.pelicansRookieChart = chart;
      if (root.matches("[data-pelicans-zion-chart]")) root.pelicansZionChart = chart;
      if (root.matches("[data-pelicans-team-chart]")) root.pelicansTeamChart = chart;
      const card = root.closest("details");
      const loadWhenVisible = () => {
        if (!card || card.open) requestAnimationFrame(() => chart.load());
      };
      if (card) card.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  initialize();
})();
