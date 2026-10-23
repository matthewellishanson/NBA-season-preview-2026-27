(function () {
  "use strict";

  const d3 = window.d3;
  const SEASONS = ["2023-24", "2024-25", "2025-26"];
  const LATEST = "2025-26";
  const PLAYER_CONFIG = {
    "jalen-johnson": {
      name: "Jalen Johnson",
      panels: [
        { key: "pointsPer100", title: "Points per 100 possessions", domain: [14, 32], ticks: [15, 20, 25, 30], format: value => value.toFixed(1) },
        { key: "assistsPer100", title: "Assists per 100 possessions", domain: [4, 12], ticks: [4, 6, 8, 10, 12], format: value => value.toFixed(1) },
      ],
    },
    "nickeil-alexander-walker": {
      name: "Nickeil Alexander-Walker",
      panels: [
        { key: "pointsPer100", title: "Points per 100 possessions", domain: [14, 32], ticks: [15, 20, 25, 30], format: value => value.toFixed(1) },
        { key: "trueShooting", title: "True shooting percentage", domain: [0.55, 0.63], ticks: [0.56, 0.58, 0.60, 0.62], format: value => `${(value * 100).toFixed(1)}%`, axis: value => `${Math.round(value * 100)}%` },
      ],
    },
  };
  let instanceCount = 0;

  function parseRow(row) {
    return {
      playerId: row.player_id,
      playerName: row.player_name,
      playerSlug: row.player_slug,
      season: row.season,
      team: row.source_team,
      games: Number(row.games),
      mpg: Number(row.minutes_per_game),
      pointsPer100: Number(row.points_per_100),
      assistsPer100: Number(row.assists_per_100),
      trueShooting: Number(row.ts_pct),
    };
  }

  function displaySeason(season) {
    return season.replace("-", "\u2013");
  }

  function validate(rows) {
    if (rows.length !== 6) throw new Error(`Expected six player-seasons; found ${rows.length}.`);
    const identities = new Set(rows.map(row => `${row.playerId}|${row.season}|${row.team}`));
    if (identities.size !== rows.length) throw new Error("Player-season-team records are duplicated.");
    Object.entries(PLAYER_CONFIG).forEach(([slug, config]) => {
      const playerRows = rows.filter(row => row.playerSlug === slug);
      if (playerRows.map(row => row.season).join("|") !== SEASONS.join("|")) {
        throw new Error(`${config.name}: incomplete or unordered season coverage.`);
      }
      playerRows.forEach(row => {
        [row.games, row.mpg, row.pointsPer100, row.assistsPer100, row.trueShooting].forEach(value => {
          if (!Number.isFinite(value)) throw new Error(`${config.name} ${row.season}: non-finite value.`);
        });
      });
    });
    const expected = new Map([
      ["jalen-johnson|2023-24", ["ATL", 56, 33.7, 22.7, 5.2, 0.584]],
      ["jalen-johnson|2024-25", ["ATL", 36, 35.7, 24.8, 6.6, 0.569]],
      ["jalen-johnson|2025-26", ["ATL", 72, 35.2, 30.2, 10.6, 0.581]],
      ["nickeil-alexander-walker|2023-24", ["MIN", 82, 23.4, 16.9, 5.2, 0.578]],
      ["nickeil-alexander-walker|2024-25", ["MIN", 82, 25.3, 18.4, 5.3, 0.579]],
      ["nickeil-alexander-walker|2025-26", ["ATL", 78, 33.4, 29.5, 5.2, 0.610]],
    ]);
    rows.forEach(row => {
      const actual = [row.team, row.games, row.mpg, row.pointsPer100, row.assistsPer100, row.trueShooting];
      if (JSON.stringify(actual) !== JSON.stringify(expected.get(`${row.playerSlug}|${row.season}`))) {
        throw new Error(`${row.playerName} ${row.season}: value differs from validated source.`);
      }
    });
  }

  class HawksEmergingStarsChart {
    constructor(root) {
      this.root = root;
      this.id = `hawks-emerging-${++instanceCount}`;
      this.rows = [];
      this.width = 0;
      this.renderQueued = false;
      this.resizeObserver = new ResizeObserver(() => this.queueRender());
      this.resizeObserver.observe(root.querySelector(".hawks-stars__players"));
    }

    load() {
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = d3.csv(this.root.dataset.source, parseRow).then(rows => {
        validate(rows);
        this.rows = rows;
        this.root.setAttribute("aria-busy", "false");
        this.root.querySelector(".hawks-stars__status")?.remove();
        this.render(true);
      }).catch(error => {
        console.error("Hawks emerging-stars chart data error:", error);
        this.root.setAttribute("aria-busy", "false");
        const status = this.root.querySelector(".hawks-stars__status");
        status.className = "hawks-stars__status hawks-stars__status--error";
        status.textContent = "The chart could not be displayed. The complete validated data table remains available below.";
      });
      return this.loadPromise;
    }

    queueRender() {
      if (!this.rows.length || this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render();
      });
    }

    render(force = false) {
      const players = this.root.querySelector(".hawks-stars__players");
      const width = Math.floor(players.getBoundingClientRect().width);
      if (!width || (!force && width === this.width)) return;
      this.width = width;
      players.replaceChildren();
      Object.entries(PLAYER_CONFIG).forEach(([slug, config]) => this.renderPlayer(players, slug, config));
    }

    renderPlayer(container, slug, config) {
      const rows = this.rows.filter(row => row.playerSlug === slug);
      const section = document.createElement("section");
      section.className = "hawks-stars__player";
      section.dataset.player = slug;
      const context = rows.map(row => `<span><strong>${displaySeason(row.season)} · ${row.team}</strong>${row.games} G · ${row.mpg.toFixed(1)} MPG</span>`).join("");
      section.innerHTML = `<header class="hawks-stars__player-header"><h4>${config.name}</h4><p>${slug === "jalen-johnson" ? "Expanding offensive responsibility" : "Scoring breakthrough"}</p><div class="hawks-stars__samples" aria-label="${config.name} season samples">${context}</div></header><div class="hawks-stars__panel-grid"></div><p class="hawks-stars__inspection" aria-live="polite">Focus, hover or tap a point for season context.</p>`;
      container.appendChild(section);
      const grid = section.querySelector(".hawks-stars__panel-grid");
      config.panels.forEach((panel, index) => this.renderPanel(grid, section, rows, config, panel, index));
    }

    renderPanel(grid, section, rows, config, panelConfig, panelIndex) {
      const panel = document.createElement("section");
      panel.className = "hawks-stars__panel team-graphic__plot";
      panel.innerHTML = `<h5>${panelConfig.title}</h5>`;
      grid.appendChild(panel);
      const width = Math.max(270, Math.floor(panel.getBoundingClientRect().width));
      const height = 230;
      const margin = { top: 24, right: 18, bottom: 48, left: 44 };
      const x = d3.scalePoint().domain(SEASONS).range([margin.left, width - margin.right]).padding(0.38);
      const y = d3.scaleLinear().domain(panelConfig.domain).range([height - margin.bottom, margin.top]);
      const titleId = `${this.id}-${rows[0].playerSlug}-${panelIndex}-title`;
      const descId = `${this.id}-${rows[0].playerSlug}-${panelIndex}-desc`;
      const svg = d3.select(panel).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-labelledby", `${titleId} ${descId}`);
      svg.append("title").attr("id", titleId).text(`${config.name}: ${panelConfig.title}`);
      svg.append("desc").attr("id", descId).text(`Regular-season values for ${SEASONS.map(displaySeason).join(", ")}. All values are directly labeled.`);
      svg.append("g").attr("class", "hawks-stars__grid").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).tickValues(panelConfig.ticks).tickSize(-(width - margin.left - margin.right)).tickFormat("" )).call(group => group.select(".domain").remove());
      svg.append("g").attr("class", "hawks-stars__axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).tickValues(panelConfig.ticks).tickSize(3).tickSizeOuter(0).tickPadding(6).tickFormat(panelConfig.axis || (value => value)));
      svg.append("path").datum(rows).attr("class", "hawks-stars__line").attr("d", d3.line().x(row => x(row.season)).y(row => y(row[panelConfig.key])));
      const marks = svg.append("g").selectAll("g").data(rows).join("g").attr("class", row => `hawks-stars__mark${row.season === LATEST ? " is-latest" : ""}`).attr("transform", row => `translate(${x(row.season)},${y(row[panelConfig.key])})`).attr("tabindex", 0).attr("role", "img").attr("aria-label", row => `${displaySeason(row.season)}, ${row.team}: ${panelConfig.format(row[panelConfig.key])}; ${row.games} games, ${row.mpg.toFixed(1)} minutes per game.`).on("pointerenter focus pointerdown", (_, row) => this.inspect(section, row, panelConfig));
      marks.append("circle").attr("r", row => row.season === LATEST ? 6 : 5);
      marks.append("text").attr("class", "hawks-stars__value").attr("text-anchor", "middle").attr("y", -11).text(row => panelConfig.format(row[panelConfig.key]));
      marks.append("title").text(row => `${displaySeason(row.season)} · ${row.team} · ${row.games} G · ${row.mpg.toFixed(1)} MPG · ${panelConfig.format(row[panelConfig.key])}`);
      svg.append("g").attr("class", "hawks-stars__axis hawks-stars__axis--season").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickSize(4).tickSizeOuter(0).tickPadding(8).tickFormat(displaySeason));
    }

    inspect(section, row, panelConfig) {
      section.querySelector(".hawks-stars__inspection").textContent = `${displaySeason(row.season)} · ${row.team} · ${row.games} games · ${row.mpg.toFixed(1)} MPG · ${panelConfig.title}: ${panelConfig.format(row[panelConfig.key])}.`;
    }
  }

  function initialize() {
    const roots = document.querySelectorAll("[data-hawks-emerging-stars]");
    if (!d3) {
      roots.forEach(root => root.querySelector(".hawks-stars__status").textContent = "The chart library could not be loaded. The validated data table remains available below.");
      return;
    }
    roots.forEach(root => {
      if (root.dataset.hawksInitialized === "true") return;
      root.dataset.hawksInitialized = "true";
      const chart = new HawksEmergingStarsChart(root);
      root.hawksEmergingStarsChart = chart;
      const card = root.closest("details");
      const loadWhenVisible = () => { if (!card || card.open) requestAnimationFrame(() => chart.load()); };
      if (card) card.addEventListener("toggle", loadWhenVisible);
      loadWhenVisible();
    });
  }

  initialize();
})();
