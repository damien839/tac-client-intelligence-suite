"use client";

import { OrderMovement, TIER_LABELS } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";
import { signedCurrency } from "./format";

interface MovementTableProps {
  movement: OrderMovement[];
}

export default function MovementTable({ movement }: MovementTableProps) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">What moves &amp; why</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tac-border text-tac-muted">
            <th className="text-left py-2">Cart</th>
            <th className="text-left py-2 px-3">Chose</th>
            <th className="text-right py-2 px-3">Paid</th>
            <th className="text-left py-2 px-3">Lands</th>
            <th className="text-right py-2 px-3">New</th>
            <th className="text-right py-2 px-3">Δ net</th>
          </tr>
        </thead>
        <tbody>
          {movement.map((m, i) => (
            <tr
              key={i}
              className={`border-b border-tac-border/50 ${m.moved ? "bg-tac-accent/5" : ""}`}
            >
              <td className="py-2">{formatCurrency(m.gross)}</td>
              <td className="px-3">{TIER_LABELS[m.chosenTier]}</td>
              <td className="text-right px-3">
                {m.chosenFee === 0 ? (
                  <span className="text-tac-success font-semibold text-xs">FREE</span>
                ) : (
                  formatCurrency(m.chosenFee)
                )}
              </td>
              <td className="px-3">
                {m.moved ? (
                  <span className="text-tac-accent font-semibold">{TIER_LABELS[m.landedTier]}</span>
                ) : (
                  TIER_LABELS[m.landedTier]
                )}
              </td>
              <td className="text-right px-3">
                {m.landedFee === 0 ? (
                  <span className="text-tac-success font-semibold text-xs">FREE</span>
                ) : (
                  formatCurrency(m.landedFee)
                )}
              </td>
              <td
                className={`text-right px-3 ${
                  m.netDelta >= 0 ? "text-tac-success" : "text-tac-danger"
                }`}
              >
                {signedCurrency(m.netDelta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-tac-muted mt-3">
        Highlighted rows shifted tier. An order downgrades only when the proposed express premium
        exceeds what that customer already revealed they&apos;d pay for speed.
      </p>
    </div>
  );
}
