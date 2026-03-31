"use client";

interface MetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  accent?: boolean;
}

export default function MetricCard({
  label,
  value,
  subtitle,
  trend,
  trendValue,
  accent = false,
}: MetricCardProps) {
  return (
    <div className={`card ${accent ? "border-tac-accent/30" : ""}`}>
      <p className="text-sm text-tac-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-tac-accent" : "text-tac-text"}`}>
        {value}
      </p>
      {subtitle && <p className="text-xs text-tac-muted mt-1">{subtitle}</p>}
      {trend && trendValue && (
        <p
          className={`text-sm mt-1 ${
            trend === "up"
              ? "text-tac-success"
              : trend === "down"
              ? "text-tac-danger"
              : "text-tac-muted"
          }`}
        >
          {trend === "up" ? "▲" : trend === "down" ? "▼" : "●"} {trendValue}
        </p>
      )}
    </div>
  );
}
