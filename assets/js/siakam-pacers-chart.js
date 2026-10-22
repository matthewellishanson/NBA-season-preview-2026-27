(function initializeSiakamPacersChart() {
  "use strict";

  const EXPECTED_SEASONS = ["2023-24", "2024-25", "2025-26"];
  const CAREER_SEASONS = 10;
  const NS = "http://www.w3.org/2000/svg";

  function numeric(row, key) {
    const value = Number(row[key]);
    if (!Number.isFinite(value)) throw new Error(`${row.season || "Row"}: invalid ${key}.`);
    return value;
  }

  function parseRow(row) {
    return {
      playerId: row.player_id?.trim() || "",
      season: row.season?.trim() || "",
      team: row.team_label?.trim() || "",
      sourceTeam: row.source_team_code?.trim() || "",
      stintScope: row.stint_scope?.trim() || "",
      games: numeric(row, "games"),
      mpg: numeric(row, "minutes_per_game"),
      pointsPer100: numeric(row, "points_per_100"),
      trueShooting: numeric(row, "true_shooting_pct"),
      published: row.published_comparison?.trim() === "true",
    };
  }

  function validateRows(rows) {
    if (rows.length !== CAREER_SEASONS) {
      throw new Error(`Expected ${CAREER_SEASONS} completed career seasons; found ${rows.length}.`);
    }
    const seasons = new Set(rows.map((row) => row.season));
    if (seasons.size !== rows.length) throw new Error("Career data contains duplicate seasons.");
    rows.forEach((row) => {
      if (row.playerId !== "siakapa01") throw new Error(`${row.season}: unexpected player identifier.`);
      if (!Number.isInteger(row.games) || row.games < 1 || row.games > 82) {
        throw new Error(`${row.season}: games must be an integer from 1 to 82.`);
      }
      if (row.mpg <= 0 || row.mpg > 48) throw new Error(`${row.season}: MPG is outside the valid range.`);
      if (row.trueShooting < 0 || row.trueShooting > 1) {
        throw new Error(`${row.season}: true shooting must be stored as a decimal fraction.`);
      }
    });

    const published = rows.filter((row) => row.published);
    if (published.map((row) => row.season).join("|") !== EXPECTED_SEASONS.join("|")) {
      throw new Error("Published comparison must contain exactly 2023-24 through 2025-26 in order.");
    }
    const traded = published[0];
    if (traded.sourceTeam !== "2TM" || traded.team !== "TOR/IND" || traded.stintScope !== "combined-season") {
      throw new Error("2023-24 must use the combined 2TM record labeled TOR/IND.");
    }
    return published;
  }

  function svgElement(name, attributes = {}, text = "") {
    const node = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
    return (value) => rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
  }

  function theme(root) {
    const styles = getComputedStyle(root);
    return {
      ink: styles.getPropertyValue("--team-ink").trim() || "#785400",
      secondary: styles.getPropertyValue("--team-secondary").trim() || "#002D62",
      comparison: styles.getPropertyValue("--team-comparison").trim() || "#565B65",
      muted: styles.getPropertyValue("--team-muted").trim() || "#4C5260",
      text: styles.getPropertyValue("--team-text").trim() || "#20212B",
      border: styles.getPropertyValue("--team-border").trim() || "#FED683",
      highlight: styles.getPropertyValue("--team-surface-strong").trim() || "#FFEFCD",
    };
  }

  function renderPanel(root, panel, rows) {
    const colors = theme(root);
    const svg = root.querySelector(`[data-siakam-panel="${panel.id}"]`);
    const width = Math.max(236, Math.round(svg.getBoundingClientRect().width || 236));
    const height = 236;
    const margin = { top: 27, right: 18, bottom: 73, left: 36 };
    const plotBottom = height - margin.bottom;
    const plotWidth = width - margin.left - margin.right;
    const xStart = margin.left + 16;
    const xEnd = width - margin.right - 18;
    const xs = rows.map((_, index) => xStart + ((xEnd - xStart) * index) / (rows.length - 1));
    const y = scaleLinear(panel.domain[0], panel.domain[1], plotBottom, margin.top);
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", panel.aria(rows));

    const bandWidth = Math.min(70, plotWidth / 2.3);
    svg.append(svgElement("rect", {
      x: xs[2] - bandWidth / 2,
      y: 8,
      width: bandWidth,
      height: plotBottom + 14,
      rx: 5,
      fill: colors.highlight,
    }));

    panel.ticks.forEach((tick) => {
      const tickY = y(tick);
      svg.append(svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: tickY,
        y2: tickY,
        stroke: colors.border,
        "stroke-width": 1,
      }));
      svg.append(svgElement("text", {
        x: margin.left - 7,
        y: tickY + 3.5,
        fill: colors.muted,
        "font-size": 9,
        "text-anchor": "end",
      }, panel.tickFormat(tick)));
    });

    if (panel.kind === "bar") {
      const barWidth = Math.min(42, plotWidth / 4.2);
      rows.forEach((row, index) => {
        const value = panel.value(row);
        const top = y(value);
        svg.append(svgElement("rect", {
          x: xs[index] - barWidth / 2,
          y: top,
          width: barWidth,
          height: plotBottom - top,
          rx: 3,
          fill: index === 2 ? colors.secondary : colors.comparison,
        }));
        svg.append(svgElement("text", {
          x: xs[index],
          y: top - 7,
          fill: index === 2 ? colors.secondary : colors.text,
          "font-size": 12,
          "font-weight": index === 2 ? 850 : 750,
          "text-anchor": "middle",
        }, panel.valueFormat(value)));
      });
    } else {
      const path = rows.map((row, index) => `${index ? "L" : "M"}${xs[index]},${y(panel.value(row))}`).join(" ");
      svg.append(svgElement("path", {
        d: path,
        fill: "none",
        stroke: colors.ink,
        "stroke-width": 2.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }));
      rows.forEach((row, index) => {
        const value = panel.value(row);
        const pointY = y(value);
        svg.append(svgElement("circle", {
          cx: xs[index],
          cy: pointY,
          r: index === 2 ? 6 : 5,
          fill: index === 2 ? colors.secondary : "#FFFFFF",
          stroke: index === 2 ? colors.secondary : colors.ink,
          "stroke-width": 2.5,
        }));
        svg.append(svgElement("text", {
          x: xs[index],
          y: pointY - 10,
          fill: index === 2 ? colors.secondary : colors.text,
          "font-size": 12,
          "font-weight": index === 2 ? 850 : 750,
          "text-anchor": "middle",
        }, panel.valueFormat(value)));
      });
    }

    rows.forEach((row, index) => {
      const selected = index === 2;
      svg.append(svgElement("text", {
        x: xs[index],
        y: plotBottom + 20,
        fill: selected ? colors.secondary : colors.text,
        "font-size": 10,
        "font-weight": selected ? 850 : 750,
        "text-anchor": "middle",
      }, row.season.replace("20", "’")));
      svg.append(svgElement("text", {
        x: xs[index],
        y: plotBottom + 36,
        fill: colors.muted,
        "font-size": 9,
        "text-anchor": "middle",
      }, row.team));
      svg.append(svgElement("text", {
        x: xs[index],
        y: plotBottom + 51,
        fill: colors.muted,
        "font-size": 9,
        "text-anchor": "middle",
      }, `${row.mpg.toFixed(1)} MPG`));
    });
  }

  const PANELS = [
    {
      id: "points",
      kind: "line",
      domain: [28, 36],
      ticks: [28, 32, 36],
      tickFormat: (value) => String(value),
      value: (row) => row.pointsPer100,
      valueFormat: (value) => value.toFixed(1),
      aria: (rows) => `Points per 100 possessions: ${rows.map((row) => `${row.season}, ${row.pointsPer100.toFixed(1)}`).join("; ")}.`,
    },
    {
      id: "ts",
      kind: "line",
      domain: [0.54, 0.62],
      ticks: [0.54, 0.58, 0.62],
      tickFormat: (value) => `${Math.round(value * 100)}%`,
      value: (row) => row.trueShooting,
      valueFormat: (value) => `${(value * 100).toFixed(1)}%`,
      aria: (rows) => `True shooting percentage: ${rows.map((row) => `${row.season}, ${(row.trueShooting * 100).toFixed(1)} percent`).join("; ")}.`,
    },
    {
      id: "games",
      kind: "bar",
      domain: [0, 82],
      ticks: [0, 40, 80],
      tickFormat: (value) => String(value),
      value: (row) => row.games,
      valueFormat: (value) => String(value),
      aria: (rows) => `Games played: ${rows.map((row) => `${row.season}, ${row.games}`).join("; ")}. Bars begin at zero.`,
    },
  ];

  function renderChart(root, rows) {
    PANELS.forEach((panel) => renderPanel(root, panel, rows));
    root.removeAttribute("aria-busy");
    root.dataset.chartMounted = "true";
  }

  function showError(root, error) {
    root.removeAttribute("aria-busy");
    root.dataset.chartMounted = "error";
    root.querySelector(".siakam-chart__panels").innerHTML = '<p class="siakam-chart__status siakam-chart__status--error">The Siakam chart could not be displayed. The validated CSV and table remain available below.</p>';
    console.error("Siakam chart could not load:", error);
  }

  async function loadChart(root) {
    if (["loading", "true"].includes(root.dataset.chartMounted)) return;
    root.dataset.chartMounted = "loading";
    try {
      const response = await fetch(root.dataset.source, { cache: "no-store" });
      if (!response.ok) throw new Error(`Siakam data request returned ${response.status}.`);
      const rows = validateRows(window.d3.csvParse(await response.text()).map(parseRow));
      renderChart(root, rows);
      let frame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => renderChart(root, rows));
      });
      observer.observe(root.querySelector(".siakam-chart__panels"));
    } catch (error) {
      showError(root, error);
    }
  }

  document.querySelectorAll("[data-siakam-chart]").forEach((root) => {
    if (!window.d3) {
      showError(root, new Error("D3 is unavailable."));
      return;
    }
    const card = root.closest("details");
    const loadWhenVisible = () => {
      if (!card || card.open) requestAnimationFrame(() => loadChart(root));
    };
    card?.addEventListener("toggle", loadWhenVisible);
    loadWhenVisible();
  });

  window.validateSiakamPacersRows = validateRows;
})();
