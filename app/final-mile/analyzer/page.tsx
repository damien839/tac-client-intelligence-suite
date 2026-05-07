"use client";

import Nav from "@/components/shared/Nav";
import { useTenant } from "@/lib/tenant-context";
import AnalyzerChat from "@/components/final-mile/AnalyzerChat";

export default function AnalyzerPage() {
  const { activeTenant } = useTenant();

  return (
    <>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-baseline justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-1">Final Mile Analyzer</h1>
            <p className="text-tac-muted text-sm">
              {activeTenant
                ? `Working with ${activeTenant.name}`
                : "Select a tenant to begin"}
            </p>
          </div>
          <a
            href="/final-mile"
            className="text-sm text-tac-muted hover:text-tac-accent"
          >
            ← back to rate cards
          </a>
        </div>

        {!activeTenant ? (
          <div className="card border-tac-accent/50 bg-tac-accent/5">
            <p className="text-sm">
              <span className="text-tac-accent font-semibold">Select a tenant</span>{" "}
              <span className="text-tac-muted">
                from the top-right selector to start the analyzer.
              </span>
            </p>
          </div>
        ) : (
          <AnalyzerChat tenantId={activeTenant.id} />
        )}
      </main>
    </>
  );
}
