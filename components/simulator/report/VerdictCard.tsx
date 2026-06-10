"use client";

import { SchemeEvaluation } from "@/lib/shipping-sim/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/calculations";
import { signedCurrency } from "../analysis/format";
import { ReportOption } from "./types";

interface VerdictCardProps {
  rankedOptions: ReportOption[]; // ranked by contributionDelta desc, Custom already excluded when = Current
  currentFacts: SchemeEvaluation;
  monthlyOrders: number | undefined;
}

function monthlyFigure(evaluation: SchemeEvaluation, monthlyOrders: number): string {
  const perOrder = evaluation.orderCount > 0 ? evaluation.contributionDelta / evaluation.orderCount : 0;
  return formatCurrency(perOrder * monthlyOrders, 0);
}

export default function VerdictCard({ rankedOptions, currentFacts, monthlyOrders }: VerdictCardProps) {
  const winner = rankedOptions[0];
  const runnerUp = rankedOptions[1];

  if (!winner) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-2 text-tac-accent">Verdict</h3>
        <p className="text-sm text-tac-muted">
          No option differs from the current scheme yet — map a service to Standard for
          recommendations, or adjust the Custom scheme to compare it here.
        </p>
      </div>
    );
  }

  const w = winner.evaluation;
  const freeShiftFrom = formatPercent(currentFacts.freeOrderShare, 0);
  const freeShiftTo = formatPercent(w.freeOrderShare, 0);

  return (
    <div className="card border-l-2 border-l-tac-accent">
      <h3 className="text-lg font-semibold mb-2 text-tac-accent">Verdict</h3>
      <p className="text-sm mb-2">
        <strong className="text-tac-accent">{winner.label}</strong> ({winner.schemeSummary}) leads
        with <strong>{signedCurrency(w.contributionDelta)}</strong> expected total contribution vs
        current across {w.orderCount} orders
        {monthlyOrders !== undefined && w.orderCount > 0 && (
          <>
            {" "}— ≈ <strong>{monthlyFigure(w, monthlyOrders)}/month</strong> at{" "}
            {formatNumber(monthlyOrders)} orders/month (illustrative)
          </>
        )}
        .
      </p>
      <p className="text-sm text-tac-muted mb-2">
        Its expected cost: {w.expectedOrdersLost.toFixed(1)} orders lost to abandonment, with the
        free-order share moving {freeShiftFrom} → {freeShiftTo}.
      </p>
      {runnerUp && (
        <p className="text-sm text-tac-muted">
          Runner-up <strong className="text-tac-text">{runnerUp.label}</strong> follows at{" "}
          {signedCurrency(runnerUp.evaluation.contributionDelta)} (
          {formatCurrency(w.contributionDelta - runnerUp.evaluation.contributionDelta)} behind),
          losing {runnerUp.evaluation.expectedOrdersLost.toFixed(1)} orders vs the winner&apos;s{" "}
          {w.expectedOrdersLost.toFixed(1)}.
        </p>
      )}
      {winner.unconstrained && (
        <p className="text-sm text-tac-warning mt-2">
          Reliability caveat: abandonment is 0%, so nothing in the model punishes charging more —
          this optimum may be unreliable. Set an abandonment rate before trusting it.
        </p>
      )}
    </div>
  );
}
