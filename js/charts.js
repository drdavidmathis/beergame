// Thin wrapper around Chart.js with the game's colors and conventions:
// one y-axis per chart, 2px lines, a legend whenever there are 2+ series,
// and an index tooltip on hover.
import { cssVar, tierColor, tierLabel } from "./ui.js";
import { TIERS } from "./config.js";

const live = new Map();

export function destroyAll(prefix = "") {
  for (const [k, c] of live) if (k.startsWith(prefix)) { c.destroy(); live.delete(k); }
}

function base(yTitle, legend) {
  const ink2 = cssVar("--ink-2"), grid = cssVar("--grid");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: legend, position: "bottom", labels: { color: ink2, boxWidth: 14, boxHeight: 3, font: { family: "Source Sans 3", size: 12 } } },
      tooltip: { titleFont: { family: "Source Sans 3" }, bodyFont: { family: "Source Sans 3" } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink2, maxTicksLimit: 12, font: { size: 11 } }, title: { display: true, text: "Week", color: ink2, font: { size: 11 } } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: ink2, font: { size: 11 } }, title: { display: !!yTitle, text: yTitle, color: ink2, font: { size: 11 } } },
    },
  };
}

function put(key, canvas, cfg) {
  if (!window.Chart || !canvas) return null;
  live.get(key)?.destroy();
  const c = new window.Chart(canvas, cfg);
  live.set(key, c);
  return c;
}

// series: [{label, data, color, dash, width, fill}]
export function lines(key, canvas, { labels, series, yTitle = "Cases", beginAtZero = true, stepped = false }) {
  const opts = base(yTitle, series.length > 1);
  opts.scales.y.beginAtZero = beginAtZero;
  return put(key, canvas, {
    type: "line",
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
        borderWidth: s.width ?? 2, borderDash: s.dash || [], pointRadius: 0, pointHoverRadius: 4,
        tension: 0, stepped: s.stepped ?? stepped, spanGaps: true,
      })),
    },
    options: opts,
  });
}

export function stackedBars(key, canvas, { labels, series, yTitle = "Dollars" }) {
  const opts = base(yTitle, series.length > 1);
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;
  opts.scales.x.title.display = false;
  opts.scales.x.ticks.maxTicksLimit = 40;
  opts.scales.x.ticks.autoSkip = false;
  opts.interaction = { mode: "index", intersect: true };
  return put(key, canvas, {
    type: "bar",
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.label, data: s.data, backgroundColor: s.color, borderColor: cssVar("--surface"),
        borderWidth: { top: 2 }, borderRadius: 3, maxBarThickness: 34,
      })),
    },
    options: opts,
  });
}

export const weeksLabels = n => Array.from({ length: n }, (_, i) => i + 1);

// The classic bullwhip picture: end-customer demand vs total orders per tier.
export function bullwhipChart(key, canvas, res, bw, { perTeam = false } = {}) {
  const labels = weeksLabels(res.weeks);
  const scale = perTeam ? 1 / res.retailers : 1;
  const series = [{ label: "Customer demand", data: bw.demandTotal.map(v => v * scale), color: cssVar("--ink"), dash: [6, 4] }];
  for (const tier of TIERS) {
    series.push({
      label: tier === "brewery" ? "Brewery production" : `${tierLabel(tier)} orders`,
      data: bw.tierOrders[tier].map(v => v * scale), color: tierColor(tier),
    });
  }
  return lines(key, canvas, { labels, series, yTitle: perTeam || res.retailers === 1 ? "Cases per week" : "Cases per week (all teams)" });
}
