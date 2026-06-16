"use client";

import { useState } from "react";
import { CurveStats } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";
import DistributionChart from "./DistributionChart";
import PricePointBars from "./PricePointBars";
import PullZoneChart from "./PullZoneChart";
import ShippingLoadChart from "./ShippingLoadChart";

interface CurveAnatomyProps {
  stats: CurveStats;
  /** Display label of the dominant paid tier (e.g. "Express"). */
  tierLabel: string;
  /** Dominant tier's current free-ship line, for the distribution shading + pull zone. */
  currentThreshold: number | null;
}

interface Kpi {
  v: string;
  l: string;
  d?: string;
}

export default function CurveAnatomy({ stats, tierLabel, currentThreshold }: CurveAnatomyProps) {
  // Collapsible on screen, always expanded in the PDF (the hidden body still prints).
  const [open, setOpen] = useState(true);

  if (stats.count === 0) return null;

  const total = stats.freeN + stats.paidN;
  const payShare = total > 0 ? (stats.paidN / total) * 100 : 0;
  const kpis: Kpi[] = [
    { v: formatCurrency(stats.median, 0), l: "Median order", d: "the typical order" },
    { v: formatCurrency(stats.mean, 0), l: "Mean order", d: "the headline average" },
    { v: `${stats.skewPct.toFixed(0)}%`, l: "Right-skew", d: "mean above median" },
    { v: `${payShare.toFixed(0)}%`, l: "Pay shipping", d: `${(100 - payShare).toFixed(0)}% ship free` },
    { v: formatCurrency(stats.freeAov, 0), l: "Free-ship AOV", d: `vs ${formatCurrency(stats.paidAov, 0)} paid` },
    { v: `${stats.shipRevPctGmv.toFixed(1)}%`, l: "Shipping rev / GMV", d: "fees vs sales" },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold text-tac-accent">Curve anatomy</h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="no-print text-xs text-tac-muted hover:text-tac-accent"
          aria-expanded={open}
        >
          {open ? "Hide ▲" : "Show ▼"}
        </button>
      </div>
      <p className="text-sm text-tac-muted mb-4">
        The shape of your order book before the options — what the average hides, where orders
        cluster, whether the free-ship line already moves baskets, and how shipping cost lands across
        the curve.
      </p>

      {/* KPI strip — always visible (the at-a-glance summary). */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-tac-border rounded-lg overflow-hidden">
        {kpis.map((k) => (
          <div key={k.l} className="bg-tac-bg-card p-3">
            <div className="text-xl font-semibold text-tac-text">{k.v}</div>
            <div className="text-[10px] uppercase tracking-wide text-tac-muted mt-1">{k.l}</div>
            {k.d && <div className="text-[11px] text-tac-muted/70 mt-0.5">{k.d}</div>}
          </div>
        ))}
      </div>

      {/* Detail charts — collapsed on screen via `hidden`, but `print:block` forces them into the PDF. */}
      <div className={`mt-6 space-y-6 ${open ? "" : "hidden print:block"}`}>
        <DistributionChart stats={stats} currentThreshold={currentThreshold} />
        <PricePointBars stats={stats} />
        {stats.pullZone && <PullZoneChart pullZone={stats.pullZone} />}
        <ShippingLoadChart stats={stats} tierLabel={tierLabel} />
      </div>
    </div>
  );
}
