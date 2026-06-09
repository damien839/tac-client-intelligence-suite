"use client";

import { OrderMovement, TIER_LABELS } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";

export interface ThresholdMarker {
  value: number;
  label: string;
  color: string;
}

interface AovDistributionProps {
  movement: OrderMovement[];
  markers: ThresholdMarker[];
}

/** Inline-SVG strip: each order plotted by cart value against the free-shipping lines. */
export default function AovDistribution({ movement, markers }: AovDistributionProps) {
  const W = 760;
  const H = 130;
  const padL = 12;
  const padR = 12;
  const padB = 28;
  const padT = 22;

  const maxGross = Math.max(300, ...movement.map((m) => m.gross));
  const x = (g: number) => padL + (g / maxGross) * (W - padL - padR);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">Where orders sit vs your thresholds</h3>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Order cart values vs thresholds" className="text-tac-text">
        {markers.map((m, i) => (
          <g key={i}>
            <line
              x1={x(m.value)}
              y1={padT}
              x2={x(m.value)}
              y2={H - padB}
              stroke={m.color}
              strokeDasharray="3 3"
            />
            <text x={x(m.value)} y={padT - 6} textAnchor="middle" fontSize="9" fill={m.color}>
              ${m.value}
            </text>
          </g>
        ))}

        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#2D4050" />
        {[0, 100, 200, 300].filter((g) => g <= maxGross).map((g) => (
          <text key={g} x={x(g)} y={H - padB + 14} textAnchor="middle" fontSize="9" fill="currentColor">
            ${g}
          </text>
        ))}

        <text x={padL} y={H - padB - 30} fontSize="9" fill="currentColor">
          Express
        </text>
        <text x={padL} y={H - padB - 8} fontSize="9" fill="currentColor">
          Standard
        </text>

        {movement.map((m, i) => {
          const cx = x(m.gross);
          const cy = m.chosenTier === "express" ? H - padB - 26 : H - padB - 6;
          const fill = m.moved ? "#F5B36B" : m.chosenTier === "express" ? "#6088aa" : "#A0AEB8";
          return (
            <circle key={i} cx={cx} cy={cy} r={6} fill={fill} opacity={0.9}>
              <title>
                {formatCurrency(m.gross)} · {TIER_LABELS[m.chosenTier]}
                {m.moved ? ` → ${TIER_LABELS[m.landedTier]}` : ""}
              </title>
            </circle>
          );
        })}
      </svg>
      <p className="text-xs text-tac-muted mt-2">
        Each dot is an order by cart value. Orange dots change tier under the proposal. Watch orders
        clustered just below a new free-shipping line — those are now being asked to pay.
      </p>
    </div>
  );
}
