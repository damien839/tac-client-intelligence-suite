"use client";

import { useState } from "react";
import Nav from "@/components/shared/Nav";
import { useTenant } from "@/lib/tenant-context";
import CurrentRateCardsTab from "@/components/final-mile/CurrentRateCardsTab";
import NewRateCardsTab from "@/components/final-mile/NewRateCardsTab";
import BillingTab from "@/components/final-mile/BillingTab";

type TabKey = "current-rate-cards" | "new-rate-cards" | "billing";

const tabs: { key: TabKey; label: string; description: string }[] = [
  {
    key: "current-rate-cards",
    label: "Current Rate Cards",
    description: "Existing carrier rate cards in effect for this tenant.",
  },
  {
    key: "new-rate-cards",
    label: "New Rate Cards",
    description: "Upload a new rate card to compare against current.",
  },
  {
    key: "billing",
    label: "Current Volume",
    description:
      "Current monthly shipment volume + charges by carrier, service, and zone. CSV upload now; billing-PDF extraction in phase 2.",
  },
];

export default function FinalMilePage() {
  const { activeTenant } = useTenant();
  const [tab, setTab] = useState<TabKey>("current-rate-cards");

  return (
    <>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Final Mile</h1>
        <p className="text-tac-muted mb-8">
          Carrier rate-card ingestion, comparison, and savings analysis. Powered by Claude for clean
          import from PDF, Excel, or CSV.
        </p>

        {!activeTenant && (
          <div className="card border-tac-accent/50 bg-tac-accent/5 mb-8">
            <p className="text-sm">
              <span className="text-tac-accent font-semibold">Select a tenant</span>{" "}
              <span className="text-tac-muted">
                to start uploading rate cards. Use the tenant selector in the top right or visit{" "}
              </span>
              <a href="/tenants" className="text-tac-accent underline">
                /tenants
              </a>
              <span className="text-tac-muted">.</span>
            </p>
          </div>
        )}

        <div className="border-b border-tac-border mb-6 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key
                  ? "border-tac-accent text-tac-accent"
                  : "border-transparent text-tac-muted hover:text-tac-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="text-tac-muted text-sm mb-6">
          {tabs.find((t) => t.key === tab)?.description}
        </p>

        {tab === "current-rate-cards" && <CurrentRateCardsTab tenantId={activeTenant?.id ?? null} />}
        {tab === "new-rate-cards" && <NewRateCardsTab tenantId={activeTenant?.id ?? null} />}
        {tab === "billing" && <BillingTab tenantId={activeTenant?.id ?? null} />}
      </main>
    </>
  );
}
