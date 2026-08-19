"use client";

import { SchemeEvaluation } from "@/lib/shipping-sim/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/calculations";
import {
  describeChangedTiers,
  freightShiftSentence,
  recoveryMoveSentence,
  signedCurrency,
} from "../analysis/format";
import { MECHANICAL_CAVEAT, ReportOption } from "./types";

interface FindingsCardProps {
  /** Candidates that differ from Current, in grid order (net shipping P&L Δ, desc). */
  movedOptions: ReportOption[];
  currentFacts: SchemeEvaluation;
  monthlyOrders: number | undefined;
}

/**
 * Which of the two mechanical levers carries the row's net change.
 *
 * Whether orders switched service is read from the switch COUNT, never from the
 * carrier delta: tiers with equal avgCost, or switches that cancel out, move orders
 * between services at a carrier delta of exactly $0. Inferring "nothing switched"
 * from a $0 delta contradicts the switch count printed in the order-impact table.
 */
function driverSentence(evaluation: SchemeEvaluation): string {
  const fee = evaluation.shippingRevenueDelta;
  const carrier = -evaluation.carrierSpendDelta;
  const switched = evaluation.impact.switchedTier;

  if (switched === 0) {
    return `All of the change is fee revenue (${signedCurrency(fee)}); every order ships on the service it does today, so the carrier bill is unchanged.`;
  }
  const orderWord = switched === 1 ? "order lands" : "orders land";
  if (Math.abs(carrier) < 0.005) {
    return `${switched} ${orderWord} on a different service, but those services cost the same to ship — so the carrier bill is unchanged and all of the change is fee revenue (${signedCurrency(fee)}).`;
  }
  const leadFee = Math.abs(fee) >= Math.abs(carrier);
  return `The change splits into ${signedCurrency(fee)} of fee revenue and ${signedCurrency(carrier)} of carrier cost — ${leadFee ? "fee revenue" : "the carrier bill"} carries it, because ${switched} ${orderWord} on a different service.`;
}

export default function FindingsCard({
  movedOptions,
  currentFacts,
  monthlyOrders,
}: FindingsCardProps) {
  const top = movedOptions[0];

  const findings: string[] = [];
  if (top) {
    const e = top.evaluation;
    findings.push(
      `${top.label} (${describeChangedTiers(top.scheme, top.changedTiers)}) shows the largest net shipping P&L change: ${signedCurrency(e.netShippingProfitDelta)} across ${e.orderCount} orders.`
    );
    findings.push(driverSentence(e));
    const recoveryMove = recoveryMoveSentence(e, currentFacts);
    findings.push(
      recoveryMove ??
        `Cost recovery moves ${formatPercent(currentFacts.recoveryRate, 1)} → ${formatPercent(e.recoveryRate, 1)}.`
    );
    const freightShift = freightShiftSentence(e, currentFacts);
    if (freightShift) findings.push(`Freight shift: ${freightShift}`);
    if (e.impact.newlyPaying > 0 || e.impact.newlyFree > 0) {
      findings.push(
        `Who changes: ${e.impact.newlyPaying} orders that ship free today start paying a fee; ${e.impact.newlyFree} orders that pay today start shipping free.`
      );
    }
    if (monthlyOrders !== undefined && e.orderCount > 0) {
      const perOrder = e.netShippingProfitDelta / e.orderCount;
      findings.push(
        `At ${formatNumber(monthlyOrders)} orders/month that scales to ≈ ${formatCurrency(perOrder * monthlyOrders, 0)}/month · ${formatCurrency(perOrder * monthlyOrders * 12, 0)}/year (illustrative — assumes the sample mix is representative).`
      );
    }
  } else {
    findings.push(
      "Every candidate evaluates to the current scheme — there is nothing to compare yet. Adjust the Competitor benchmark scheme to bring a different scheme into the grid."
    );
  }

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">Findings</h3>
      <p className="text-sm text-tac-muted mb-3">
        The story in bullets — start here if you read nothing else.
      </p>
      <ul className="space-y-2.5 list-none p-0 m-0">
        {findings.map((f, i) => (
          <li key={i} className="text-sm border-l-2 border-l-tac-accent pl-3">
            {f}
          </li>
        ))}
      </ul>
      <p className="text-xs text-tac-warning mt-4">{MECHANICAL_CAVEAT}</p>
    </div>
  );
}
