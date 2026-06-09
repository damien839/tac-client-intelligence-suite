"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CANONICAL_TIERS, ScenarioResult, TIER_LABELS } from "@/lib/shipping-sim/types";

interface CarrierMixChartProps {
  current: ScenarioResult;
  proposed: ScenarioResult;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1F3040",
  border: "1px solid #2D4050",
  borderRadius: 8,
  color: "#fff",
};

export default function CarrierMixChart({ current, proposed }: CarrierMixChartProps) {
  const data = CANONICAL_TIERS.filter(
    (t) => current.ordersByTier[t] > 0 || proposed.ordersByTier[t] > 0
  ).map((t) => ({
    tier: TIER_LABELS[t],
    Current: current.ordersByTier[t],
    Proposed: proposed.ordersByTier[t],
  }));

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">Carrier mix shift</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
          <XAxis dataKey="tier" tick={{ fontSize: 12, fill: "#A0AEB8" }} />
          <YAxis tick={{ fontSize: 11, fill: "#A0AEB8" }} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(160,174,184,0.08)" }} />
          <Legend />
          <Bar dataKey="Current" fill="#A0AEB8" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Proposed" fill="#F5B36B" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
