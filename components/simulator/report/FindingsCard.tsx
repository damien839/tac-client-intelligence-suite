"use client";

import { SchemeEvaluation } from "@/lib/shipping-sim/types";
import { formatCurrency, formatNumber } from "@/lib/calculations";
import { signedCurrency } from "../analysis/format";
import { ReportOption } from "./types";

interface FindingsCardProps {
  rankedOptions: ReportOption[];
  currentFacts: SchemeEvaluation;
  monthlyOrders: number | undefined;
  assumptionEcho: string;
}

/** Largest positive contribution component for the winner, named with its value. */
function moneySource(evaluation: SchemeEvaluation, currentFacts: SchemeEvaluation): string {
  const components: { label: string; value: number }[] = [
    { label: "extra shipping fee revenue", value: evaluation.shippingRevenue - currentFacts.shippingRevenue },
    { label: "carrier savings", value: currentFacts.carrierSpend - evaluation.carrierSpend },
    { label: "basket-building product margin", value: evaluation.upliftMarginGain },
  ];
  const positive = components.filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  if (positive.length === 0) return "No component is positive — this option simply loses less than the alternatives.";
  const parts = positive.map((c) => `${c.label} (${signedCurrency(c.value)})`);
  const drag = evaluation.abandonMarginLoss > 0
    ? `, partly offset by ${formatCurrency(evaluation.abandonMarginLoss)} of margin lost to abandonment`
    : "";
  return `The money comes from ${parts.join(" and ")}${drag}.`;
}

export default function FindingsCard({
  rankedOptions,
  currentFacts,
  monthlyOrders,
  assumptionEcho,
}: FindingsCardProps) {
  const winner = rankedOptions[0];

  const findings: string[] = [];
  if (winner) {
    const w = winner.evaluation;
    findings.push(
      `${winner.label} (${winner.schemeSummary}) ranks first: ${signedCurrency(w.contributionDelta)} expected total contribution vs current across ${w.orderCount} orders.`
    );
    findings.push(moneySource(w, currentFacts));
    const newlyPayingClause =
      w.impact.newlyPaying >= 0.05
        ? `, and ${w.impact.newlyPaying.toFixed(1)} orders that ship free today would start paying shipping`
        : "";
    findings.push(
      `Risk: ${w.expectedOrdersLost.toFixed(1)} orders expected lost to abandonment${newlyPayingClause}.`
    );
    if (monthlyOrders !== undefined && w.orderCount > 0) {
      const perOrder = w.contributionDelta / w.orderCount;
      findings.push(
        `At ${formatNumber(monthlyOrders)} orders/month that scales to ≈ ${formatCurrency(perOrder * monthlyOrders, 0)}/month · ${formatCurrency(perOrder * monthlyOrders * 12, 0)}/year (illustrative — assumes the sample mix is representative).`
      );
    }
    if (winner.unconstrained) {
      findings.push(
        "Caveat: abandonment is set to 0%, so this optimum is unconstrained — nothing in the model punishes charging everyone more. Set an abandonment rate before acting on it."
      );
    }
  } else {
    findings.push(
      "No option differs from the current scheme yet — recommendations need uploaded orders that map to a service in the current scheme; adjust the Custom scheme to compare one here."
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
      <p className="text-xs text-tac-muted mt-4">{assumptionEcho}</p>
    </div>
  );
}
