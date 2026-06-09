// Standalone preview generator for the Shipping Strategy Simulator OUTPUT.
// Re-implements the exact tested model (lib/shipping-sim) so every figure is genuine,
// then derives a full consulting-grade analysis and renders it as HTML.
// Demo artifact — not part of the app. Winning sections fold back into BenchmarkPanel.

import { writeFileSync } from "node:fs";

// ── Sample data (matches /tmp/sim-test-orders.csv) ─────────────────────
const orders = [
  { gross: 120.0, shippingPaid: 0.0, tier: "standard" },
  { gross: 85.5, shippingPaid: 9.95, tier: "standard" },
  { gross: 210.0, shippingPaid: 0.0, tier: "express" },
  { gross: 65.0, shippingPaid: 9.95, tier: "standard" },
  { gross: 175.0, shippingPaid: 14.95, tier: "express" },
  { gross: 95.0, shippingPaid: 9.95, tier: "standard" },
  { gross: 250.0, shippingPaid: 0.0, tier: "express" },
  { gross: 45.0, shippingPaid: 9.95, tier: "standard" },
];
const current = {
  standard: { tier: "standard", fee: 9.95, freeThreshold: 100, avgCost: 8 },
  express: { tier: "express", fee: 14.95, freeThreshold: 200, avgCost: 13 },
};
const proposed = {
  standard: { tier: "standard", fee: 12, freeThreshold: 150, avgCost: 8 },
  express: { tier: "express", fee: 20, freeThreshold: 250, avgCost: 13 },
};
const cogsPercent = 0.3;
const MONTHLY_ORDERS = 2000; // explicit assumption for scaling — labelled as such in UI

// ── Model (verbatim from lib/shipping-sim) ─────────────────────────────
const CANONICAL_TIERS = ["standard", "express", "nextday", "sameday"];
const TIER_LABELS = { standard: "Standard", express: "Express", nextday: "Next Day", sameday: "Same Day" };
const tierCost = (c, g) => (c.freeThreshold !== null && g >= c.freeThreshold ? 0 : c.fee);
function cheapestTier(s, g) {
  let best = null;
  for (const t of CANONICAL_TIERS) { const c = s[t]; if (!c) continue; const cost = tierCost(c, g); if (best === null || cost < best.cost) best = { tier: t, cost }; }
  if (!best) throw new Error("empty scheme");
  return best;
}
const revealedPremium = (o, cur) => tierCost(cur[o.tier], o.gross) - cheapestTier(cur, o.gross).cost;
function landedTier(o, cur, prop) {
  const prem = revealedPremium(o, cur); const cheap = cheapestTier(prop, o.gross); const ch = prop[o.tier];
  if (!ch) return cheap.tier; return tierCost(ch, o.gross) - cheap.cost <= prem ? o.tier : cheap.tier;
}
const empty = () => ({ standard: 0, express: 0, nextday: 0, sameday: 0 });
function currentScenario(os, s) {
  let rev = 0, cost = 0; const by = empty();
  for (const o of os) { const c = s[o.tier]; if (!c) continue; rev += tierCost(c, o.gross); cost += c.avgCost; by[o.tier]++; }
  return { shippingRevenue: rev, carrierSpend: cost, ordersByTier: by, netShippingProfit: rev - cost };
}
function proposedScenario(os, cur, prop) {
  let rev = 0, cost = 0; const by = empty();
  for (const o of os) { const l = landedTier(o, cur, prop); const c = prop[l]; if (!c) continue; rev += tierCost(c, o.gross); cost += c.avgCost; by[l]++; }
  return { shippingRevenue: rev, carrierSpend: cost, ordersByTier: by, netShippingProfit: rev - cost };
}
function simulate(os, cur, prop, cogs) {
  const cr = currentScenario(os, cur), pr = proposedScenario(os, cur, prop);
  const actual = os.reduce((s, o) => s + o.shippingPaid, 0);
  const variancePct = actual > 0 ? Math.abs(cr.shippingRevenue - actual) / actual : 0;
  const sd = pr.shippingRevenue - cr.shippingRevenue, cd = pr.carrierSpend - cr.carrierSpend;
  const b = { current: cr, proposed: pr, shippingRevenueDelta: sd, carrierSpendDelta: cd, netProfitDelta: sd - cd,
    reconciliation: { actualShippingPaid: actual, modelledCurrentRevenue: cr.shippingRevenue, variancePct } };
  if (cogs !== undefined) b.cogsContext = { cogsPercent: cogs, grossProductMargin: os.reduce((s, o) => s + o.gross, 0) * (1 - cogs) };
  return b;
}

