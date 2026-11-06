// Small DOM and formatting helpers shared by the student and instructor screens.
import { TIER_LABELS } from "./config.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const money = n => "$" + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = n => "$" + Math.round(Number(n) || 0).toLocaleString();
export const int = n => (Number(n) || 0).toLocaleString();
export const tierLabel = t => TIER_LABELS[t] || t;
export const tierColor = t => getComputedStyle(document.documentElement).getPropertyValue(`--s-${t}`).trim();
export const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function toast(text, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function toCSV(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = v => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => cell(r[c])).join(","))].join("\n");
}

export function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const MUG = `<svg class="mug" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h10v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="var(--s-brewery)"/><path d="M5 6a3 3 0 0 1 3-3c1 0 1.6.4 2 1 .5-.6 1.3-1 2.2-1A2.8 2.8 0 0 1 15 6z" fill="var(--surface-2)" stroke="var(--ink-3)" stroke-width="1"/><path d="M15 9h2.5A2.5 2.5 0 0 1 20 11.5v2A2.5 2.5 0 0 1 17.5 16H15" fill="none" stroke="var(--ink-2)" stroke-width="1.8"/></svg>`;

export function topbar(right = "") {
  return `<div class="topbar"><div class="inner"><div class="brand">${MUG}The Beer Game</div><div style="flex:1"></div>${right}</div></div>`;
}
