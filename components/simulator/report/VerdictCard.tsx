"use client";

import { SchemeEvaluation } from "@/lib/shipping-sim/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/calculations";
import { describeChangedTiers, freightShiftSentence, signedCurrency } from "../analysis/format";
import { ReportOption } from "./types";

interface VerdictCardProps {
  /** Candidates that differ from Current, in grid order (net shipping P&L Δ, desc). */
  movedOptions: ReportOption[];
  currentFacts: SchemeEvaluation;
  monthlyOrders: number | undefined;
}

function monthlyFigure(evaluation: SchemeEvaluation, monthlyOrders: number): string {
  const perOrder =
    evaluation.orderCount > 0 ? evaluation.netShippingProfitDelta / evaluation.orderCount : 0;
  return formatCurrency(perOrder * monthlyOrders, 0);
}

/** Shared heading + plain-English explainer — prints in the PDF. */
const HEADER = (
  <>
    <h3 className="text-lg font-semibold mb-1 text-tac-accent">Spread</h3>
    <p className="text-sm text-tac-muted mb-3">
      The widest mechanical outcomes in the grid — what separates the top and bottom candidates,
      and where the money moves.
    </p>
  </>
);

export default function VerdictCard({
  movedOptions,
  currentFacts,
  monthlyOrders,
}: VerdictCardProps) {
  const top = movedOptions[0];
  const bottom = movedOptions.length > 1 ? movedOptions[movedOptions.length - 1] : undefined;

  if (!top) {
    return (
      <div className="card">
        {HEADER}
        <p className="text-sm text-tac-muted">
          Every candidate evaluates to the current scheme — there is nothing to compare yet.
          Adjust the Competitor benchmark scheme to bring a different scheme into the grid.
        </p>
      </div>
    );
  }

  const e = top.evaluation;
  const freightShift = freightShiftSentence(e, currentFacts);

  return (
    <div className="card border-l-2 border-l-tac-accent">
      {HEADER}
      <p className="text-sm mb-2">
        <strong className="text-tac-accent">{top.label}</strong> (
        {describeChangedTiers(top.scheme, top.changedTiers)}) shows the largest net shipping
        P&amp;L change: <strong>{signedCurrency(e.netShippingProfitDelta)}</strong> across{" "}
        {e.orderCount} orders — {signedCurrency(e.shippingRevenueDelta)} in fee revenue and{" "}
        {signedCurrency(-e.carrierSpendDelta)} from carrier cost
        {monthlyOrders !== undefined && e.orderCount > 0 && (
          <>
            {" "}— ≈ <strong>{monthlyFigure(e, monthlyOrders)}/month</strong> at{" "}
            {formatNumber(monthlyOrders)} orders/month (illustrative)
          </>
        )}
        .
      </p>
      <p className="text-sm text-tac-muted mb-2">
        Cost recovery moves {formatPercent(e.recoveryRateCurrent, 0)} →{" "}
        {formatPercent(e.recoveryRate, 0)}; the free-order share moves{" "}
        {formatPercent(currentFacts.freeOrderShare, 0)} → {formatPercent(e.freeOrderShare, 0)}.
      </p>
      {freightShift && <p className="text-sm text-tac-muted mb-2">{freightShift}</p>}
      {e.impact.newlyPaying >= 0.5 && (
        <p className="text-sm text-tac-muted mb-2">
          It puts {e.impact.newlyPaying.toFixed(0)} orders that ship free today onto a paid fee.
          Those orders are counted here at full fee value; whether every one of them would still
          have been placed is not modelled.
        </p>
      )}
      {bottom && (
        <p className="text-sm text-tac-muted">
          At the other end, <strong className="text-tac-text">{bottom.label}</strong> shows{" "}
          {signedCurrency(bottom.evaluation.netShippingProfitDelta)} (
          {formatCurrency(e.netShippingProfitDelta - bottom.evaluation.netShippingProfitDelta)}{" "}
          apart) — that gap is the size of the pricing decision.
        </p>
      )}
    </div>
  );
}
