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
    body: "Every candidate is your uploaded order history run through a different scheme — same orders, same cart values, same volume. It does not model new customers a different shipping offer might win, or existing ones it might lose. Read every figure as the effect on your current book, not a growth or revenue forecast.",
  },
  {
    heading: "Only two things can move",
    body: "Fee revenue moves when a different share of orders sits above or below the free-shipping line. Carrier cost moves only when an order lands on a different service tier under the new scheme — the same order on the same service always costs the same to ship.",
  },
  {
    heading: "The grid is a comparison, not a recommendation",
    body: "Rows are ordered by net shipping P&L so the spread is easy to read. Nothing here searches for a “best” scheme: with customer behaviour held fixed, an unconstrained profit search always lands on “charge everyone the maximum”, which is not advice.",
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
