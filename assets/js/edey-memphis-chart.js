(function initializeEdeyMemphisModule() {
  "use strict";

  const QUALIFIERS = 72;
  const EDEY_ID = "edeyza01";
  const METRICS = [
    { key: "orb_pct", label: "Offensive rebound percentage", expectedValue: 17.3, expectedRank: 5 },
    { key: "trb_pct", label: "Total rebound percentage", expectedValue: 20.9, expectedRank: 14 },
    { key: "blk_pct", label: "Block percentage", expectedValue: 5.7, expectedRank: 16 },
    { key: "ts_pct", label: "True shooting percentage", expectedValue: 0.632, expectedRank: 27 },
  ];
  const SEASONS = ["2024-25", "2025-26"];
  const ON_OFF_METRICS = [
    { key: "team_orb_pct", title: "Memphis offensive rebound percentage", domain: [20, 36], ticks: [20, 24, 28, 32, 36], expected: [9.0, 4.1] },
    { key: "team_drb_pct", title: "Memphis defensive rebound percentage", domain: [65, 86], ticks: [65, 70, 75, 80, 85], expected: [3.9, 13.5] },
  ];
  let instanceCount = 0;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function number(row, field, context) {
    if (row[field] == null || String(row[field]).trim() === "") throw new Error(`Missing ${field} for ${context}.`);
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field} for ${context}.`);
    return value;
  }

  function signed(value, suffix = "") {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
  }

  function displaySeason(season) {
    return season.replace("-", "\u2013");
  }

  function ordinal(value) {
    const remainder100 = value % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
    return `${value}${{ 1: "st", 2: "nd", 3: "rd" }[value % 10] || "th"}`;
  }

  function validateData(peers, profile, onOff) {
    if (peers.length !== QUALIFIERS || new Set(peers.map((row) => row.player_id)).size !== QUALIFIERS) {
      throw new Error(`Expected ${QUALIFIERS} unique joined player IDs; found ${peers.length}.`);
    }
    if (profile.length !== METRICS.length) throw new Error(`Expected four Edey profile rows; found ${profile.length}.`);
    const edey = peers.find((row) => row.player_id === EDEY_ID);
    if (!edey || edey.player_name !== "Zach Edey" || edey.games !== "77" || edey.total_minutes !== "1700") {
      throw new Error("Edey's joined identity or visible sample metadata is invalid.");
    }

    METRICS.forEach((metric, index) => {
      const row = profile[index];
      if (row.metric_key !== metric.key || row.metric_label !== metric.label) throw new Error(`Profile row ${index + 1} changed order or identity.`);
      const values = peers.map((peer) => number(peer, metric.key, `${peer.player_id} ${metric.key}`));
      if (values.length !== QUALIFIERS) throw new Error(`${metric.key} does not have 72 valid observations.`);
      const edeyValue = number(edey, metric.key, `Edey ${metric.key}`);
      const computedRank = 1 + values.filter((value) => value > edeyValue).length;
      const tied = values.filter((value) => value === edeyValue).length > 1;
      if (Math.abs(edeyValue - metric.expectedValue) > 1e-9 || computedRank !== metric.expectedRank) {
        throw new Error(`${metric.key} does not match the verified Edey value/rank.`);
      }
      if (number(row, "source_value", metric.key) !== edeyValue || number(row, "rank", metric.key) !== computedRank) {
        throw new Error(`${metric.key} profile output disagrees with the joined data.`);
      }
      if (number(row, "valid_qualifiers", metric.key) !== QUALIFIERS || (row.is_tied === "true") !== tied) {
        throw new Error(`${metric.key} valid count or tie flag is incorrect.`);
      }
    });

    if (onOff.length !== 4) throw new Error(`Expected four Memphis on/off rows; found ${onOff.length}.`);
    const expected = {
      "2024-25|on": [1418, 120.1, 114.5, 5.7, 34.5, 77.4],
      "2024-25|off": [2525, 117.4, 112.9, 4.6, 25.5, 73.5],
      "2025-26|on": [284, 115.3, 97.6, 17.7, 28.5, 83.2],
      "2025-26|off": [3664, 113.7, 121.3, -7.7, 24.4, 69.7],
    };
    const seen = new Set();
    onOff.forEach((row) => {
      const key = `${row.season}|${row.split}`;
      if (!expected[key] || seen.has(key)) throw new Error(`Unexpected or duplicate on/off identity ${key}.`);
      seen.add(key);
      const actual = ["minutes", "team_ortg", "team_drtg", "source_net_rating", "team_orb_pct", "team_drb_pct"].map((field) => number(row, field, key));
      if (actual.some((value, index) => Math.abs(value - expected[key][index]) > 1e-9)) throw new Error(`${key} does not match the supplied transcription.`);
    });
    ON_OFF_METRICS.forEach((metric) => {
      SEASONS.forEach((season, index) => {
        const on = onOff.find((row) => row.season === season && row.split === "on");
        const off = onOff.find((row) => row.season === season && row.split === "off");
        const change = number(on, metric.key, `${season} on`) - number(off, metric.key, `${season} off`);
        if (Math.abs(change - metric.expected[index]) > 1e-9) throw new Error(`${season} ${metric.key} change is incorrect.`);
      });
    });
  }

  class EdeyMemphisChart {
    constructor(root) {
      this.root = root;
      this.instanceId = `edey-memphis-${++instanceCount}`;
      this.rankPlot = root.querySelector(".edey-package__rank-plot");
      this.onOffPlot = root.querySelector(".edey-package__onoff-plot");
      this.inspection = root.querySelector(".edey-package__inspection");
      this.profileTableWrap = root.querySelector(".edey-package__profile-table-wrap");
      this.ratingsWrap = root.querySelector(".edey-package__ratings-wrap");
      this.loadPromise = null;
      this.resizeFrame = 0;
      this.lastRankWidth = 0;
      this.lastOnOffWidth = 0;
      this.rankPositions = [];
      this.onOffStates = [];
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
      this.resizeObserver.observe(this.rankPlot);
      this.resizeObserver.observe(this.onOffPlot);
    }

    load() {
      if (this.loadPromise) return this.loadPromise;
      this.root.setAttribute("aria-busy", "true");
      this.loadPromise = Promise.all([
        d3.csv(this.root.dataset.peerSource),
        d3.csv(this.root.dataset.profileSource),
        d3.csv(this.root.dataset.onoffSource),
      ]).then(([peers, profile, onOff]) => {
        validateData(peers, profile, onOff);
        this.peers = peers;
        this.profile = profile;
        this.onOff = onOff;
        this.root.setAttribute("aria-busy", "false");
        this.renderTables();
        this.render(true);
      }).catch((error) => this.showError(error));
      return this.loadPromise;
    }

    showError(error) {
      this.root.setAttribute("aria-busy", "false");
      this.root.dataset.edeyState = "error";
      this.rankPlot.innerHTML = '<p class="edey-package__status edey-package__status--error">Edey\'s validated profile could not be displayed. The processed CSVs remain available below.</p>';
      this.onOffPlot.innerHTML = '<p class="edey-package__status edey-package__status--error">Memphis on/off values could not be displayed.</p>';
      this.inspection.textContent = "The graphic data did not load or pass validation.";
      console.error("Edey / Memphis chart data error:", error);
    }

    scheduleRender() {
      if (!this.profile || this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        this.render();
      });
    }

    render(force = false) {
      const rankWidth = Math.round(this.rankPlot.getBoundingClientRect().width);
      const onOffWidth = Math.round(this.onOffPlot.getBoundingClientRect().width);
      if (!rankWidth || !onOffWidth) return;
      if (force || Math.abs(rankWidth - this.lastRankWidth) >= 2) {
        this.lastRankWidth = rankWidth;
        this.renderRanks();
      }
      if (force || Math.abs(onOffWidth - this.lastOnOffWidth) >= 2) {
        this.lastOnOffWidth = onOffWidth;
        this.renderOnOff();
      }
      this.root.dataset.edeyState = "ready";
    }

    renderRanks() {
      this.rankPlot.replaceChildren();
      this.rankPositions = [];
      const rows = d3.select(this.rankPlot).append("div").attr("class", "edey-rank__rows")
        .selectAll("div.edey-rank__row").data(this.profile).join("div").attr("class", "edey-rank__row");
      rows.append("div").attr("class", "edey-rank__metric").html((row) =>
        `<strong>${escapeHtml(row.metric_label)}</strong>`,
      );
      rows.append("div").attr("class", "edey-rank__track");
      rows.each((row, index, nodes) => this.renderRankTrack(nodes[index].querySelector(".edey-rank__track"), row, index));

      const axis = d3.select(this.rankPlot).append("div").attr("class", "edey-rank__axis");
      axis.append("div").attr("class", "edey-rank__axis-label").text("Rank among 72 qualifiers \u00b7 1st is highest.");
      const axisNode = axis.append("div").node();
      const width = Math.max(150, Math.round(axisNode.getBoundingClientRect().width));
      const scale = d3.scaleLinear().domain([72, 1]).range([8, width - 8]);
      const svg = d3.select(axisNode).append("svg").attr("viewBox", `0 0 ${width} 31`).attr("aria-hidden", "true");
      svg.append("g").attr("transform", "translate(0,4)")
        .call(d3.axisBottom(scale).tickValues([72, 54, 36, 18, 1]).tickSize(5).tickFormat((value) => ordinal(value)));
    }

    renderRankTrack(node, row, index) {
      const width = Math.max(150, Math.round(node.getBoundingClientRect().width));
      const height = 52;
      const x = d3.scaleLinear().domain([72, 1]).range([8, width - 8]);
      const markerX = x(Number(row.rank));
      this.rankPositions.push({ key: row.metric_key, rank: Number(row.rank), markerX, domain: x.domain(), range: x.range() });
      const svg = d3.select(node).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img").attr("aria-labelledby", `${this.instanceId}-rank-${index}-title ${this.instanceId}-rank-${index}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-rank-${index}-title`).text(`${row.metric_label}: ${row.display_value}, rank ${row.rank_display} of 72`);
      svg.append("desc").attr("id", `${this.instanceId}-rank-${index}-desc`).text("Marker position encodes rank only, with 72nd at left and 1st at right.");
      svg.append("line").attr("class", "edey-rank__line").attr("x1", x(72)).attr("x2", x(1)).attr("y1", 29).attr("y2", 29);
      svg.append("line").attr("class", "edey-rank__line-strong").attr("x1", x(72)).attr("x2", markerX).attr("y1", 29).attr("y2", 29);
      svg.append("circle").attr("class", "edey-rank__marker").attr("cx", markerX).attr("cy", 29).attr("r", 7);
      const rightSide = markerX > width * 0.61;
      svg.append("text").attr("class", "edey-rank__label").attr("x", markerX + (rightSide ? -12 : 12)).attr("y", 15)
        .attr("text-anchor", rightSide ? "end" : "start").text(`${row.display_value} \u00b7 ${row.rank_display} of 72`);
      svg.append("circle").attr("class", "edey-rank__hit").attr("cx", markerX).attr("cy", 29).attr("r", 18)
        .attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", `${row.metric_label}: ${row.display_value}; rank ${row.rank_display} of 72. Position encodes rank, not statistical magnitude.`)
        .on("pointerenter pointerdown focus click", () => {
          this.inspection.textContent = `${row.metric_label}: ${row.display_value}; ${row.rank_display} of 72 qualifiers. Marker position encodes rank only.`;
        }).on("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.inspection.textContent = `${row.metric_label}: ${row.display_value}; ${row.rank_display} of 72 qualifiers. Marker position encodes rank only.`;
          }
        });
    }

    renderOnOff() {
      this.onOffPlot.replaceChildren();
      this.onOffStates = [];
      const panels = d3.select(this.onOffPlot).selectAll("section").data(ON_OFF_METRICS).join("section").attr("class", "edey-onoff__panel");
      panels.append("h4").text((metric) => metric.title);
      panels.append("p").attr("class", "edey-onoff__panel-note").text("Team percentage \u00b7 change is On minus Off");
      panels.each((metric, index, nodes) => this.renderOnOffPanel(nodes[index], metric, index));
    }

    renderOnOffPanel(node, metric, metricIndex) {
      const width = Math.max(280, Math.round(node.getBoundingClientRect().width) - 16);
      const height = 226;
      const left = width < 340 ? 67 : 76;
      const right = width - (width < 340 ? 48 : 54);
      const axisY = 49;
      const y = d3.scalePoint().domain(SEASONS).range([92, 164]);
      const x = d3.scaleLinear().domain(metric.domain).range([left, right]);
      this.onOffStates.push({ key: metric.key, x, y });
      const svg = d3.select(node).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
        .attr("aria-labelledby", `${this.instanceId}-onoff-${metricIndex}-title ${this.instanceId}-onoff-${metricIndex}-desc`);
      svg.append("title").attr("id", `${this.instanceId}-onoff-${metricIndex}-title`).text(metric.title);
      svg.append("desc").attr("id", `${this.instanceId}-onoff-${metricIndex}-desc`).text("Two season rows compare Memphis with Edey on court and off court. Values and on-minus-off percentage-point changes are directly labeled.");
      metric.ticks.forEach((tick) => {
        svg.append("line").attr("class", "edey-onoff__grid").attr("x1", x(tick)).attr("x2", x(tick)).attr("y1", axisY).attr("y2", 185);
        svg.append("text").attr("class", "edey-onoff__tick").attr("x", x(tick)).attr("y", 39).attr("text-anchor", "middle").text(`${tick}%`);
      });
      svg.append("line").attr("class", "edey-onoff__axis").attr("x1", left).attr("x2", right).attr("y1", axisY).attr("y2", axisY);

      SEASONS.forEach((season) => {
        const on = this.onOff.find((row) => row.season === season && row.split === "on");
        const off = this.onOff.find((row) => row.season === season && row.split === "off");
        const onValue = number(on, metric.key, `${season} on`);
        const offValue = number(off, metric.key, `${season} off`);
        const cy = y(season);
        svg.append("text").attr("class", "edey-onoff__season").attr("x", left - 9).attr("y", cy - 3).attr("text-anchor", "end").text(displaySeason(season));
        svg.append("text").attr("class", "edey-onoff__minutes").attr("x", left - 9).attr("y", cy + 10).attr("text-anchor", "end").text(`${Number(on.minutes).toLocaleString("en-US")} on min.`);
        svg.append("line").attr("class", "edey-onoff__connector").attr("x1", x(offValue)).attr("x2", x(onValue)).attr("y1", cy).attr("y2", cy);
        this.appendOnOffMark(svg, metric, season, off, offValue, x(offValue), cy, "off");
        this.appendOnOffMark(svg, metric, season, on, onValue, x(onValue), cy, "on");
        svg.append("text").attr("class", "edey-onoff__delta").attr("x", width - 2).attr("y", cy + 4).attr("text-anchor", "end").text(signed(onValue - offValue, " pp"));
      });
    }

    appendOnOffMark(svg, metric, season, row, value, cx, cy, split) {
      const mark = split === "on"
        ? svg.append("circle").attr("class", "edey-onoff__mark edey-onoff__mark--on").attr("cx", cx).attr("cy", cy).attr("r", 6)
        : svg.append("rect").attr("class", "edey-onoff__mark edey-onoff__mark--off").attr("x", cx - 5.5).attr("y", cy - 5.5).attr("width", 11).attr("height", 11);
      mark.attr("data-season", season).attr("data-split", split).attr("data-metric", metric.key);
      svg.append("text").attr("class", `edey-onoff__value edey-onoff__value--${split}`).attr("x", cx).attr("y", cy + (split === "on" ? -11 : 18)).attr("text-anchor", "middle").text(`${value.toFixed(1)}%`);
      svg.append("circle").attr("class", "edey-onoff__hit").attr("cx", cx).attr("cy", cy).attr("r", 18)
        .attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", `${displaySeason(season)}, Edey ${split} court, ${metric.title} ${value.toFixed(1)}%, ${Number(row.minutes).toLocaleString("en-US")} ${split}-court minutes.`)
        .on("pointerenter pointerdown focus click", () => {
          this.inspection.textContent = `${displaySeason(season)} \u00b7 Edey ${split} court \u00b7 ${metric.title}: ${value.toFixed(1)}% \u00b7 ${Number(row.minutes).toLocaleString("en-US")} minutes.`;
        }).on("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.inspection.textContent = `${displaySeason(season)} \u00b7 Edey ${split} court \u00b7 ${metric.title}: ${value.toFixed(1)}% \u00b7 ${Number(row.minutes).toLocaleString("en-US")} minutes.`;
          }
        });
    }

    renderTables() {
      this.profileTableWrap.innerHTML = `<table class="edey-package__table">
        <caption>Zach Edey's values and descending competition ranks among 72 qualifying centers and center/forwards</caption>
        <thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">Rank</th><th scope="col">Valid</th></tr></thead>
        <tbody>${this.profile.map((row) => `<tr><th scope="row">${escapeHtml(row.metric_label)}</th><td>${escapeHtml(row.display_value)}</td><td>${escapeHtml(row.rank_display)} of 72</td><td>${escapeHtml(row.valid_qualifiers)}</td></tr>`).join("")}</tbody>
      </table>`;

      const seasonRows = SEASONS.map((season) => {
        const on = this.onOff.find((row) => row.season === season && row.split === "on");
        const off = this.onOff.find((row) => row.season === season && row.split === "off");
        const values = {
          ortg: number(on, "team_ortg", "on ORtg") - number(off, "team_ortg", "off ORtg"),
          drtg: number(on, "team_drtg", "on DRtg") - number(off, "team_drtg", "off DRtg"),
          net: number(on, "source_net_rating", "on net") - number(off, "source_net_rating", "off net"),
        };
        const cell = (label, value, sign = false) => `<td data-label="${label}"${sign && value > 0 ? ' data-sign="positive"' : ""}>${sign ? signed(value) : escapeHtml(value)}</td>`;
        return `<tr>
          <th scope="row" data-label="Season">${displaySeason(season)}</th>
          ${cell("On minutes", Number(on.minutes).toLocaleString("en-US"))}${cell("Off minutes", Number(off.minutes).toLocaleString("en-US"))}
          ${cell("OffRtg On / Off", `${Number(on.team_ortg).toFixed(1)} / ${Number(off.team_ortg).toFixed(1)}`)}${cell("OffRtg change", values.ortg, true)}
          ${cell("DefRtg On / Off", `${Number(on.team_drtg).toFixed(1)} / ${Number(off.team_drtg).toFixed(1)}`)}${cell("DefRtg change", values.drtg, true)}
          ${cell("Source Net On / Off", `${signed(Number(on.source_net_rating))} / ${signed(Number(off.source_net_rating))}`)}${cell("Net change", values.net, true)}
        </tr>`;
      }).join("");
      this.ratingsWrap.innerHTML = `<table class="edey-package__table edey-package__ratings-table">
        <caption>Memphis team on/off ratings and explicit minutes from the supplied Basketball Reference transcription</caption>
        <thead><tr><th scope="col">Season</th><th scope="col">On min.</th><th scope="col">Off min.</th><th scope="col">OffRtg On / Off</th><th scope="col">\u0394</th><th scope="col">DefRtg On / Off</th><th scope="col">\u0394</th><th scope="col">Source Net On / Off</th><th scope="col">\u0394</th></tr></thead>
        <tbody>${seasonRows}</tbody>
      </table>`;
    }
  }

  function initialize() {
    document.querySelectorAll("[data-edey-memphis-chart]").forEach((root) => {
      if (root.dataset.edeyInitialized === "true") return;
      root.dataset.edeyInitialized = "true";
      if (!window.d3) {
        root.querySelectorAll(".edey-package__status").forEach((status) => {
          status.className = "edey-package__status edey-package__status--error";
          status.textContent = "The chart library could not be loaded. The processed CSVs remain available.";
        });
        return;
      }
      const chart = new EdeyMemphisChart(root);
      root.edeyMemphisChart = chart;
      const card = root.closest("details");
      const loadWhenVisible = () => {
        if (!card || card.open) {
          if (chart.profile) chart.scheduleRender();
          else requestAnimationFrame(() => chart.load());
        }
      };
      if (card) card.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  window.validateEdeyMemphisData = validateData;
  initialize();
})();