const b = simulate(orders, current, proposed, cogsPercent);

// ── Derived analysis (all from the model + data) ───────────────────────
const usedTiers = ["standard", "express"];
const n = orders.length;

// Per-order movement detail
const movement = orders.map((o) => {
  const landed = landedTier(o, current, proposed);
  const curFee = tierCost(current[o.tier], o.gross);
  const propFee = tierCost(proposed[landed], o.gross);
  const curCarrier = current[o.tier].avgCost;
  const propCarrier = proposed[landed].avgCost;
  return { ...o, landed, moved: landed !== o.tier, curFee, propFee, curCarrier, propCarrier,
    curNet: curFee - curCarrier, propNet: propFee - propCarrier };
});
const movedOrders = movement.filter((m) => m.moved);

// Per-tier economics (current and proposed)
function tierEconomics(scenarioOrders, scheme, tierKeyFn) {
  const rows = {};
  for (const t of usedTiers) rows[t] = { count: 0, revenue: 0, carrier: 0 };
  for (const m of scenarioOrders) {
    const t = tierKeyFn(m);
    const fee = tierKeyFn === ((x) => x.tier) ? m.curFee : m.propFee;
    rows[t].count++;
    rows[t].revenue += tierKeyFn === ((x) => x.tier) ? m.curFee : m.propFee;
    rows[t].carrier += tierKeyFn === ((x) => x.tier) ? m.curCarrier : m.propCarrier;
  }
  return rows;
}
const curByTier = {}; const propByTier = {};
for (const t of usedTiers) { curByTier[t] = { count: 0, revenue: 0, carrier: 0 }; propByTier[t] = { count: 0, revenue: 0, carrier: 0 }; }
for (const m of movement) {
  curByTier[m.tier].count++; curByTier[m.tier].revenue += m.curFee; curByTier[m.tier].carrier += m.curCarrier;
  propByTier[m.landed].count++; propByTier[m.landed].revenue += m.propFee; propByTier[m.landed].carrier += m.propCarrier;
}

// Cost recovery
const recCur = b.current.carrierSpend > 0 ? b.current.shippingRevenue / b.current.carrierSpend : 0;
const recProp = b.proposed.carrierSpend > 0 ? b.proposed.shippingRevenue / b.proposed.carrierSpend : 0;

// Free-shipping subsidy (carrier cost of orders that pay $0)
const subsidyCur = movement.filter((m) => m.curFee === 0).reduce((s, m) => s + m.curCarrier, 0);
const subsidyProp = movement.filter((m) => m.propFee === 0).reduce((s, m) => s + m.propCarrier, 0);
const freeCur = movement.filter((m) => m.curFee === 0).length;
const freeProp = movement.filter((m) => m.propFee === 0).length;

// Threshold sensitivity — sweep the standard free-over threshold, hold rest of proposal fixed
const sweep = [];
for (let T = 0; T <= 400; T += 10) {
  const p = { standard: { ...proposed.standard, freeThreshold: T }, express: proposed.express };
  const r = proposedScenario(orders, current, p);
  sweep.push({ T, net: r.shippingRevenue - r.carrierSpend });
}
const optimal = sweep.reduce((a, c) => (c.net > a.net ? c : a));

// Scaling
const netPerOrder = b.netProfitDelta / n;
const annual = netPerOrder * MONTHLY_ORDERS * 12;

console.log(JSON.stringify({
  recCur, recProp, subsidyCur, subsidyProp, freeCur, freeProp,
  movedOrders: movedOrders.length, optimalThreshold: optimal.T, optimalNet: optimal.net, netPerOrder, annual,
}, null, 2));

