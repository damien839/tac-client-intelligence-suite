"use client";

import RateCardManager from "./RateCardManager";

interface Props {
  tenantId: string | null;
}

export default function NewRateCardsTab({ tenantId }: Props) {
  return (
    <RateCardManager
      tenantId={tenantId}
      status="new"
      emptyHint="No new/proposed rate cards yet. Upload one to compare against current."
    />
  );
}
