"use client";

/**
 * Fixed interpretation guardrails for the options report. These are scope limits of
 * the model, not data — they apply to every figure below regardless of inputs, so the
 * copy is static. Placed between the reconciliation gate (does the model match reality?)
 * and the verdict (the first number) so the reader frames the numbers before reading them.
 */
const NOTES: { heading: string; body: string }[] = [
  {
    heading: "These figures re-price the orders you already get",
    body: "The model runs on your uploaded order history. It does not model new customers a different shipping offer might win, or existing ones it might lose. Read every figure as the effect on your current book — not a growth or revenue forecast.",
  },
  {
    heading: "Every dollar scales with the assumptions",
    body: "The basket-build rate, abandonment rate and COGS are estimates set in the panel, not values measured from this store. The projected contribution moves with them. Adjust the sliders to see how sensitive the result is before acting on a number.",
  },
  {
    heading: "Cost recovery means break-even, not maximum profit",
    body: "The Cost-recovery optimiser targets shipping revenue ≈ carrier cost. A scheme that earns more overall but over-charges for freight ranks below a break-even one. It answers “stop subsidising or over-charging shipping”, not “make the most money”.",
  },
];

export default function HowToReadCard() {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">How to read this</h3>
      <p className="text-sm text-tac-muted mb-3">
        What these numbers do and don’t say — read before the figures below.
      </p>
      <ul className="space-y-2.5 list-none p-0 m-0">
        {NOTES.map((note) => (
          <li key={note.heading} className="text-sm border-l-2 border-l-tac-muted pl-3">
            <span className="font-medium">{note.heading}.</span> {note.body}
          </li>
        ))}
      </ul>
    </div>
  );
}
