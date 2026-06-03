"use client";

import Nav from "@/components/shared/Nav";
import { useTenant } from "@/lib/tenant-context";
import ServiceMappingManager from "@/components/final-mile/ServiceMappingManager";

export default function ServiceMappingPage() {
  const { activeTenant } = useTenant();

  return (
    <>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-baseline justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-1">Service-tier mapping</h1>
            <p className="text-tac-muted text-sm">
              Map carrier-specific service labels (eParcel, B2C PRIORITY,
              Premium Next Flight) to one of the six canonical tiers used
              by the analyzer.
            </p>
          </div>
          <a
            href="/final-mile/analyzer"
            className="text-sm text-tac-muted hover:text-tac-accent"
          >
            ← back to analyzer
          </a>
        </div>

        <ServiceMappingManager tenantId={activeTenant?.id ?? null} />
      </main>
    </>
  );
}
