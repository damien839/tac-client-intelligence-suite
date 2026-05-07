"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// TAC palette — teal / blue / tiger per official brand
export const TAC_PALETTE = {
  teal: "#81a0aa",
  blue: "#2c3e52",
  tiger: "#f2663b",
  cream: "#f7f4ef",
  tangerine: "#f89f5c",
  black: "#1c1f20",
};

export const CHART_GRID = "rgba(255,255,255,0.08)";
export const CHART_TICK = "#A0AEB8";

const formatAud = (value: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);

interface SpendBarsProps {
  data: { label: string; current_monthly_spend: number; projected_monthly_spend: number }[];
}

export function SpendBars({ data }: SpendBarsProps) {
  if (data.length === 0) {
    return <EmptyChart label="No spend data to plot" />;
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 24 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={CHART_TICK}
          tick={{ fill: CHART_TICK, fontSize: 12 }}
          interval={0}
          angle={-15}
          textAnchor="end"
          height={56}
        />
        <YAxis
          stroke={CHART_TICK}
          tick={{ fill: CHART_TICK, fontSize: 12 }}
          tickFormatter={(v) => formatAud(Number(v))}
          width={86}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: TAC_PALETTE.cream }}
          formatter={(v) => formatAud(Number(v))}
        />
        <Legend wrapperStyle={{ color: CHART_TICK, fontSize: 12 }} />
        <Bar dataKey="current_monthly_spend" name="Current" fill={TAC_PALETTE.teal} radius={[4, 4, 0, 0]} />
        <Bar dataKey="projected_monthly_spend" name="Projected" fill={TAC_PALETTE.tiger} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface RegionBarsProps {
  data: { region: string; current_monthly_spend: number; projected_monthly_spend: number }[];
}

export function RegionBars({ data }: RegionBarsProps) {
  if (data.length === 0) {
    return <EmptyChart label="No region data to plot" />;
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 16, right: 16, left: 16, bottom: 16 }}
      >
        <CartesianGrid stroke={CHART_GRID} horizontal={false} />
        <XAxis
          type="number"
          stroke={CHART_TICK}
          tick={{ fill: CHART_TICK, fontSize: 12 }}
          tickFormatter={(v) => formatAud(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="region"
          stroke={CHART_TICK}
          tick={{ fill: CHART_TICK, fontSize: 12 }}
          width={64}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: TAC_PALETTE.cream }}
          formatter={(v) => formatAud(Number(v))}
        />
        <Legend wrapperStyle={{ color: CHART_TICK, fontSize: 12 }} />
        <Bar dataKey="current_monthly_spend" name="Current" fill={TAC_PALETTE.teal} radius={[0, 4, 4, 0]} />
        <Bar dataKey="projected_monthly_spend" name="Projected" fill={TAC_PALETTE.tiger} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface SharePieProps {
  data: { region: string; share_pct: number }[];
}

const PIE_COLORS = [
  TAC_PALETTE.tiger,
  TAC_PALETTE.teal,
  TAC_PALETTE.tangerine,
  TAC_PALETTE.blue,
  "#A6BFC6",
  "#E68A5C",
  "#5C7886",
  "#D9C8B0",
];

export function SharePie({ data }: SharePieProps) {
  if (data.length === 0) {
    return <EmptyChart label="No share data" />;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="share_pct"
          nameKey="region"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
        >
          {data.map((_, idx) => (
            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: TAC_PALETTE.cream }}
          formatter={(v) => `${Number(v).toFixed(1)}%`}
        />
        <Legend wrapperStyle={{ color: CHART_TICK, fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "#1F3040",
  border: "1px solid #2D4050",
  borderRadius: 6,
  fontSize: 12,
  color: "#FFFFFF",
};

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[260px] flex items-center justify-center text-sm text-tac-muted border border-dashed border-tac-border rounded">
      {label}
    </div>
  );
}
