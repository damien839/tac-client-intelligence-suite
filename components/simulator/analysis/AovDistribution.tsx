"use client";

import { formatCurrency } from "@/lib/calculations";

export interface ThresholdMarker {
  value: number;
  label: string;
  color: string;
}

interface AovDistributionProps {
  grossValues: number[];
  markers: ThresholdMarker[];
}

/** Inline-SVG strip: each order plotted by cart value against the free-shipping lines. */
export default function AovDistribution({ grossValues, markers }: AovDistributionProps) {
  const W = 760;
  const H = 110;
  const padL = 12;
  const padR = 12;
  const padB = 28;
  const padT = 26;

  const maxGross = Math.max(300, ...grossValues);
  const x = (g: number) => padL + (g / maxGross) * (W - padL - padR);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">Where orders sit vs the thresholds</h3>
      <p className="text-sm text-tac-muted mb-4">
        Every order&apos;s value on one line. Free-shipping thresholds are marked: orders to the
        right of a marker ship free under that option, and the cluster just below a marker is who
        a basket-building push targets.
      </p>
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
            <text x={x(m.value)} y={padT - 6 - (i % 2) * 9} textAnchor="middle" fontSize="9" fill={m.color}>
              {m.label} ${m.value}
            </text>
          </g>
        ))}

        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#2D4050" />
        {[0, 100, 200, 300].filter((g) => g <= maxGross).map((g) => (
          <text key={g} x={x(g)} y={H - padB + 14} textAnchor="middle" fontSize="9" fill="currentColor">
            ${g}
          </text>
        ))}

        {grossValues.map((gross, i) => (
          <circle key={i} cx={x(gross)} cy={H - padB - 10} r={6} fill="#A0AEB8" opacity={0.55}>
            <title>{formatCurrency(gross)}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
