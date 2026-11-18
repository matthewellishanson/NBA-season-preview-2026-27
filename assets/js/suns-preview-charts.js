(() => {
  "use strict";

  const d3 = window.d3;
  if (!d3) return;

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const signed = (value) => `${value > 0 ? "+" : ""}${Number(value).toFixed(1)}`;
  const percent = (value) => `${(Number(value) * 100).toFixed(1)}%`;
  const ordinal = (value) => {
    const number = Number(value);
    const lastTwo = number % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${number}th`;
    return `${number}${({ 1: "st", 2: "nd", 3: "rd" })[number % 10] || "th"}`;
  };
  const palette = (root) => {
    const styles = getComputedStyle(root);
    return {
      identity: styles.getPropertyValue("--team-identity").trim(),
      secondary: styles.getPropertyValue("--team-secondary").trim(),
      ink: styles.getPropertyValue("--team-ink").trim(),
      comparison: styles.getPropertyValue("--team-comparison").trim(),
      plot: styles.getPropertyValue("--team-plot").trim(),
      muted: styles.getPropertyValue("--team-muted").trim(),
    };
  };
  const numericDomain = (values, includeZero = false, padding = 0.08) => {
    let [minimum, maximum] = d3.extent(values.map(Number));
    if (includeZero) {
      minimum = Math.min(minimum, 0);
      maximum = Math.max(maximum, 0);
    }
    const span = Math.max(maximum - minimum, 1);
    return [minimum - span * padding, maximum + span * padding];
  };
  const numberFields = (row, fields) => {
    const output = { ...row };
    fields.forEach((field) => { output[field] = Number(row[field]); });
    return output;
  };
  const parseGreenCohort = (row) => ({
    ...numberFields(row, [
      "rookie_games", "comparison_games", "rookie_minutes_per_game", "comparison_minutes_per_game",
      "rookie_points_per_game", "comparison_points_per_game", "points_per_game_change",
      "rookie_true_shooting_pct", "comparison_true_shooting_pct", "true_shooting_pct_point_change",
    ]),
    is_jalen_green: row.is_jalen_green === "true",
  });
  const parseGreenCareer = (row) => numberFields(row, ["games", "total_minutes", "true_shooting_pct", "true_shooting_plus", "points_per_100"]);
  const parseBooker = (row) => numberFields(row, ["games", "total_minutes", "minutes_per_game", "points_per_100", "assists_per_100", "true_shooting_pct", "true_shooting_plus"]);
  const parseTeam = (row) => numberFields(row, [
    "games", "wins", "losses", "defensive_rating", "defensive_rating_rank", "defensive_rebound_pct",
    "defensive_rebound_pct_rank", "offensive_rebound_pct", "offensive_rebound_pct_rank",
    "strength_of_schedule", "strength_of_schedule_rank", "simple_rating_system", "simple_rating_system_rank",
  ]);
  const makeSvg = (container, width, height, className, ariaLabel, focusable = false) => {
    container.replaceChildren();
    const svg = d3.select(container).append("svg")
      .attr("class", className)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", ariaLabel);
    if (focusable) svg.attr("tabindex", 0);
    else svg.attr("aria-hidden", "true").attr("focusable", "false");
    return svg;
  };
  const fail = (root, error) => {
    root.dataset.chartReady = "error";
    root.setAttribute("aria-busy", "false");
    root.querySelectorAll(".suns-chart__status").forEach((status) => {
      status.classList.add("suns-chart__status--error");
      status.textContent = "The chart could not load. Use the linked chart-ready data and accessible table when available.";
    });
    console.error(error);
  };
  const observe = (instance, containers) => {
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => instance.render());
    };
    instance.observer = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.contentRect.width > 0)) redraw();
    });
    containers.forEach((container) => instance.observer.observe(container));
    const card = instance.root.closest("details");
    if (card) card.addEventListener("toggle", () => { if (card.open) redraw(); });
  };

  class SunsGreenChart {
    constructor(root) {
      this.root = root;
      this.changePlot = root.querySelector(".suns-green__change-plot");
      this.careerPlot = root.querySelector(".suns-green__career-history");
      this.selectedIndex = -1;
    }

    async init() {
      if (this.promise) return this.promise;
      this.promise = Promise.all([
        d3.csv(this.root.dataset.cohortSource, parseGreenCohort),
        d3.csv(this.root.dataset.careerSource, parseGreenCareer),
      ]).then(([rows, career]) => {
        if (rows.length !== 30 || career.length !== 6) throw new Error("Unexpected Green chart row count.");
        if (new Set(rows.map((row) => row.player_id)).size !== 30) throw new Error("Duplicate Green cohort player ID.");
        this.rows = rows.sort((a, b) => d3.ascending(a.player_name, b.player_name));
        this.career = career;
        this.greenIndex = Math.max(0, this.rows.findIndex((row) => row.is_jalen_green));
        this.renderTables();
        this.render();
        observe(this, [this.changePlot, this.careerPlot]);
        this.root.dataset.chartReady = "true";
        this.root.setAttribute("aria-busy", "false");
      }).catch((error) => fail(this.root, error));
      return this.promise;
    }

    render() {
      if (!this.rows || this.changePlot.getBoundingClientRect().width < 40) return;
      this.renderScatter();
      this.renderCareer();
    }

    renderScatter() {
      const rows = this.rows;
      const width = Math.max(280, Math.round(this.changePlot.getBoundingClientRect().width));
      const narrow = width < 560;
      const height = narrow ? 400 : 430;
      const margin = narrow
        ? { top: 54, right: 22, bottom: 62, left: 52 }
        : { top: 42, right: 34, bottom: 64, left: 62 };
      const plotLeft = margin.left;
      const plotRight = width - margin.right;
      const plotTop = margin.top;
      const plotBottom = height - margin.bottom;
      const x = d3.scaleLinear()
        .domain(numericDomain(rows.map((row) => row.points_per_game_change), true, 0.12)).nice(5)
        .range([plotLeft, plotRight]);
      const y = d3.scaleLinear()
        .domain(numericDomain(rows.map((row) => row.true_shooting_pct_point_change), true, 0.14)).nice(5)
        .range([plotBottom, plotTop]);
      const colors = palette(this.root);
      const svg = makeSvg(
        this.changePlot,
        width,
        height,
        "suns-green__change-svg",
        "Scatterplot of points-per-game change and true-shooting percentage-point change for 30 All-Rookie players. Focus the chart and use arrow keys to inspect players.",
        true,
      );
      svg.attr("data-layout", narrow ? "mobile" : "desktop")
        .attr("data-plot-left", plotLeft)
        .attr("data-plot-right", plotRight)
        .attr("data-plot-top", plotTop)
        .attr("data-plot-bottom", plotBottom)
        .attr("data-x-domain-min", x.domain()[0])
        .attr("data-x-domain-max", x.domain()[1])
        .attr("data-y-domain-min", y.domain()[0])
        .attr("data-y-domain-max", y.domain()[1]);

      const xTicks = narrow ? 4 : 6;
      const yTicks = narrow ? 5 : 6;
      svg.append("g").attr("class", "suns-chart__grid").attr("transform", "translate(0," + plotBottom + ")")
        .call(d3.axisBottom(x).ticks(xTicks).tickSize(-(plotBottom - plotTop)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("g").attr("class", "suns-chart__grid").attr("transform", "translate(" + plotLeft + ",0)")
        .call(d3.axisLeft(y).ticks(yTicks).tickSize(-(plotRight - plotLeft)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("line").attr("class", "suns-chart__zero suns-green__zero-x")
        .attr("x1", x(0)).attr("x2", x(0)).attr("y1", plotTop).attr("y2", plotBottom);
      svg.append("line").attr("class", "suns-chart__zero suns-green__zero-y")
        .attr("x1", plotLeft).attr("x2", plotRight).attr("y1", y(0)).attr("y2", y(0));
      svg.append("g").attr("class", "suns-chart__axis suns-green__scatter-x-axis")
        .attr("transform", "translate(0," + plotBottom + ")")
        .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0).tickPadding(7).tickFormat(d3.format("~g")));
      svg.append("g").attr("class", "suns-chart__axis suns-green__scatter-y-axis")
        .attr("transform", "translate(" + plotLeft + ",0)")
        .call(d3.axisLeft(y).ticks(yTicks).tickSizeOuter(0).tickPadding(7).tickFormat(d3.format("~g")));
      svg.append("text").attr("class", "suns-green__scatter-axis-title")
        .attr("x", (plotLeft + plotRight) / 2).attr("y", height - 9).attr("text-anchor", "middle")
        .text("Change in points per game");
      svg.append("text").attr("class", "suns-green__scatter-axis-title")
        .attr("transform", "rotate(-90)").attr("x", -(plotTop + plotBottom) / 2).attr("y", 12).attr("text-anchor", "middle")
        .text("TS change (percentage points)");
      svg.append("text").attr("class", "suns-green__direction-label")
        .attr("x", plotLeft).attr("y", narrow ? 14 : 20).text("Higher true shooting ↑");
      svg.append("text").attr("class", "suns-green__direction-label")
        .attr("x", plotRight).attr("y", narrow ? 33 : 20).attr("text-anchor", "end").text("More scoring →");

      const clipId = "suns-green-scatter-clip";
      svg.append("defs").append("clipPath").attr("id", clipId).append("rect")
        .attr("x", plotLeft - 8).attr("y", plotTop - 8)
        .attr("width", plotRight - plotLeft + 16).attr("height", plotBottom - plotTop + 16);
      const marks = svg.append("g").attr("class", "suns-green__scatter-marks").attr("clip-path", "url(#" + clipId + ")");
      marks.selectAll("circle").data(rows.filter((row) => !row.is_jalen_green), (row) => row.player_id).join("circle")
        .attr("class", "suns-green__peer")
        .attr("cx", (row) => x(row.points_per_game_change))
        .attr("cy", (row) => y(row.true_shooting_pct_point_change))
        .attr("r", narrow ? 4.5 : 5)
        .attr("data-player", (row) => row.player_name)
        .attr("data-x-value", (row) => row.points_per_game_change)
        .attr("data-y-value", (row) => row.true_shooting_pct_point_change)
        .attr("data-x", (row) => x(row.points_per_game_change))
        .attr("data-y", (row) => y(row.true_shooting_pct_point_change));
      marks.selectAll("path").data(rows.filter((row) => row.is_jalen_green), (row) => row.player_id).join("path")
        .attr("class", "suns-green__highlight")
        .attr("transform", (row) => "translate(" + x(row.points_per_game_change) + "," + y(row.true_shooting_pct_point_change) + ")")
        .attr("d", d3.symbol().type(d3.symbolDiamond).size(narrow ? 135 : 155)())
        .attr("data-player", (row) => row.player_name)
        .attr("data-x-value", (row) => row.points_per_game_change)
        .attr("data-y-value", (row) => row.true_shooting_pct_point_change)
        .attr("data-x", (row) => x(row.points_per_game_change))
        .attr("data-y", (row) => y(row.true_shooting_pct_point_change));

      const extrema = [
        { role: "x-min", key: "points_per_game_change", value: d3.min(rows, (row) => row.points_per_game_change), dx: 11, dy: 18 },
        { role: "x-max", key: "points_per_game_change", value: d3.max(rows, (row) => row.points_per_game_change), dx: -11, dy: 18 },
        { role: "y-min", key: "true_shooting_pct_point_change", value: d3.min(rows, (row) => row.true_shooting_pct_point_change), dx: 11, dy: -12 },
        { role: "y-max", key: "true_shooting_pct_point_change", value: d3.max(rows, (row) => row.true_shooting_pct_point_change), dx: 11, dy: 18 },
      ];
      const labelSpecs = new Map();
      extrema.forEach((extreme) => {
        const matches = rows.filter((row) => row[extreme.key] === extreme.value);
        if (matches.length <= 2) matches.forEach((row) => {
          if (!labelSpecs.has(row.player_id)) labelSpecs.set(row.player_id, { row, ...extreme });
        });
      });
      const green = rows[this.greenIndex];
      labelSpecs.set(green.player_id, { row: green, role: "green", dx: 13, dy: -16 });
      const labels = [...labelSpecs.values()];
      const labelLayer = svg.append("g").attr("class", "suns-green__scatter-labels");
      labelLayer.selectAll("line").data(labels, (item) => item.row.player_id).join("line")
        .attr("class", "suns-green__leader")
        .attr("x1", (item) => x(item.row.points_per_game_change))
        .attr("y1", (item) => y(item.row.true_shooting_pct_point_change))
        .attr("x2", (item) => x(item.row.points_per_game_change) + item.dx * 0.72)
        .attr("y2", (item) => y(item.row.true_shooting_pct_point_change) + item.dy * 0.72);
      const labelText = labelLayer.selectAll("text").data(labels, (item) => item.row.player_id).join("text")
        .attr("class", (item) => "suns-green__peer-label" + (item.row.is_jalen_green ? " is-highlight" : ""))
        .attr("data-label-role", (item) => item.role)
        .attr("x", (item) => x(item.row.points_per_game_change) + item.dx)
        .attr("y", (item) => y(item.row.true_shooting_pct_point_change) + item.dy)
        .attr("text-anchor", (item) => item.dx < 0 ? "end" : "start");
      labelText.append("tspan").text((item) => item.row.player_name);
      labelText.filter((item) => item.row.is_jalen_green).append("tspan")
        .attr("x", (item) => x(item.row.points_per_game_change) + item.dx)
        .attr("dy", 13)
        .text((item) => signed(item.row.points_per_game_change) + " PPG · " + signed(item.row.true_shooting_pct_point_change) + " TS pp");

      const tooltip = d3.select(this.changePlot).append("div")
        .attr("class", "suns-chart__tooltip")
        .attr("role", "status")
        .attr("aria-live", "polite")
        .attr("hidden", true);
      const show = (index) => {
        this.selectedIndex = Math.max(0, Math.min(rows.length - 1, index));
        const row = rows[this.selectedIndex];
        const pointX = x(row.points_per_game_change);
        const pointY = y(row.true_shooting_pct_point_change);
        tooltip.attr("hidden", null).html(
          "<strong>" + escapeHtml(row.player_name) + "</strong>" +
          "<span>" + escapeHtml(row.rookie_season) + " rookie: " + Number(row.rookie_points_per_game).toFixed(1) + " PPG, " + percent(row.rookie_true_shooting_pct) + " TS, " + row.rookie_games + " G, " + Number(row.rookie_minutes_per_game).toFixed(1) + " MPG</span>" +
          "<span>" + escapeHtml(row.comparison_season) + ": " + Number(row.comparison_points_per_game).toFixed(1) + " PPG, " + percent(row.comparison_true_shooting_pct) + " TS, " + row.comparison_games + " G, " + Number(row.comparison_minutes_per_game).toFixed(1) + " MPG</span>" +
          "<span><b>Change:</b> " + signed(row.points_per_game_change) + " PPG · " + signed(row.true_shooting_pct_point_change) + " TS percentage points</span>"
        );
        const node = tooltip.node();
        const tooltipWidth = node.offsetWidth || 240;
        const tooltipHeight = node.offsetHeight || 90;
        const left = Math.max(8, Math.min(width - tooltipWidth - 8, pointX + (pointX > width * 0.62 ? -tooltipWidth - 12 : 12)));
        const top = Math.max(8, Math.min(height - tooltipHeight - 8, pointY + (pointY > height * 0.58 ? -tooltipHeight - 12 : 12)));
        tooltip.style("left", left + "px").style("top", top + "px");
        svg.attr("aria-label", row.player_name + ": " + signed(row.points_per_game_change) + " points per game and " + signed(row.true_shooting_pct_point_change) + " true-shooting percentage points three calendar years after the rookie season. Use arrow keys for another player.");
      };
      const hide = () => tooltip.attr("hidden", true);
      const nearestIndex = (event) => {
        const pointer = d3.pointer(event, svg.node());
        return d3.leastIndex(rows, (row) => Math.hypot(x(row.points_per_game_change) - pointer[0], y(row.true_shooting_pct_point_change) - pointer[1]));
      };
      svg.on("pointermove", (event) => { if (event.pointerType !== "touch") show(nearestIndex(event)); })
        .on("pointerleave", (event) => { if (event.pointerType !== "touch") hide(); })
        .on("click", (event) => show(nearestIndex(event)))
        .on("focus", () => show(this.selectedIndex >= 0 ? this.selectedIndex : this.greenIndex))
        .on("blur", hide)
        .on("keydown", (event) => {
          let next = this.selectedIndex >= 0 ? this.selectedIndex : this.greenIndex;
          if (event.key === "ArrowDown" || event.key === "ArrowRight") next += 1;
          else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next -= 1;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = rows.length - 1;
          else return;
          event.preventDefault();
          show((next + rows.length) % rows.length);
        });
      this.selectedIndex = -1;
    }

    renderChange() {
      const rows = this.rows;
      const width = Math.max(280, Math.round(this.changePlot.getBoundingClientRect().width));
      const narrow = width < 600;
      const ppg = d3.scaleLinear().domain(numericDomain(rows.map((row) => row.points_per_game_change), true)).nice(5);
      const ts = d3.scaleLinear().domain(numericDomain(rows.map((row) => row.true_shooting_pct_point_change), true)).nice(5);
      let svg;
      let rowCenter;
      let selectedBand;
      const colors = palette(this.root);
      if (narrow) {
        const top = 70;
        const rowHeight = 52;
        const height = top + rows.length * rowHeight + 10;
        const trackLeft = 54;
        const trackRight = width - 14;
        ppg.range([trackLeft, trackRight]);
        ts.range([trackLeft, trackRight]);
        svg = makeSvg(
          this.changePlot, width, height, "suns-green__change-svg", "Changes in points per game and true shooting for 30 All-Rookie players. Use up and down arrow keys to inspect player seasons.", true,
        );
        svg.attr("data-layout", "mobile").attr("data-track-left", trackLeft).attr("data-track-right", trackRight)
          .attr("data-plot-top", top).attr("data-plot-bottom", height - 10);
        const ppgAxis = d3.axisTop(ppg).ticks(4).tickSizeOuter(0).tickPadding(4).tickFormat(d3.format("~g"));
        const tsAxis = d3.axisTop(ts).ticks(4).tickSizeOuter(0).tickPadding(4).tickFormat(d3.format("~g"));
        svg.append("g").attr("class", "suns-chart__axis").attr("transform", "translate(0,27)").call(ppgAxis);
        svg.append("g").attr("class", "suns-chart__axis").attr("transform", "translate(0,55)").call(tsAxis);
        svg.append("text").attr("class", "suns-green__mobile-metric").attr("x", 4).attr("y", 11).text("PPG");
        svg.append("text").attr("class", "suns-green__mobile-metric").attr("x", 4).attr("y", 41).text("TS pp");
        selectedBand = svg.append("rect").attr("class", "suns-green__selected-band").attr("x", 0).attr("width", width).attr("height", rowHeight - 2);
        const groups = svg.append("g").selectAll("g").data(rows, (row) => row.player_id).join("g")
          .attr("transform", (_, index) => `translate(0,${top + index * rowHeight})`);
        groups.append("text").attr("class", (row) => `suns-green__name${row.is_jalen_green ? " is-highlight" : ""}`)
          .attr("x", 4).attr("y", 12).text((row) => row.player_name);
        for (const [key, scale, y] of [["points_per_game_change", ppg, 29], ["true_shooting_pct_point_change", ts, 46]]) {
          groups.append("line").attr("class", "suns-green__row-guide").attr("x1", trackLeft).attr("x2", trackRight).attr("y1", y).attr("y2", y);
          groups.append("line").attr("class", "suns-chart__zero").attr("x1", scale(0)).attr("x2", scale(0)).attr("y1", y - 5).attr("y2", y + 5);
          groups.filter((row) => !row.is_jalen_green).append("circle").attr("class", "suns-green__peer")
            .attr("cx", (row) => scale(row[key])).attr("cy", y).attr("r", 4)
            .attr("data-value", (row) => row[key]).attr("data-panel", key)
            .attr("data-x", (row) => scale(row[key])).attr("data-y", (_, index) => top + index * rowHeight + y);
          groups.filter((row) => row.is_jalen_green).append("path").attr("class", "suns-green__highlight")
            .attr("transform", (row) => `translate(${scale(row[key])},${y})`)
            .attr("d", d3.symbol().type(d3.symbolDiamond).size(95)())
            .attr("data-value", (row) => row[key]).attr("data-panel", key)
            .attr("data-x", (row) => scale(row[key])).attr("data-y", (_, index) => top + index * rowHeight + y);
          groups.filter((row) => row.is_jalen_green).append("text").attr("class", "suns-green__value-label")
            .attr("x", (row) => Math.min(trackRight - 4, scale(row[key]) + 9)).attr("y", y - 5)
            .attr("text-anchor", (row) => scale(row[key]) > trackRight - 42 ? "end" : "start")
            .text((row) => signed(row[key]));
        }
        rowCenter = (index) => top + index * rowHeight + rowHeight / 2;
      } else {
        const margin = { top: 54, right: 22, bottom: 40, left: 156 };
        const gap = 28;
        const panelWidth = (width - margin.left - margin.right - gap) / 2;
        const rowHeight = 23;
        const height = margin.top + margin.bottom + rows.length * rowHeight;
        const bottom = height - margin.bottom;
        const firstStart = margin.left;
        const firstEnd = firstStart + panelWidth;
        const secondStart = firstEnd + gap;
        const secondEnd = width - margin.right;
        ppg.range([firstStart, firstEnd]);
        ts.range([secondStart, secondEnd]);
        const y = d3.scaleBand().domain(rows.map((row) => row.player_id)).range([margin.top, bottom]).paddingInner(0.18);
        svg = makeSvg(
          this.changePlot, width, height, "suns-green__change-svg", "Two aligned dot plots show changes in points per game and true shooting for 30 All-Rookie players. Use up and down arrow keys to inspect player seasons.", true,
        );
        svg.attr("data-layout", "desktop").attr("data-ppg-left", firstStart).attr("data-ppg-right", firstEnd)
          .attr("data-ts-left", secondStart).attr("data-ts-right", secondEnd)
          .attr("data-plot-top", margin.top).attr("data-plot-bottom", bottom);
        svg.append("text").attr("class", "suns-chart__panel-title").attr("x", firstStart).attr("y", 18).text("A. Points per game change");
        svg.append("text").attr("class", "suns-chart__panel-title").attr("x", secondStart).attr("y", 18).text("B. True shooting change (percentage points)");
        svg.append("text").attr("class", "suns-chart__axis-title").attr("x", firstStart).attr("y", 38).text("← Less scoring");
        svg.append("text").attr("class", "suns-chart__axis-title").attr("x", firstEnd).attr("y", 38).attr("text-anchor", "end").text("More scoring →");
        svg.append("text").attr("class", "suns-chart__axis-title").attr("x", secondStart).attr("y", 38).text("← Lower TS");
        svg.append("text").attr("class", "suns-chart__axis-title").attr("x", secondEnd).attr("y", 38).attr("text-anchor", "end").text("Higher TS →");
        svg.append("g").attr("class", "suns-chart__axis").attr("transform", `translate(0,${bottom})`)
          .call(d3.axisBottom(ppg).ticks(5).tickSizeOuter(0).tickPadding(6));
        svg.append("g").attr("class", "suns-chart__axis").attr("transform", `translate(0,${bottom})`)
          .call(d3.axisBottom(ts).ticks(5).tickSizeOuter(0).tickPadding(6));
        svg.append("line").attr("class", "suns-chart__zero").attr("x1", ppg(0)).attr("x2", ppg(0)).attr("y1", margin.top).attr("y2", bottom);
        svg.append("line").attr("class", "suns-chart__zero").attr("x1", ts(0)).attr("x2", ts(0)).attr("y1", margin.top).attr("y2", bottom);
        selectedBand = svg.append("rect").attr("class", "suns-green__selected-band").attr("x", 0).attr("width", width).attr("height", y.bandwidth());
        svg.append("g").selectAll("line").data(rows).join("line").attr("class", "suns-green__row-guide")
          .attr("x1", firstStart).attr("x2", secondEnd).attr("y1", (row) => y(row.player_id) + y.bandwidth() / 2).attr("y2", (row) => y(row.player_id) + y.bandwidth() / 2);
        svg.append("g").selectAll("text").data(rows).join("text")
          .attr("class", (row) => `suns-green__name${row.is_jalen_green ? " is-highlight" : ""}`)
          .attr("x", margin.left - 10).attr("y", (row) => y(row.player_id) + y.bandwidth() / 2 + 4)
          .attr("text-anchor", "end").text((row) => row.player_name);
        const definitions = svg.append("defs");
        definitions.append("clipPath").attr("id", "suns-green-ppg-clip").append("rect")
          .attr("x", firstStart - 7).attr("y", margin.top - 7).attr("width", panelWidth + 14).attr("height", bottom - margin.top + 14);
        definitions.append("clipPath").attr("id", "suns-green-ts-clip").append("rect")
          .attr("x", secondStart - 7).attr("y", margin.top - 7).attr("width", panelWidth + 14).attr("height", bottom - margin.top + 14);
        const drawMarks = (key, scale, clipId) => {
          const marks = svg.append("g").attr("clip-path", `url(#${clipId})`);
          marks.selectAll("circle").data(rows.filter((row) => !row.is_jalen_green)).join("circle")
            .attr("class", "suns-green__peer").attr("cx", (row) => scale(row[key]))
            .attr("cy", (row) => y(row.player_id) + y.bandwidth() / 2).attr("r", 4)
            .attr("data-value", (row) => row[key]).attr("data-panel", key)
            .attr("data-x", (row) => scale(row[key])).attr("data-y", (row) => y(row.player_id) + y.bandwidth() / 2);
          marks.selectAll("path").data(rows.filter((row) => row.is_jalen_green)).join("path")
            .attr("class", "suns-green__highlight")
            .attr("transform", (row) => `translate(${scale(row[key])},${y(row.player_id) + y.bandwidth() / 2})`)
            .attr("d", d3.symbol().type(d3.symbolDiamond).size(105)())
            .attr("data-value", (row) => row[key]).attr("data-panel", key)
            .attr("data-x", (row) => scale(row[key])).attr("data-y", (row) => y(row.player_id) + y.bandwidth() / 2);
          svg.append("g").selectAll("text").data(rows.filter((row) => row.is_jalen_green)).join("text")
            .attr("class", "suns-green__value-label")
            .attr("x", (row) => scale(row[key]) + (row[key] >= 0 ? 9 : -9))
            .attr("y", (row) => y(row.player_id) + y.bandwidth() / 2 - 6)
            .attr("text-anchor", (row) => row[key] >= 0 ? "start" : "end")
            .text((row) => signed(row[key]));
        };
        drawMarks("points_per_game_change", ppg, "suns-green-ppg-clip");
        drawMarks("true_shooting_pct_point_change", ts, "suns-green-ts-clip");
        rowCenter = (index) => y(rows[index].player_id) + y.bandwidth() / 2;
      }

      const show = (index) => {
        this.selectedIndex = Math.max(0, Math.min(rows.length - 1, index));
        const row = rows[this.selectedIndex];
        const center = rowCenter(this.selectedIndex);
        const bandHeight = narrow ? 50 : 18;
        selectedBand.attr("y", center - bandHeight / 2).attr("height", bandHeight);
        this.inspection.innerHTML = `<strong>${escapeHtml(row.player_name)}</strong> &middot; ${escapeHtml(row.rookie_season)} rookie to ${escapeHtml(row.comparison_season)}: ${signed(row.points_per_game_change)} PPG and ${signed(row.true_shooting_pct_point_change)} TS percentage points. Rookie: ${row.rookie_games} G, ${Number(row.rookie_minutes_per_game).toFixed(1)} MPG. Comparison: ${row.comparison_games} G, ${Number(row.comparison_minutes_per_game).toFixed(1)} MPG.`;
        svg.attr("aria-label", `${row.player_name}: ${signed(row.points_per_game_change)} points per game and ${signed(row.true_shooting_pct_point_change)} true-shooting percentage points three seasons after the rookie year. Use up and down arrow keys for another player.`);
      };
      const nearestIndex = (event) => {
        const [, pointerY] = d3.pointer(event, svg.node());
        return d3.leastIndex(d3.range(rows.length), (index) => Math.abs(rowCenter(index) - pointerY));
      };
      svg.on("pointermove", (event) => { if (event.pointerType !== "touch") show(nearestIndex(event)); })
        .on("click", (event) => show(nearestIndex(event)))
        .on("focus", () => show(this.selectedIndex))
        .on("keydown", (event) => {
          let next = this.selectedIndex;
          if (event.key === "ArrowDown" || event.key === "ArrowRight") next += 1;
          else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next -= 1;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = rows.length - 1;
          else return;
          event.preventDefault();
          show((next + rows.length) % rows.length);
        });
      show(this.selectedIndex);
    }

    renderCareer() {
      const completed = this.career.filter((row) => row.sample_status === "completed");
      const width = Math.max(260, Math.round(this.careerPlot.getBoundingClientRect().width));
      const narrow = width < 430;
      const height = 190;
      const margin = { top: 18, right: 16, bottom: 52, left: 42 };
      const x = d3.scalePoint().domain(completed.map((row) => row.season)).range([margin.left, width - margin.right]).padding(0.4);
      const y = d3.scaleLinear().domain(numericDomain([...completed.map((row) => row.true_shooting_plus), 100], false, 0.1)).nice(4)
        .range([height - margin.bottom, margin.top]);
      const svg = makeSvg(this.careerPlot, width, height, "suns-green__career-svg", "Jalen Green completed-season TS plus from 2021-22 through 2025-26.");
      svg.append("g").attr("class", "suns-chart__grid").attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(4).tickSize(-(width - margin.left - margin.right)).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      svg.append("g").attr("class", "suns-chart__axis").attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(4).tickSizeOuter(0).tickPadding(6));
      svg.append("line").attr("class", "suns-chart__league-average").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(100)).attr("y2", y(100));
      svg.append("text").attr("class", "suns-chart__league-label").attr("x", width - margin.right).attr("y", y(100) - 6).attr("text-anchor", "end").text("League average · 100");
      svg.append("path").datum(completed).attr("class", "suns-green__career-line")
        .attr("d", d3.line().x((row) => x(row.season)).y((row) => y(row.true_shooting_plus)));
      svg.append("g").selectAll("circle").data(completed).join("circle").attr("class", "suns-green__career-point")
        .attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row.true_shooting_plus)).attr("r", 5);
      svg.append("g").selectAll("text").data(completed).join("text").attr("class", "suns-chart__point-label")
        .attr("x", (row) => x(row.season)).attr("y", (row) => y(row.true_shooting_plus) - 9).attr("text-anchor", "middle").text((row) => row.true_shooting_plus);
      const axis = svg.append("g").attr("class", "suns-chart__axis suns-green__season-axis").attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickSizeOuter(0).tickPadding(7));
      axis.selectAll(".tick text").each(function (season) {
        const row = completed.find((item) => item.season === season);
        const text = d3.select(this).text(null).attr("y", 11).attr("dy", null);
        text.append("tspan").attr("x", 0).text(narrow ? season.slice(2).replace("-", "–") : season);
        text.append("tspan").attr("class", "suns-chart__games-label").attr("x", 0).attr("dy", 14).text(`${row.games} G`);
      });
    }

    renderTables() {
      const cohortWrap = this.root.querySelector(".suns-green__cohort-table");
      cohortWrap.innerHTML = `<h4 class="suns-chart__table-title">All-Rookie comparison</h4><table class="suns-chart__table"><caption>Three seasons after each player's rookie year; changes are comparison season minus rookie season.</caption><thead><tr><th scope="col">Player</th><th scope="col">Rookie → comparison</th><th scope="col">Rookie G / MPG</th><th scope="col">Rookie PPG / TS</th><th scope="col">Comparison G / MPG</th><th scope="col">Comparison PPG / TS</th><th scope="col">PPG change</th><th scope="col">TS pp change</th></tr></thead><tbody>${this.rows.map((row) => `<tr${row.is_jalen_green ? ' class="is-highlight"' : ""}><th scope="row">${escapeHtml(row.player_name)}</th><td>${escapeHtml(row.rookie_season)} → ${escapeHtml(row.comparison_season)}</td><td>${row.rookie_games} / ${Number(row.rookie_minutes_per_game).toFixed(1)}</td><td>${Number(row.rookie_points_per_game).toFixed(1)} / ${percent(row.rookie_true_shooting_pct)}</td><td>${row.comparison_games} / ${Number(row.comparison_minutes_per_game).toFixed(1)}</td><td>${Number(row.comparison_points_per_game).toFixed(1)} / ${percent(row.comparison_true_shooting_pct)}</td><td>${signed(row.points_per_game_change)}</td><td>${signed(row.true_shooting_pct_point_change)}</td></tr>`).join("")}</tbody></table>`;
      const careerWrap = this.root.querySelector(".suns-green__career-table");
      careerWrap.innerHTML = `<h4 class="suns-chart__table-title">Jalen Green career efficiency</h4><table class="suns-chart__table"><caption>Regular-season TS+ and supporting values; 2026-27 is a 13-game snapshot.</caption><thead><tr><th scope="col">Season</th><th scope="col">Status</th><th scope="col">G</th><th scope="col">Minutes</th><th scope="col">TS%</th><th scope="col">TS+</th><th scope="col">PTS/100</th></tr></thead><tbody>${this.career.map((row) => `<tr${row.sample_status !== "completed" ? ' class="is-highlight"' : ""}><th scope="row">${row.season}</th><td>${row.sample_status === "completed" ? "Completed" : "13-game snapshot"}</td><td>${row.games}</td><td>${row.total_minutes}</td><td>${percent(row.true_shooting_pct)}</td><td>${row.true_shooting_plus}</td><td>${Number(row.points_per_100).toFixed(1)}</td></tr>`).join("")}</tbody></table>`;
    }
  }

  class SunsBookerChart {
    constructor(root) {
      this.root = root;
      this.plot = root.querySelector(".suns-booker__history-plot");
    }

    async init() {
      if (this.promise) return this.promise;
      this.promise = d3.csv(this.root.dataset.source, parseBooker).then((rows) => {
        if (rows.length !== 8 || rows.filter((row) => row.sample_status === "completed").length !== 7) throw new Error("Unexpected Booker season count.");
        this.rows = rows;
        this.renderTable();
        this.render();
        observe(this, [this.plot]);
        this.root.dataset.chartReady = "true";
        this.root.setAttribute("aria-busy", "false");
      }).catch((error) => fail(this.root, error));
      return this.promise;
    }

    render() {
      if (!this.rows || this.plot.getBoundingClientRect().width < 40) return;
      const completed = this.rows.filter((row) => row.sample_status === "completed");
      const width = Math.max(280, Math.round(this.plot.getBoundingClientRect().width));
      const narrow = width < 520;
      const margin = { top: 18, right: 18, bottom: 50, left: 52 };
      const panelHeight = 112;
      const plotHeight = 78;
      const height = margin.top + panelHeight * 2 + plotHeight + margin.bottom;
      const x = d3.scalePoint().domain(completed.map((row) => row.season)).range([margin.left, width - margin.right]).padding(0.32);
      const configs = [
        { key: "points_per_100", label: "Points per 100 possessions", ticks: 4, format: d3.format(".1f") },
        { key: "assists_per_100", label: "Assists per 100 possessions", ticks: 4, format: d3.format(".1f") },
        { key: "true_shooting_plus", label: "TS+", ticks: 4, format: d3.format("d"), baseline: 100 },
      ];
      const svg = makeSvg(this.plot, width, height, "suns-booker__career-svg", "Three aligned completed-season panels show Devin Booker's points and assists per 100 possessions and TS plus from 2019-20 through 2025-26.");
      configs.forEach((config, index) => {
        const panelTop = margin.top + index * panelHeight;
        const values = completed.map((row) => row[config.key]);
        if (config.baseline !== undefined) values.push(config.baseline);
        const y = d3.scaleLinear().domain(numericDomain(values, false, 0.15)).nice(config.ticks)
          .range([panelTop + plotHeight, panelTop + 22]);
        svg.append("text").attr("class", "suns-booker__panel-label").attr("x", 3).attr("y", panelTop + 12).text(config.label);
        svg.append("g").attr("class", "suns-chart__grid").attr("transform", `translate(${margin.left},0)`)
          .call(d3.axisLeft(y).ticks(config.ticks).tickSize(-(width - margin.left - margin.right)).tickFormat(""))
          .call((group) => group.select(".domain").remove());
        svg.append("g").attr("class", "suns-chart__axis").attr("transform", `translate(${margin.left},0)`)
          .call(d3.axisLeft(y).ticks(config.ticks).tickSizeOuter(0).tickPadding(5).tickFormat(config.format));
        if (config.baseline !== undefined) {
          svg.append("line").attr("class", "suns-chart__league-average").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(config.baseline)).attr("y2", y(config.baseline));
          svg.append("text").attr("class", "suns-chart__league-label").attr("x", width - margin.right).attr("y", panelTop + 12).attr("text-anchor", "end").text("League average · 100");
        }
        svg.append("path").datum(completed).attr("class", "suns-booker__line")
          .attr("d", d3.line().x((row) => x(row.season)).y((row) => y(row[config.key])));
        svg.append("g").selectAll("circle").data(completed).join("circle").attr("class", "suns-booker__point")
          .attr("cx", (row) => x(row.season)).attr("cy", (row) => y(row[config.key])).attr("r", 4.5);
        svg.append("g").selectAll("text").data(completed).join("text").attr("class", "suns-chart__point-label")
          .attr("x", (row) => x(row.season)).attr("y", (row) => y(row[config.key]) - 8).attr("text-anchor", "middle")
          .text((row) => config.key === "true_shooting_plus" ? row[config.key] : Number(row[config.key]).toFixed(1));
      });
      const axisY = margin.top + panelHeight * 2 + plotHeight;
      const axis = svg.append("g").attr("class", "suns-chart__axis suns-booker__season-axis").attr("transform", `translate(0,${axisY})`)
        .call(d3.axisBottom(x).tickSizeOuter(0).tickPadding(7));
      axis.selectAll(".tick text").each(function (season, index) {
        const row = completed.find((item) => item.season === season);
        const text = d3.select(this).text(null).attr("y", 8).attr("dy", null);
        text.append("tspan").attr("x", 0).attr("dy", 0)
          .text(narrow ? `’${season.slice(-2)}` : season);
        text.append("tspan").attr("class", "suns-chart__games-label").attr("x", 0).attr("dy", 14).text(`${row.games} G`);
      });
    }

    renderTable() {
      const wrap = this.root.querySelector(".suns-booker__table");
      wrap.innerHTML = `<table class="suns-chart__table"><caption>Devin Booker regular-season career trajectory; 2026-27 is a 13-game snapshot.</caption><thead><tr><th scope="col">Season</th><th scope="col">Status</th><th scope="col">G</th><th scope="col">Minutes</th><th scope="col">MPG</th><th scope="col">PTS/100</th><th scope="col">AST/100</th><th scope="col">TS%</th><th scope="col">TS+</th></tr></thead><tbody>${this.rows.map((row) => `<tr${row.sample_status !== "completed" ? ' class="is-highlight"' : ""}><th scope="row">${row.season}</th><td>${row.sample_status === "completed" ? "Completed" : "13-game snapshot"}</td><td>${row.games}</td><td>${row.total_minutes}</td><td>${Number(row.minutes_per_game).toFixed(1)}</td><td>${Number(row.points_per_100).toFixed(1)}</td><td>${Number(row.assists_per_100).toFixed(1)}</td><td>${percent(row.true_shooting_pct)}</td><td>${row.true_shooting_plus}</td></tr>`).join("")}</tbody></table>`;
    }
  }

  class SunsTeamChart {
    constructor(root) {
      this.root = root;
      this.plot = root.querySelector(".suns-team__plot");
    }

    async init() {
      if (this.promise) return this.promise;
      this.promise = d3.csv(this.root.dataset.source, parseTeam).then((rows) => {
        if (rows.length !== 2) throw new Error("Unexpected Phoenix team row count.");
        this.rows = rows;
        this.renderTable();
        this.render();
        observe(this, [this.plot]);
        this.root.dataset.chartReady = "true";
        this.root.setAttribute("aria-busy", "false");
      }).catch((error) => fail(this.root, error));
      return this.promise;
    }

    render() {
      if (!this.rows || this.plot.getBoundingClientRect().width < 40) return;
      const width = Math.max(280, Math.round(this.plot.getBoundingClientRect().width));
      const rowHeight = 120;
      const height = rowHeight * 3;
      const left = width < 430 ? 30 : 40;
      const right = width < 430 ? 30 : 40;
      const completed = this.rows.find((row) => row.sample_status === "completed");
      const current = this.rows.find((row) => row.sample_status !== "completed");
      const configs = [
        { key: "defensive_rating", rank: "defensive_rating_rank", label: "Defensive rating", direction: "Lower is better", domain: [110, 122], ticks: [110, 114, 118, 122], suffix: "" },
        { key: "defensive_rebound_pct", rank: "defensive_rebound_pct_rank", label: "Defensive rebound percentage", direction: "Higher is better", domain: [64, 75], ticks: [65, 70, 75], suffix: "%" },
        { key: "offensive_rebound_pct", rank: "offensive_rebound_pct_rank", label: "Offensive rebound percentage", direction: "Higher is better", domain: [24, 31], ticks: [24, 28, 31], suffix: "%" },
      ];
      const svg = makeSvg(this.plot, width, height, "suns-team__svg", "Paired comparisons of Phoenix defensive rating and rebound percentages in 2025-26 and the first 13 games of 2026-27.");
      const colors = palette(this.root);
      configs.forEach((config, index) => {
        const base = index * rowHeight;
        const y = base + 58;
        const x = d3.scaleLinear().domain(config.domain).range([left, width - right]);
        const completedX = x(completed[config.key]);
        const currentX = x(current[config.key]);
        svg.append("text").attr("class", "suns-booker__panel-label").attr("x", left).attr("y", base + 19).text(config.label);
        svg.append("text").attr("class", "suns-team__direction")
          .attr("x", width < 430 ? (completedX < width / 2 ? width - right : left) : width - right)
          .attr("y", base + (width < 430 ? 33 : 19))
          .attr("text-anchor", width < 430 ? (completedX < width / 2 ? "end" : "start") : "end")
          .text(config.direction);
        svg.append("line").attr("class", "suns-team__track").attr("x1", x(config.domain[0])).attr("x2", x(config.domain[1])).attr("y1", y).attr("y2", y);
        svg.append("line").attr("class", "suns-team__connector").attr("x1", completedX).attr("x2", currentX).attr("y1", y).attr("y2", y);
        svg.append("rect").attr("class", "suns-team__completed-mark").attr("x", completedX - 5).attr("y", y - 5).attr("width", 10).attr("height", 10)
          .attr("data-season", completed.season).attr("data-value", completed[config.key]).attr("data-x", completedX);
        svg.append("circle").attr("class", "suns-team__current-mark").attr("cx", currentX).attr("cy", y).attr("r", 6)
          .attr("data-season", current.season).attr("data-value", current[config.key]).attr("data-x", currentX);
        svg.append("text").attr("class", "suns-team__mark-label").attr("x", completedX).attr("y", y - 21).attr("text-anchor", "middle")
          .text(`${Number(completed[config.key]).toFixed(1)}${config.suffix}`);
        svg.append("text").attr("class", "suns-team__rank-label").attr("x", completedX).attr("y", y - 10).attr("text-anchor", "middle")
          .text(`${ordinal(completed[config.rank])} · 2025-26`);
        svg.append("text").attr("class", "suns-team__mark-label").attr("x", currentX).attr("y", y + 20).attr("text-anchor", "middle")
          .text(`${Number(current[config.key]).toFixed(1)}${config.suffix}`);
        svg.append("text").attr("class", "suns-team__rank-label").attr("x", currentX).attr("y", y + 32).attr("text-anchor", "middle")
          .text(`${ordinal(current[config.rank])} · 2026-27`);
        svg.append("g").attr("class", "suns-chart__axis").attr("transform", `translate(0,${base + 98})`)
          .call(d3.axisBottom(x).tickValues(config.ticks).tickSize(4).tickSizeOuter(0).tickPadding(4).tickFormat((value) => `${value}${config.suffix}`));
      });
    }

    renderTable() {
      const wrap = this.root.querySelector(".suns-team__table");
      wrap.innerHTML = `<table class="suns-chart__table"><caption>Phoenix team defense and rebounding; 2026-27 covers 13 games.</caption><thead><tr><th scope="col">Season</th><th scope="col">Record</th><th scope="col">DRtg (rank)</th><th scope="col">DRB% (rank)</th><th scope="col">ORB% (rank)</th><th scope="col">SOS (rank)</th><th scope="col">SRS (rank)</th></tr></thead><tbody>${this.rows.map((row) => `<tr${row.sample_status !== "completed" ? ' class="is-highlight"' : ""}><th scope="row">${row.season}${row.sample_status === "completed" ? "" : " · 13 games"}</th><td>${row.wins}-${row.losses}</td><td>${Number(row.defensive_rating).toFixed(1)} (${ordinal(row.defensive_rating_rank)})</td><td>${Number(row.defensive_rebound_pct).toFixed(1)}% (${ordinal(row.defensive_rebound_pct_rank)})</td><td>${Number(row.offensive_rebound_pct).toFixed(1)}% (${ordinal(row.offensive_rebound_pct_rank)})</td><td>${Number(row.strength_of_schedule).toFixed(2)} (${ordinal(row.strength_of_schedule_rank)})</td><td>${Number(row.simple_rating_system).toFixed(2)} (${ordinal(row.simple_rating_system_rank)})</td></tr>`).join("")}</tbody></table>`;
    }
  }

  const mount = (root, Chart) => {
    const chart = new Chart(root);
    const card = root.closest("details");
    const start = () => chart.init();
    if (!card || card.open) start();
    else card.addEventListener("toggle", () => { if (card.open) start(); });
  };

  document.querySelectorAll("[data-suns-green-chart]").forEach((root) => mount(root, SunsGreenChart));
  document.querySelectorAll("[data-suns-booker-chart]").forEach((root) => mount(root, SunsBookerChart));
  document.querySelectorAll("[data-suns-team-chart]").forEach((root) => mount(root, SunsTeamChart));
})();