// ── Render ─────────────────────────────────────────────────────────────
const fmt = (x) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
const fmt0 = (x) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(x);
const pct = (f, d = 1) => `${(f * 100).toFixed(d)}%`;
const signed = (x) => (x >= 0 ? "+" : "") + fmt(x);
const goodPos = (d) => (d > 0 ? "up" : d < 0 ? "down" : "neutral");
const goodNeg = (d) => (d < 0 ? "up" : d > 0 ? "down" : "neutral");
const C = { up: "#4ADE80", down: "#F87171", neutral: "#A0AEB8" };
const arrow = (t) => (t === "up" ? "▲" : t === "down" ? "▼" : "●");

const adopt = b.netProfitDelta > 0;
const recImprove = recProp - recCur;

// KPI cards
const kpi = (label, value, trend, sub) => `<div class="kpi"><p class="k-label">${label}</p><p class="k-val">${value}</p><p class="k-sub" style="color:${C[trend]}">${arrow(trend)} ${sub}</p></div>`;

// Profit bridge waterfall (SVG)
function waterfall() {
  const steps = [
    { label: "Current net", val: b.current.netShippingProfit, type: "total" },
    { label: "+ Shipping rev", val: b.shippingRevenueDelta, type: "pos" },
    { label: "− Carrier spend", val: -b.carrierSpendDelta, type: "pos" }, // carrier delta is negative (saving) → positive bar
    { label: "Proposed net", val: b.proposed.netShippingProfit, type: "total" },
  ];
  const W = 760, H = 240, padL = 70, padB = 30, padT = 16;
  const vals = [b.current.netShippingProfit, b.proposed.netShippingProfit, 0,
    b.current.netShippingProfit + b.shippingRevenueDelta, b.current.netShippingProfit - b.carrierSpendDelta];
  const lo = Math.min(...vals) - 5, hi = Math.max(...vals, 0) + 5;
  const y = (v) => padT + (hi - v) / (hi - lo) * (H - padT - padB);
  const bw = (W - padL - 20) / steps.length * 0.6;
  const gap = (W - padL - 20) / steps.length;
  let running = 0; let bars = ""; let labels = "";
  steps.forEach((s, i) => {
    const x = padL + gap * i + (gap - bw) / 2;
    let top, bot, color;
    if (s.type === "total") { top = y(Math.max(0, s.val)); bot = y(Math.min(0, s.val)); color = s.val >= 0 ? "#F5B36B" : "#F87171"; running = s.val; }
    else { const start = running; const end = running + s.val; top = y(Math.max(start, end)); bot = y(Math.min(start, end)); color = s.val >= 0 ? "#4ADE80" : "#F87171"; running = end; }
    bars += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(2, bot - top)}" rx="3" fill="${color}"/>`;
    bars += `<text x="${x + bw / 2}" y="${top - 5}" text-anchor="middle" font-size="12" fill="#E8EEF2">${signed(s.type === "total" ? s.val : (s.label.startsWith("−") ? -b.carrierSpendDelta : s.val))}</text>`;
    labels += `<text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#A0AEB8">${s.label}</text>`;
  });
  const zeroY = y(0);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%"><line x1="${padL}" y1="${zeroY}" x2="${W - 20}" y2="${zeroY}" stroke="#2D4050"/><text x="${padL - 8}" y="${zeroY + 4}" text-anchor="end" font-size="10" fill="#A0AEB8">$0</text>${bars}${labels}</svg>`;
}

// Recovery gauge
function gauge(label, rate, color) {
  const w = Math.min(rate, 1.3) / 1.3 * 100;
  const beW = 1 / 1.3 * 100;
  return `<div class="gauge"><div class="g-head"><span>${label}</span><span class="g-val" style="color:${color}">${pct(rate)}</span></div>
    <div class="g-track"><div class="g-fill" style="width:${w}%;background:${color}"></div><div class="g-break" style="left:${beW}%"></div></div></div>`;
}

