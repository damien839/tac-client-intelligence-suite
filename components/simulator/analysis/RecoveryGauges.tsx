"use client";

import { formatPercent } from "@/lib/calculations";

interface RecoveryGaugesProps {
  current: number; // fraction, e.g. 0.69
  proposed: number;
}

// Scale so 100% break-even sits at ~77% of the track (room to show overshoot up to 130%).
const SCALE_MAX = 1.3;

function Gauge({ label, rate, color }: { label: string; rate: number; color: string }) {
  const width = (Math.min(rate, SCALE_MAX) / SCALE_MAX) * 100;
  const breakeven = (1 / SCALE_MAX) * 100;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-tac-muted">{label}</span>
        <span className="font-semibold" style={{ color }}>
          {formatPercent(rate, 0)}
        </span>
      </div>
      <div className="relative h-3.5 rounded-full bg-tac-bg overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
        <div
          className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-tac-text/60"
          style={{ left: `${breakeven}%` }}
          title="100% break-even"
        />
      </div>
    </div>
  );
}

export default function RecoveryGauges({ current, proposed }: RecoveryGaugesProps) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">
        Cost recovery — every $1 of carrier cost
      </h3>
      <Gauge label="Current" rate={current} color="#A0AEB8" />
      <Gauge label="Proposed" rate={proposed} color="#F5B36B" />
      <p className="text-xs text-tac-muted mt-3">
        Marker line = 100% break-even (fees fully cover carrier cost).{" "}
        {proposed < 1
          ? `Proposed still recovers only ${formatPercent(proposed, 0)} — shipping remains a subsidised AOV lever.`
          : "Proposed clears break-even."}
      </p>
    </div>
  );
}
