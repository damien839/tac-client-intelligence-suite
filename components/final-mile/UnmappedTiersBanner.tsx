"use client";

import { useEffect, useState } from "react";
import type { UnmappedLabel } from "@/lib/actions/service-aliases";

interface Props {
  tenantId: string | null;
}

export default function UnmappedTiersBanner({ tenantId }: Props) {
  const [labels, setLabels] = useState<UnmappedLabel[] | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setLabels(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/service-aliases/unmapped?tenant_id=${encodeURIComponent(tenantId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? (r.json() as Promise<UnmappedLabel[]>) : []))
      .then((data) => {
        if (!cancelled) setLabels(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!labels || labels.length === 0) return null;

  const carriers = new Set(labels.map((l) => l.carrier_code));
  return (
    <div className="rounded border border-tac-warning/50 bg-tac-warning/10 px-3 py-2 text-xs mb-6 flex items-start justify-between gap-3">
      <div>
        <span className="text-tac-warning font-semibold">
          {labels.length} unmapped service label{labels.length === 1 ? "" : "s"}
        </span>{" "}
        <span className="text-tac-muted">
          across {carriers.size} carrier{carriers.size === 1 ? "" : "s"}. The engine cannot
          match these to a replacement until they are mapped to a canonical tier.
        </span>
      </div>
      <a
        href="/final-mile/admin/service-mapping"
        className="text-tac-accent underline whitespace-nowrap"
      >
        Map now →
      </a>
    </div>
  );
}