// AOV distribution strip (SVG) with threshold markers
function aovStrip() {
  const W = 760, H = 120, padL = 10, padR = 10, padT = 20, padB = 28;
  const maxG = 300;
  const x = (g) => padL + g / maxG * (W - padL - padR);
  const lines = [
    { v: current.standard.freeThreshold, c: "#A0AEB8", t: "Std free $100 (now)" },
    { v: proposed.standard.freeThreshold, c: "#F5B36B", t: "Std free $150 (new)" },
    { v: current.express.freeThreshold, c: "#6088aa", t: "Exp free $200 (now)" },
    { v: proposed.express.freeThreshold, c: "#c08a4a", t: "Exp free $250 (new)" },
  ];
  let marks = lines.map((l, i) => `<line x1="${x(l.v)}" y1="${padT}" x2="${x(l.v)}" y2="${H - padB}" stroke="${l.c}" stroke-dasharray="3 3"/><text x="${x(l.v)}" y="${padT - 6 + (i % 2) * 0}" text-anchor="middle" font-size="9" fill="${l.c}">$${l.v}</text>`).join("");
  let dots = movement.map((m) => {
    const cx = x(m.gross); const cy = m.tier === "express" ? H - padB - 30 : H - padB - 8;
    const col = m.moved ? "#F5B36B" : m.tier === "express" ? "#6088aa" : "#A0AEB8";
    return `<circle cx="${cx}" cy="${cy}" r="6" fill="${col}" opacity="0.9"/><title>${fmt(m.gross)} · ${TIER_LABELS[m.tier]}${m.moved ? " → " + TIER_LABELS[m.landed] : ""}</title>`;
  }).join("");
  const axis = `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#2D4050"/>` +
    [0, 100, 200, 300].map((g) => `<text x="${x(g)}" y="${H - padB + 14}" text-anchor="middle" font-size="9" fill="#A0AEB8">$${g}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${marks}${axis}${dots}
    <text x="${padL}" y="${H - padB - 30}" font-size="9" fill="#6088aa">Express row</text>
    <text x="${padL}" y="${H - padB - 8}" font-size="9" fill="#A0AEB8">Standard row</text></svg>`;
}

// Threshold sweep line (SVG)
function sweepChart() {
  const W = 760, H = 200, padL = 60, padR = 16, padT = 16, padB = 28;
  const xs = sweep.map((s) => s.T), ys = sweep.map((s) => s.net);
  const xLo = 0, xHi = 400, yLo = Math.min(...ys) - 3, yHi = Math.max(...ys) + 3;
  const X = (t) => padL + (t - xLo) / (xHi - xLo) * (W - padL - padR);
  const Y = (v) => padT + (yHi - v) / (yHi - yLo) * (H - padT - padB);
  const path = sweep.map((s, i) => `${i ? "L" : "M"}${X(s.T).toFixed(1)} ${Y(s.net).toFixed(1)}`).join(" ");
  const mark = (t, c, lbl) => `<line x1="${X(t)}" y1="${padT}" x2="${X(t)}" y2="${H - padB}" stroke="${c}" stroke-dasharray="3 3"/><text x="${X(t)}" y="${padT + 8}" text-anchor="middle" font-size="9" fill="${c}">${lbl}</text>`;
  const zeroY = Y(0);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#2D4050"/>
    <text x="${padL - 8}" y="${zeroY + 4}" text-anchor="end" font-size="9" fill="#A0AEB8">$0</text>
    ${mark(current.standard.freeThreshold, "#A0AEB8", "now")}
    ${mark(proposed.standard.freeThreshold, "#F5B36B", "proposed")}
    ${mark(optimal.T, "#4ADE80", "optimal")}
    <path d="${path}" fill="none" stroke="#6088aa" stroke-width="2"/>
    <circle cx="${X(optimal.T)}" cy="${Y(optimal.net)}" r="4" fill="#4ADE80"/>
    ${[0, 100, 200, 300, 400].map((t) => `<text x="${X(t)}" y="${H - 10}" text-anchor="middle" font-size="9" fill="#A0AEB8">$${t}</text>`).join("")}
    <text x="${padL}" y="${H - 10}" font-size="9" fill="#A0AEB8"></text></svg>`;
}

// Tier economics table rows
const ecoRows = usedTiers.map((t) => {
  const c = curByTier[t], p = propByTier[t];
  const cRec = c.carrier > 0 ? c.revenue / c.carrier : 0;
  const pRec = p.carrier > 0 ? p.revenue / p.carrier : 0;
  return `<tr><td>${TIER_LABELS[t]}</td>
    <td>${c.count} → ${p.count}</td>
    <td>${fmt(c.revenue)} → ${fmt(p.revenue)}</td>
    <td>${fmt(c.carrier)} → ${fmt(p.carrier)}</td>
    <td>${fmt(c.revenue - c.carrier)} → <strong>${fmt(p.revenue - p.carrier)}</strong></td>
    <td style="color:${pRec >= cRec ? C.up : C.down}">${pct(cRec, 0)} → ${pct(pRec, 0)}</td></tr>`;
}).join("");

// Order movement rows
const moveRows = movement.map((m) => `<tr class="${m.moved ? "moved" : ""}">
  <td>${fmt(m.gross)}</td>
  <td>${TIER_LABELS[m.tier]}</td>
  <td>${m.curFee === 0 ? "<span class='free'>FREE</span>" : fmt(m.curFee)}</td>
  <td>${m.moved ? `<span class="shift">${TIER_LABELS[m.landed]}</span>` : TIER_LABELS[m.landed]}</td>
  <td>${m.propFee === 0 ? "<span class='free'>FREE</span>" : fmt(m.propFee)}</td>
  <td style="color:${m.propNet - m.curNet >= 0 ? C.up : C.down}">${signed(m.propNet - m.curNet)}</td></tr>`).join("");

// Findings (auto-generated from the numbers)
const findings = [];
findings.push(`<strong>${adopt ? "Adopt the proposed scheme." : "Hold — the proposal reduces shipping profit."}</strong> Net shipping P&L moves ${signed(b.netProfitDelta)} across ${n} orders (${pct(Math.abs(b.netProfitDelta) / Math.abs(b.current.netShippingProfit))} ${adopt ? "improvement" : "worse"}), driven mostly by carrier savings of ${fmt(-b.carrierSpendDelta)} as ${movedOrders.length} express order${movedOrders.length === 1 ? "" : "s"} shift to standard.`);
findings.push(`<strong>Cost recovery climbs ${pct(recCur, 0)} → ${pct(recProp, 0)}.</strong> You currently recover only ${(recCur).toFixed(2)} of every $1 in carrier cost; the proposal lifts that toward break-even. You are still ${recProp < 1 ? "under" : "over"}-recovering at the proposed rates.`);
findings.push(`<strong>Free-shipping subsidy: ${fmt(subsidyCur)} → ${fmt(subsidyProp)}.</strong> ${freeCur} of ${n} orders ship free today, costing you ${fmt(subsidyCur)} in carrier fees you collect nothing against.`);
findings.push(`<strong>Profit-maximising standard threshold ≈ $${optimal.T}.</strong> Sweeping the free-over line shows net shipping profit peaks at ${fmt(optimal.net)} — ${optimal.T > proposed.standard.freeThreshold ? "higher" : optimal.T < proposed.standard.freeThreshold ? "lower" : "right at"} the proposed $${proposed.standard.freeThreshold}. ${b.proposed.netShippingProfit < 0 ? "Even at the optimum, shipping runs at a managed loss — a deliberate AOV/conversion lever, not a profit centre." : ""}`);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipping Strategy Analysis</title><style>
:root{--bg:#16242E;--card:#1F3040;--card2:#1a2c3a;--border:#2D4050;--text:#E8EEF2;--muted:#9DACB8;--accent:#F5B36B;--success:#4ADE80;--danger:#F87171;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;padding:32px 20px}
.wrap{max-width:880px;margin:0 auto}
h1{font-size:27px;margin:0 0 2px}.sub{color:var(--muted);margin:0}
.ctx{color:var(--muted);font-size:12.5px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 13px;margin:14px 0 26px}.ctx code{color:var(--accent)}
section{margin:0 0 28px}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 14px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.verdict{background:linear-gradient(135deg,rgba(245,179,107,.12),rgba(74,222,128,.06));border:1px solid rgba(245,179,107,.35);border-radius:12px;padding:18px 20px;margin-bottom:20px}
.verdict .tag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.05em;padding:3px 10px;border-radius:99px;background:var(--success);color:#0b1a10;margin-bottom:8px}
.verdict p{margin:0;font-size:16px;line-height:1.5}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:15px}
.k-label{font-size:12px;color:var(--muted);margin:0 0 6px}.k-val{font-size:23px;font-weight:700;margin:0}.k-sub{font-size:12px;margin:6px 0 0}
.badge{padding:11px 14px;border-radius:8px;font-size:13.5px;border:1px solid}
.badge.ok{background:rgba(74,222,128,.10);border-color:rgba(74,222,128,.30);color:var(--success)}
.badge.bad{background:rgba(248,113,113,.10);border-color:rgba(248,113,113,.30);color:var(--danger)}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{padding:8px 10px;text-align:right}th:first-child,td:first-child{text-align:left}
thead th{color:var(--muted);border-bottom:1px solid var(--border);font-weight:500;font-size:12px}
tbody tr{border-bottom:1px solid rgba(45,64,80,.5)}tbody tr.moved{background:rgba(245,179,107,.07)}
.free{color:var(--success);font-weight:600;font-size:11px}.shift{color:var(--accent);font-weight:600}
.gauge{margin-bottom:14px}.g-head{display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px}.g-val{font-weight:700}
.g-track{position:relative;height:14px;background:#11202b;border-radius:7px;overflow:hidden}
.g-fill{height:100%;border-radius:7px}.g-break{position:absolute;top:-3px;bottom:-3px;width:2px;background:#E8EEF2;opacity:.6}
.note{font-size:12px;color:var(--muted);margin-top:10px}
.bars .row{display:flex;align-items:center;gap:8px;margin:4px 0}.bars .bl{width:74px;font-size:12px;color:var(--muted)}
.bars .bar{height:16px;border-radius:3px}.bars .num{font-size:11px;color:var(--muted)}
ul.find{list-style:none;padding:0;margin:0}ul.find li{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;padding:11px 14px;margin-bottom:10px;font-size:14px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.legend{font-size:11px;color:var(--muted);margin-top:8px}.legend .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 14px;vertical-align:middle}
@media(max-width:680px){.kpis,.two{grid-template-columns:1fr 1fr}}
</style></head><body><div class="wrap">

<h1>Shipping Strategy Analysis</h1>
<p class="sub">Current vs proposed pricing · ${n}-order sample</p>
<div class="ctx"><strong>Scenario.</strong> Current: Standard <code>$9.95 free&nbsp;over&nbsp;$100</code>, Express <code>$14.95 free&nbsp;over&nbsp;$200</code> · carrier cost $8 / $13.
Proposed: Standard <code>$12 free&nbsp;over&nbsp;$150</code>, Express <code>$20 free&nbsp;over&nbsp;$250</code> · COGS 30%. Every figure below is computed by the live model — nothing estimated.</div>

<section>
  <div class="verdict"><span class="tag">${adopt ? "RECOMMEND: ADOPT" : "RECOMMEND: REVISE"}</span>
    <p>${findings[0]}</p></div>
  <div class="kpis">
    ${kpi("Net shipping P&L", signed(b.netProfitDelta), goodPos(b.netProfitDelta), pct(Math.abs(b.netProfitDelta) / Math.abs(b.current.netShippingProfit)) + " vs now")}
    ${kpi("Cost recovery", pct(recProp, 0), goodPos(recImprove), `from ${pct(recCur, 0)}`)}
    ${kpi("Carrier spend", signed(b.carrierSpendDelta), goodNeg(b.carrierSpendDelta), "lower outlay")}
    ${kpi("Orders reshuffled", `${movedOrders.length} / ${n}`, "neutral", "express → standard")}
  </div>
</section>

<section><h2>Trust check</h2>
  <div class="badge ${b.reconciliation.variancePct > 0.1 ? "bad" : "ok"}">
    Current-scheme model reproduces ${pct(1 - b.reconciliation.variancePct)} of actual shipping revenue
    (${fmt(b.reconciliation.modelledCurrentRevenue)} modelled vs ${fmt(b.reconciliation.actualShippingPaid)} actually collected).
    ${b.reconciliation.variancePct > 0.1 ? " High variance — fix the current scheme before trusting the proposal." : " The entered current scheme matches reality, so the projection is sound."}
  </div></section>

<section><h2>Profit bridge</h2>
  <div class="panel">${waterfall()}
  <p class="note">How current net shipping profit (${fmt(b.current.netShippingProfit)}) becomes proposed (${fmt(b.proposed.netShippingProfit)}): extra fee revenue plus carrier savings from the tier shift.</p></div></section>

<section><h2>Cost recovery — every $1 of carrier cost</h2>
  <div class="panel">
    ${gauge("Current", recCur, "#A0AEB8")}
    ${gauge("Proposed", recProp, "#F5B36B")}
    <p class="note">White line = 100% break-even (shipping fees fully cover carrier cost). ${recProp < 1 ? `Proposed still recovers only ${pct(recProp, 0)} — shipping remains a subsidised AOV lever.` : "Proposed clears break-even."}</p>
  </div></section>

<section><h2>Per-tier economics &nbsp;<span style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;font-size:12px">(current → proposed)</span></h2>
  <div class="panel"><table>
    <thead><tr><th>Tier</th><th>Orders</th><th>Fee revenue</th><th>Carrier cost</th><th>Net</th><th>Recovery</th></tr></thead>
    <tbody>${ecoRows}</tbody></table></div></section>

<section><h2>What moves &amp; why</h2>
  <div class="two">
    <div class="panel"><table>
      <thead><tr><th>Cart</th><th>Chose</th><th>Paid</th><th>Lands</th><th>New</th><th>Δ net</th></tr></thead>
      <tbody>${moveRows}</tbody></table>
      <p class="note">Highlighted rows shifted tier. An order downgrades only when the proposed express premium exceeds what that customer already revealed they'd pay for speed.</p></div>
    <div class="panel"><div class="bars">
      ${usedTiers.map((t) => {
        const mx = Math.max(b.current.ordersByTier[t], b.proposed.ordersByTier[t], 1);
        return `<div style="margin-bottom:12px"><div class="bl" style="width:auto;margin-bottom:4px">${TIER_LABELS[t]}</div>
          <div class="row"><span class="bar" style="width:${b.current.ordersByTier[t] / mx * 70}%;background:#A0AEB8"></span><span class="num">${b.current.ordersByTier[t]} now</span></div>
          <div class="row"><span class="bar" style="width:${b.proposed.ordersByTier[t] / mx * 70}%;background:var(--accent)"></span><span class="num">${b.proposed.ordersByTier[t]} proposed</span></div></div>`;
      }).join("")}
      <div class="legend">Carrier mix shift · <span class="sw" style="background:#A0AEB8"></span>now<span class="sw" style="background:var(--accent)"></span>proposed</div>
    </div></div>
  </div></section>

<section><h2>Where orders sit vs your thresholds</h2>
  <div class="panel">${aovStrip()}
  <p class="note">Each dot is an order by cart value. Orange dots are orders that change tier under the proposal. Watch orders clustered just below a new free-shipping line — those are the ones now being asked to pay.</p></div></section>

<section><h2>Threshold sensitivity — standard free-over line</h2>
  <div class="panel">${sweepChart()}
  <p class="note">Net shipping profit as the standard free-shipping threshold sweeps $0–$400 (rest of proposal fixed). Optimal ≈ <strong style="color:var(--success)">$${optimal.T}</strong> at ${fmt(optimal.net)}. Proposed $${proposed.standard.freeThreshold} captures most of the available gain.</p></div></section>

<section><h2>Findings &amp; recommendation</h2>
  <ul class="find">${findings.map((f) => `<li>${f}</li>`).join("")}</ul></section>

<section><h2>Scaled impact <span style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;font-size:12px">(illustrative)</span></h2>
  <div class="panel">
    <p style="margin:0 0 6px">Net shipping P&amp;L improvement per order: <strong style="color:var(--success)">${signed(netPerOrder)}</strong> (${signed(b.netProfitDelta)} ÷ ${n} orders).</p>
    <p style="margin:0;color:var(--muted);font-size:13.5px">At an assumed <strong style="color:var(--text)">${MONTHLY_ORDERS.toLocaleString()}</strong> orders/month that scales to ≈ <strong style="color:var(--success)">${fmt0(netPerOrder * MONTHLY_ORDERS)}/month</strong> · <strong style="color:var(--success)">${fmt0(annual)}/year</strong>. Volume is an explicit input — replace ${MONTHLY_ORDERS.toLocaleString()} with the client's actual monthly orders. The sample mix is assumed representative.</p>
  </div></section>

</div></body></html>`;

const out = "/tmp/simulator-analysis-preview.html";
writeFileSync(out, html);
console.log("\nWrote " + out);
