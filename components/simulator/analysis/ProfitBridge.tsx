"use client";

import { Benchmark } from "@/lib/shipping-sim/types";
import { signedCurrency } from "./format";
import { formatCurrency } from "@/lib/calculations";

interface ProfitBridgeProps {
  benchmark: Benchmark;
}

/** Inline-SVG waterfall: current net → +fee revenue → +carrier savings → proposed net. */
export default function ProfitBridge({ benchmark }: ProfitBridgeProps) {
  const curNet = benchmark.current.netShippingProfit;
  const propNet = benchmark.proposed.netShippingProfit;
  const revDelta = benchmark.shippingRevenueDelta;
  const carrierSaving = -benchmark.carrierSpendDelta; // positive when spend drops

  const W = 760;
  const H = 240;
  const padT = 18;
  const padB = 34;
  const padL = 56;

  const afterRev = curNet + revDelta;
  const afterCarrier = afterRev + carrierSaving;
  const allVals = [0, curNet, propNet, afterRev, afterCarrier];
  const lo = Math.min(...allVals) - 5;
  const hi = Math.max(...allVals) + 5;
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);

  const steps = [
    { label: "Current net", from: 0, to: curNet, amount: curNet, total: true },
    { label: "+ Fee revenue", from: curNet, to: afterRev, amount: revDelta, total: false },
    { label: "+ Carrier saving", from: afterRev, to: afterCarrier, amount: carrierSaving, total: false },
    { label: "Proposed net", from: 0, to: propNet, amount: propNet, total: true },
  ];

  const slot = (W - padL - 20) / steps.length;
  const bw = slot * 0.58;
  const zeroY = y(0);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">Profit bridge</h3>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Profit bridge waterfall">
        <line x1={padL} y1={zeroY} x2={W - 20} y2={zeroY} stroke="#2D4050" />
        <text x={padL - 8} y={zeroY + 4} textAnchor="end" fontSize="10" fill="#A0AEB8">
          $0
        </text>
        {steps.map((s, i) => {
          const x = padL + slot * i + (slot - bw) / 2;
          const top = y(Math.max(s.from, s.to));
          const bot = y(Math.min(s.from, s.to));
          const color = s.total ? (s.to >= 0 ? "#F5B36B" : "#F87171") : s.amount >= 0 ? "#4ADE80" : "#F87171";
          return (
            <g key={s.label}>
              <rect x={x} y={top} width={bw} height={Math.max(2, bot - top)} rx={3} fill={color} />
              <text x={x + bw / 2} y={top - 5} textAnchor="middle" fontSize="12" fill="#E8EEF2">
                {s.total ? formatCurrency(s.amount) : signedCurrency(s.amount)}
              </text>
              <text x={x + bw / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#A0AEB8">
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-xs text-tac-muted mt-2">
        How current net shipping profit ({formatCurrency(curNet)}) becomes proposed (
        {formatCurrency(propNet)}): extra fee revenue plus carrier savings from the tier shift.
      </p>
    </div>
  );
}
