import { landedTier, proposedScenario, simulate } from "./model";
import { tierCost } from "./tiers";
import {
  Analysis,
  CANONICAL_TIERS,
  CanonicalTier,
  OrderMovement,
  Scheme,
  TaggedOrder,
  ThresholdSweepPoint,
  TierEconomics,
} from "./types";

export interface AnalyzeOptions {
  cogsPercent?: number;
  sweepTier?: CanonicalTier;
  sweepMax?: number;
  sweepStep?: number;
}

export function analyze(
  orders: TaggedOrder[],
  current: Scheme,
  proposed: Scheme,
  opts: AnalyzeOptions = {}
): Analysis {
  const { cogsPercent, sweepTier = "standard", sweepMax = 400, sweepStep = 10 } = opts;

  // Only orders whose chosen tier exists in the current scheme are analysable
  // (mirrors currentScenario's skip behaviour; avoids revealedPremium throwing).
  const valid = orders.filter((o) => current[o.tier] !== undefined);

  const benchmark = simulate(valid, current, proposed, cogsPercent);

  const movement: OrderMovement[] = valid.map((o) => {
    const chosenCfg = current[o.tier]!;
    const landed = landedTier(o, current, proposed);
    const landedCfg = proposed[landed]!;
    const chosenFee = tierCost(chosenCfg, o.gross);
    const landedFee = tierCost(landedCfg, o.gross);
    const chosenNet = chosenFee - chosenCfg.avgCost;
    const landedNet = landedFee - landedCfg.avgCost;
    return {
      gross: o.gross,
      chosenTier: o.tier,
      chosenFee,
      landedTier: landed,
      landedFee,
      moved: landed !== o.tier,
      netDelta: landedNet - chosenNet,
    };
  });
  const movedCount = movement.filter((m) => m.moved).length;

  const usedTiers = CANONICAL_TIERS.filter((t) => current[t] || proposed[t]);

  const buildEconomics = (kind: "current" | "proposed"): TierEconomics[] => {
    const rows = new Map<CanonicalTier, { count: number; feeRevenue: number; carrierCost: number }>();
    for (const t of usedTiers) rows.set(t, { count: 0, feeRevenue: 0, carrierCost: 0 });
    for (const m of movement) {
      const tier = kind === "current" ? m.chosenTier : m.landedTier;
      const fee = kind === "current" ? m.chosenFee : m.landedFee;
      const carrier = (kind === "current" ? current[m.chosenTier]! : proposed[m.landedTier]!).avgCost;
      const row = rows.get(tier)!;
      row.count += 1;
      row.feeRevenue += fee;
      row.carrierCost += carrier;
    }
    return usedTiers.map((tier) => {
      const r = rows.get(tier)!;
      return {
        tier,
        count: r.count,
        feeRevenue: r.feeRevenue,
        carrierCost: r.carrierCost,
        net: r.feeRevenue - r.carrierCost,
        recoveryRate: r.carrierCost > 0 ? r.feeRevenue / r.carrierCost : 0,
      };
    });
  };

  const recoveryCurrent =
    benchmark.current.carrierSpend > 0
      ? benchmark.current.shippingRevenue / benchmark.current.carrierSpend
      : 0;
  const recoveryProposed =
    benchmark.proposed.carrierSpend > 0
      ? benchmark.proposed.shippingRevenue / benchmark.proposed.carrierSpend
      : 0;

  const subsidyCurrent = movement
    .filter((m) => m.chosenFee === 0)
    .reduce((s, m) => s + current[m.chosenTier]!.avgCost, 0);
  const subsidyProposed = movement
    .filter((m) => m.landedFee === 0)
    .reduce((s, m) => s + proposed[m.landedTier]!.avgCost, 0);
  const freeOrdersCurrent = movement.filter((m) => m.chosenFee === 0).length;
  const freeOrdersProposed = movement.filter((m) => m.landedFee === 0).length;

  const thresholdSweep: ThresholdSweepPoint[] = [];
  const sweepBase = proposed[sweepTier];
  if (sweepBase) {
    for (let t = 0; t <= sweepMax; t += sweepStep) {
      const variant: Scheme = { ...proposed, [sweepTier]: { ...sweepBase, freeThreshold: t } };
      const r = proposedScenario(valid, current, variant);
      thresholdSweep.push({ threshold: t, netShippingProfit: r.shippingRevenue - r.carrierSpend });
    }
  }
  const optimalPoint = thresholdSweep.reduce<ThresholdSweepPoint | null>(
    (best, p) => (best === null || p.netShippingProfit > best.netShippingProfit ? p : best),
    null
  );

  return {
    benchmark,
    recoveryCurrent,
    recoveryProposed,
    subsidyCurrent,
    subsidyProposed,
    freeOrdersCurrent,
    freeOrdersProposed,
    tierEconomicsCurrent: buildEconomics("current"),
    tierEconomicsProposed: buildEconomics("proposed"),
    movement,
    movedCount,
    thresholdSweep,
    optimalThreshold: optimalPoint ? optimalPoint.threshold : 0,
    optimalNet: optimalPoint ? optimalPoint.netShippingProfit : 0,
    netDeltaPerOrder: valid.length > 0 ? benchmark.netProfitDelta / valid.length : 0,
  };
}
