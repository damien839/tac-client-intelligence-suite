"use client";

import RateCardManager from "./RateCardManager";

interface Props {
  tenantId: string | null;
}

export default function CurrentRateCardsTab({ tenantId }: Props) {
  return (
    <RateCardManager
      tenantId={tenantId}
      status="current"
      emptyHint="No current rate cards yet. Upload one above to get started."
    />
  );
}
