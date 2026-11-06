// Thin wrapper around Chart.js with the game's colors and conventions:
// one y-axis per chart, 2px lines, a legend whenever there are 2+ series,
// and an index tooltip on hover.
import { cssVar, tierColor, tierLabel } from "./ui.js";
import { TIERS } from "./config.js";

const live = new Map();

export const get = key => live.get(key);

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

// The classic bullwhip picture: end-customer demand vs total orders per
// tier. Brewery production is a different kind of decision, so it gets
// its own chart (breweryChart) rather than a line here.
export function bullwhipChart(key, canvas, res, bw, { perTeam = false } = {}) {
  const labels = weeksLabels(res.weeks);
  const scale = perTeam ? 1 / res.retailers : 1;
  const series = [{ label: "Customer demand", data: bw.demandTotal.map(v => v * scale), color: cssVar("--ink"), dash: [6, 4] }];
  for (const tier of ["retailer", "wholesaler", "distributor"]) {
    series.push({ label: `${tierLabel(tier)} orders`, data: bw.tierOrders[tier].map(v => v * scale), color: tierColor(tier) });
  }
  return lines(key, canvas, { labels, series, yTitle: perTeam || res.retailers === 1 ? "Cases per week" : "Cases per week (all teams)" });
}

export function breweryChart(key, canvas, res) {
  const B = Object.values(res.teams).find(t => t.tier === "brewery");
  return lines(key, canvas, {
    labels: weeksLabels(res.weeks),
    series: [
      { label: "Orders from distributors", data: B.incoming, color: tierColor("distributor"), width: 1.5 },
      { label: "Brewery production", data: B.orders, color: tierColor("brewery") },
      { label: "Normal capacity", data: res.capacity.map(c => c.normal), color: cssVar("--ink-3"), dash: [4, 4], width: 1.5, stepped: true },
      { label: "Maximum with surge", data: res.capacity.map(c => c.surge), color: cssVar("--ink-3"), dash: [1, 3], width: 1.5, stepped: true },
      { label: "Brewery backorders", data: B.backlog, color: cssVar("--ink"), width: 1.5, dash: [8, 3] },
    ],
  });
}
