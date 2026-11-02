(function initializeFlaggHistoricalScoring() {
  "use strict";

  const d3 = window.d3;
  const EXPECTED = {
    bryanko01: [1, 1759, 150],
    anthoca01: [2, 1725, 82],
    jamesle01: [3, 1654, 79],
    duranke01: [4, 1624, 80],
    doncilu01: [5, 1526, 72],
    flaggco01: [6, 1473, 70],
  };

  function number(row, field) {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function text(row, field) {
    const value = row[field]?.trim() || "";
    if (!value) throw new Error(`Invalid or missing ${field}.`);
    return value;
  }

  function parseRow(row) {
    return {
      rank: number(row, "rank"),
      playerId: text(row, "player_id"),
      playerName: text(row, "player_name"),
      totalPoints: number(row, "total_points"),
      games: number(row, "games"),
      seasonSpan: text(row, "season_span"),
      age: text(row, "age_designation"),
      team: text(row, "team"),
      pointsPer100: number(row, "points_per_100"),
    };
  }

  function validateRows(rows) {
    if (rows.length !== 10) throw new Error(`Expected 10 chart rows, found ${rows.length}.`);
    if (new Set(rows.map((row) => row.playerId)).size !== rows.length) {
      throw new Error("Expected one aggregated record per player ID.");
    }
    rows.forEach((row, index) => {
      if (row.rank !== index + 1) throw new Error("Rows are not in source rank order.");
      if (index && rows[index - 1].totalPoints < row.totalPoints) {
        throw new Error("Rows are not ordered by descending total points.");
      }
    });
    Object.entries(EXPECTED).forEach(([playerId, expected]) => {
      const row = rows.find((candidate) => candidate.playerId === playerId);
      const actual = row && [row.rank, row.totalPoints, row.games];
      if (!actual || actual.some((value, index) => value !== expected[index])) {
        throw new Error(`${playerId}: validation anchor mismatch.`);
      }
    });
  }

  function render(root, rows) {
    const plot = root.querySelector(".flagg-history__plot");
    const width = Math.max(300, Math.floor(plot.getBoundingClientRect().width));
    const compact = width < 560;
    const margin = { top: 36, right: compact ? 74 : 112, bottom: 31, left: compact ? 132 : 148 };
    const rowHeight = compact ? 35 : 37;
    const height = margin.top + margin.bottom + rows.length * rowHeight;
    const innerWidth = Math.max(100, width - margin.left - margin.right);
    const x = d3.scaleLinear().domain([0, 1800]).range([0, innerWidth]);
    const formatPoints = d3.format(",d");

    plot.replaceChildren();
    const svg = d3.select(plot).append("svg")
      .attr("class", "flagg-history__svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("aria-hidden", "true")
      .attr("focusable", "false");

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const ticks = compact ? [0, 900, 1800] : [0, 500, 1000, 1500];
    chart.selectAll("line.flagg-history__grid")
      .data(ticks)
      .join("line")
      .attr("class", "flagg-history__grid")
      .attr("x1", (value) => x(value))
      .attr("x2", (value) => x(value))
      .attr("y1", -7)
      .attr("y2", rows.length * rowHeight - 7);

    chart.selectAll("text.flagg-history__tick")
      .data(ticks)
      .join("text")
      .attr("class", "flagg-history__tick")
      .attr("x", (value) => x(value))
      .attr("y", rows.length * rowHeight + 13)
      .attr("text-anchor", (value) => value === 0 ? "start" : "middle")
      .text((value) => formatPoints(value));

    svg.append("text")
      .attr("class", "flagg-history__column-label")
      .attr("x", margin.left)
      .attr("y", 17)
      .text("TOTAL POINTS");
    svg.append("text")
      .attr("class", "flagg-history__column-label")
      .attr("x", width - 12)
      .attr("y", 17)
      .attr("text-anchor", "end")
      .text("GAMES");

    const groups = chart.selectAll("g.flagg-history__row")
      .data(rows, (row) => row.playerId)
      .join("g")
      .attr("class", (row) => `flagg-history__row${row.playerId === "flaggco01" ? " is-flagg" : ""}`)
      .attr("transform", (row, index) => `translate(0,${index * rowHeight})`);

    groups.append("text")
      .attr("class", "flagg-history__name")
      .attr("x", -margin.left + 12)
      .attr("y", 5)
      .attr("text-anchor", "start")
      .text((row) => `${row.rank}. ${row.playerName}`);
    groups.append("text")
      .attr("class", "flagg-history__context")
      .attr("x", -margin.left + 12)
      .attr("y", 19)
      .attr("text-anchor", "start")
      .text((row) => compact ? row.seasonSpan : `${row.seasonSpan} · age ${row.age}`);
    groups.append("rect")
      .attr("class", "flagg-history__bar")
      .attr("x", 0)
      .attr("y", -5)
      .attr("width", (row) => x(row.totalPoints))
      .attr("height", 15)
      .attr("rx", 2);
    groups.append("text")
      .attr("class", "flagg-history__points")
      .attr("x", (row) => x(row.totalPoints) + 6)
      .attr("y", 6)
      .text((row) => formatPoints(row.totalPoints));
    groups.append("text")
      .attr("class", "flagg-history__games")
      .attr("x", innerWidth + margin.right - 12)
      .attr("y", 6)
      .attr("text-anchor", "end")
      .text((row) => row.games);

    root.setAttribute("aria-busy", "false");
    root.flaggHistoricalScoring = { rows, domain: [0, 1800] };
  }

  if (!d3) return;
  document.querySelectorAll("[data-flagg-history-chart]").forEach((root) => {
    root.setAttribute("aria-busy", "true");
    d3.csv(root.dataset.source, parseRow)
      .then((rows) => {
        validateRows(rows);
        let frame = 0;
        const draw = () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => render(root, rows));
        };
        draw();
        if ("ResizeObserver" in window) new ResizeObserver(draw).observe(root.querySelector(".flagg-history__plot"));
      })
      .catch((error) => {
        console.error("Flagg historical scoring data error:", error);
        root.setAttribute("aria-busy", "false");
        const status = root.querySelector(".flagg-history__status");
        if (status) {
          status.className = "flagg-history__status flagg-history__status--error";
          status.textContent = "The scoring comparison could not be displayed. The validated table remains available below.";
        }
      });
  });
})();

