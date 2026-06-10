"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/shared/Nav";
import { parseShippingOrders } from "@/lib/shipping-sim/parse";
import {
  CanonicalTier,
  OrderRow,
  Scheme,
  TaggedOrder,
  TierConfig,
} from "@/lib/shipping-sim/types";
import StepUpload from "./steps/StepUpload";
import StepMapServices from "./steps/StepMapServices";
import StepCurrentScheme from "./steps/StepCurrentScheme";
import StepProposal from "./steps/StepProposal";

export type ServiceMap = Record<string, CanonicalTier | "exclude">;

const STEPS = ["Upload", "Map services", "Current state", "Proposal"] as const;

export default function ShippingSimulatorWizard() {
  const [step, setStep] = useState(0);

  // Step 1
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  // Step 2
  const [serviceMap, setServiceMap] = useState<ServiceMap>({});
  const [avgCosts, setAvgCosts] = useState<Partial<Record<CanonicalTier, number>>>({});

  // Steps 3 & 4 — fee/threshold per tier
  const [currentTiers, setCurrentTiers] = useState<Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>>({});
  const [proposedTiers, setProposedTiers] = useState<Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>>({});
  const [cogsPercent, setCogsPercent] = useState<number | undefined>(undefined);
  const [monthlyOrders, setMonthlyOrders] = useState<number | undefined>(undefined);

  function handleUpload(csvText: string) {
    const r = parseShippingOrders(csvText);
    setOrders(r.orders);
    setServices(r.services);
    setParseErrors(r.errors);
    setParseWarnings(r.warnings);
  }

  // Tiers actually used (mapped to a canonical tier, not excluded)
  const usedTiers = useMemo<CanonicalTier[]>(() => {
    const set = new Set<CanonicalTier>();
    for (const svc of services) {
      const m = serviceMap[svc];
      if (m && m !== "exclude") set.add(m);
    }
    return Array.from(set);
  }, [services, serviceMap]);

  // Orders tagged with canonical tier (excluded services dropped)
  const taggedOrders = useMemo<TaggedOrder[]>(() => {
    return orders
      .map((o) => {
        const m = serviceMap[o.rawService];
        if (!m || m === "exclude") return null;
        return { ...o, tier: m };
      })
      .filter((o): o is TaggedOrder => o !== null);
  }, [orders, serviceMap]);

  const buildScheme = useCallback(
    (
      tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>
    ): Scheme => {
      const scheme: Scheme = {};
      for (const tier of usedTiers) {
        const vals = tierVals[tier];
        const config: TierConfig = {
          tier,
          fee: vals?.fee ?? 0,
          freeThreshold: vals?.freeThreshold ?? null,
          avgCost: avgCosts[tier] ?? 0,
        };
        scheme[tier] = config;
      }
      return scheme;
    },
    [usedTiers, avgCosts]
  );

  // Stable scheme identities — StepProposal memoizes its sweep on these,
  // so inline buildScheme() calls would re-run it on every wizard render.
  const currentScheme = useMemo(() => buildScheme(currentTiers), [buildScheme, currentTiers]);
  const proposedScheme = useMemo(() => buildScheme(proposedTiers), [buildScheme, proposedTiers]);

  // Seed any unconfigured current-scheme tiers with defaults when the user reaches
  // step 2, so a merchant whose real scheme matches the defaults can proceed without
  // touching every control. The reconciliation badge still flags it if the defaults
  // don't match their actual shipping revenue.
  useEffect(() => {
    if (step !== 2) return;
    setCurrentTiers((prev) => {
      const missing = usedTiers.filter((t) => prev[t] === undefined);
      if (missing.length === 0) return prev;
      const next = { ...prev };
      for (const t of missing) next[t] = { fee: 0, freeThreshold: null };
      return next;
    });
  }, [step, usedTiers]);

  // Re-seed proposed tiers from current on each forward transition into step 3,
  // so the proposal always starts from the latest current scheme — even if the user
  // went Back and edited the current state after a previous visit.
  const prevStepRef = useRef(step);
  useEffect(() => {
    if (prevStepRef.current === 2 && step === 3) {
      setProposedTiers(currentTiers);
    }
    prevStepRef.current = step;
  }, [step, currentTiers]);

  // Validation gates
  const canAdvance = useMemo(() => {
    if (step === 0) return orders.length > 0 && parseErrors.length === 0;
    if (step === 1)
      return (
        usedTiers.length > 0 &&
        services.every((s) => serviceMap[s] !== undefined) &&
        usedTiers.every((t) => avgCosts[t] !== undefined && (avgCosts[t] ?? 0) >= 0)
      );
    if (step === 2) return usedTiers.every((t) => currentTiers[t] !== undefined);
    return true;
  }, [step, orders, parseErrors, services, serviceMap, usedTiers, avgCosts, currentTiers]);

  return (
    <>
      <div className="no-print">
        <Nav />
      </div>
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2 no-print">Shipping Strategy Simulator</h1>

        {/* Step indicator */}
        <div className="flex gap-2 mb-8 no-print">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`flex-1 text-center text-sm py-2 rounded-lg border ${
                i === step
                  ? "border-tac-accent text-tac-accent"
                  : i < step
                  ? "border-tac-success/40 text-tac-success"
                  : "border-tac-border text-tac-muted"
              }`}
            >
              {i + 1}. {label}
            </div>
          ))}
        </div>

        {step === 0 && (
          <StepUpload
            orders={orders}
            errors={parseErrors}
            warnings={parseWarnings}
            onUpload={handleUpload}
          />
        )}
        {step === 1 && (
          <StepMapServices
            services={services}
            serviceMap={serviceMap}
            avgCosts={avgCosts}
            usedTiers={usedTiers}
            onMapChange={(svc, tier) => setServiceMap((p) => ({ ...p, [svc]: tier }))}
            onAvgCostChange={(tier, v) => setAvgCosts((p) => ({ ...p, [tier]: v }))}
          />
        )}
        {step === 2 && (
          <StepCurrentScheme
            orders={taggedOrders}
            usedTiers={usedTiers}
            avgCosts={avgCosts}
            tierVals={currentTiers}
            onChange={(tier, patch) =>
              setCurrentTiers((p) => ({ ...p, [tier]: { fee: 0, freeThreshold: null, ...p[tier], ...patch } }))
            }
          />
        )}
        {step === 3 && (
          <StepProposal
            orders={taggedOrders}
            usedTiers={usedTiers}
            tierVals={proposedTiers}
            cogsPercent={cogsPercent}
            monthlyOrders={monthlyOrders}
            currentScheme={currentScheme}
            proposedScheme={proposedScheme}
            onChange={(tier, patch) =>
              setProposedTiers((p) => ({ ...p, [tier]: { fee: 0, freeThreshold: null, ...p[tier], ...patch } }))
            }
            onCogsChange={setCogsPercent}
            onMonthlyOrdersChange={setMonthlyOrders}
          />
        )}

        {/* Nav buttons */}
        <div className="flex justify-between mt-8 no-print">
          <button
            className="btn-secondary"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          {step < STEPS.length - 1 && (
            <button className="btn-primary" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          )}
        </div>
      </main>
    </>
  );
}
