"use client";

/**
 * Report title block. Rendered at the very top of Step 4 so the printed PDF opens
 * with it rather than finding it midway down the document.
 */
function handleExport() {
  const previous = document.title;
  document.title = "Shipping Strategy Options Report";
  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

export default function ReportHeader() {
  const reportDate = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      {/* Export toolbar (screen only) */}
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-tac-muted">Comparative report — export a client-ready PDF →</p>
        <button type="button" onClick={handleExport} className="btn-secondary">
          ⬇ Download PDF
        </button>
      </div>

      {/* Report header (PDF only) */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold text-tac-accent">Shipping Strategy Options Report</h1>
        <p className="text-sm text-tac-muted">The Aggregate Co · {reportDate}</p>
      </div>
    </div>
  );
}
