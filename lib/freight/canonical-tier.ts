import {
  SERVICE_LEVEL_OPTIONS,
  type ServiceLevel,
} from "@/lib/constants/service-levels";

export function suggestCanonicalTier(rawLabel: string): ServiceLevel | null {
  const tokens = rawLabel.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let best: { tier: ServiceLevel; score: number } | null = null;
  for (const tier of SERVICE_LEVEL_OPTIONS) {
    const tierTokens = tier.toLowerCase().split(/\s+/);
    const overlap = tierTokens.filter((t) => tokens.includes(t)).length;
    if (overlap === 0) continue;
    if (!best || overlap > best.score) {
      best = { tier, score: overlap };
    }
  }
  return best?.tier ?? null;
}

export function matchCanonicalCaseInsensitive(label: string): ServiceLevel | null {
  const lower = label.toLowerCase();
  for (const tier of SERVICE_LEVEL_OPTIONS) {
    if (tier.toLowerCase() === lower) return tier;
  }
  return null;
}
