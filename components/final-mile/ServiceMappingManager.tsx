"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SERVICE_LEVEL_OPTIONS } from "@/lib/constants/service-levels";
import { suggestCanonicalTier } from "@/lib/freight/canonical-tier";
import type { Carrier, CarrierServiceAliasWithCarrier } from "@/lib/db/types";
import type { UnmappedLabel } from "@/lib/actions/service-aliases";

interface Props {
  tenantId: string | null;
}

interface CarrierGroup {
  carrier: Pick<Carrier, "id" | "name" | "code">;
  aliases: CarrierServiceAliasWithCarrier[];
  unmapped: UnmappedLabel[];
}

export default function ServiceMappingManager({ tenantId }: Props) {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [aliases, setAliases] = useState<CarrierServiceAliasWithCarrier[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tenantQs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
      const [carriersRes, aliasesRes, unmappedRes] = await Promise.all([
        fetch("/api/carriers", { cache: "no-store" }).then(parseJson<Carrier[]>),
        fetch(`/api/service-aliases${tenantQs}`, { cache: "no-store" }).then(
          parseJson<CarrierServiceAliasWithCarrier[]>
        ),
        fetch(`/api/service-aliases/unmapped${tenantQs}`, { cache: "no-store" }).then(
          parseJson<UnmappedLabel[]>
        ),
      ]);
      setCarriers(carriersRes);
      setAliases(aliasesRes);
      setUnmapped(unmappedRes);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const groups = useMemo<CarrierGroup[]>(() => {
    const byCarrier = new Map<string, CarrierGroup>();
    for (const c of carriers) {
      byCarrier.set(c.id, {
        carrier: { id: c.id, name: c.name, code: c.code },
        aliases: [],
        unmapped: [],
      });
    }
    for (const a of aliases) {
      const g = byCarrier.get(a.carrier_id);
      if (g) g.aliases.push(a);
    }
    for (const u of unmapped) {
      const g = byCarrier.get(u.carrier_id);
      if (g) g.unmapped.push(u);
    }
    return Array.from(byCarrier.values())
      .filter((g) => g.aliases.length > 0 || g.unmapped.length > 0)
      .sort((a, b) => {
        const score = (g: CarrierGroup) => g.unmapped.length;
        return score(b) - score(a) || a.carrier.name.localeCompare(b.carrier.name);
      });
  }, [carriers, aliases, unmapped]);

  if (loading) {
    return <p className="text-tac-muted text-sm">Loading mappings…</p>;
  }
  if (error) {
    return (
      <div className="card border-tac-warning/50 bg-tac-warning/10">
        <p className="text-sm text-tac-warning">{error}</p>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-tac-muted">
          No carrier service data to map yet. Upload a billing extract or
          manual CSV to surface labels here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-xs text-tac-muted">
        Aliases default to <span className="text-tac-text">global</span> (apply
        to every tenant). Tenant-scoped overrides are saved against the active
        tenant in the top-right selector.
      </p>
      {groups.map((g) => (
        <CarrierSection
          key={g.carrier.id}
          group={g}
          tenantId={tenantId}
          onChanged={reload}
        />
      ))}
    </div>
  );
}

interface SectionProps {
  group: CarrierGroup;
  tenantId: string | null;
  onChanged: () => void;
}

function CarrierSection({ group, tenantId, onChanged }: SectionProps) {
  return (
    <section className="card">
      <header className="flex items-baseline justify-between mb-4 gap-4">
        <h2 className="text-xl font-semibold">{group.carrier.name}</h2>
        <span className="text-xs text-tac-muted">{group.carrier.code}</span>
      </header>

      {group.unmapped.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-tac-warning mb-2">
            Needs mapping ({group.unmapped.length})
          </h3>
          <UnmappedTable
            rows={group.unmapped}
            carrierId={group.carrier.id}
            tenantId={tenantId}
            onChanged={onChanged}
          />
        </div>
      )}

      {group.aliases.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-tac-text mb-2">
            Existing aliases ({group.aliases.length})
          </h3>
          <AliasTable rows={group.aliases} onChanged={onChanged} />
        </div>
      )}
    </section>
  );
}

interface UnmappedTableProps {
  rows: UnmappedLabel[];
  carrierId: string;
  tenantId: string | null;
  onChanged: () => void;
}

function UnmappedTable({ rows, carrierId, tenantId, onChanged }: UnmappedTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-tac-muted border-b border-tac-border">
            <th className="py-2 pr-4 font-medium">Raw label</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 pr-4 font-medium text-right">Volume rows</th>
            <th className="py-2 pr-4 font-medium">Map to canonical</th>
            <th className="py-2 pr-4 font-medium">Scope</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <UnmappedRow
              key={`${r.carrier_id}|${r.raw_label}|${r.source}`}
              row={r}
              carrierId={carrierId}
              tenantId={tenantId}
              onChanged={onChanged}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface UnmappedRowProps {
  row: UnmappedLabel;
  carrierId: string;
  tenantId: string | null;
  onChanged: () => void;
}

function UnmappedRow({ row, carrierId, tenantId, onChanged }: UnmappedRowProps) {
  const suggested = useMemo(() => suggestCanonicalTier(row.raw_label), [row.raw_label]);
  const [tier, setTier] = useState<string>(suggested ?? "");
  const [scope, setScope] = useState<"global" | "tenant">("global");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = tier && (scope === "global" || (scope === "tenant" && tenantId));

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/service-aliases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          carrier_id: carrierId,
          tenant_id: scope === "tenant" ? tenantId : null,
          raw_label: row.raw_label,
          canonical_tier: tier,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-tac-border/40 last:border-0">
      <td className="py-2 pr-4 font-mono text-xs">{row.raw_label}</td>
      <td className="py-2 pr-4 text-xs text-tac-muted">
        {row.source === "billing_extract" ? "billing" : "manual"}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {row.occurrence_count.toLocaleString()}
      </td>
      <td className="py-2 pr-4">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="bg-tac-bg border border-tac-border rounded px-2 py-1 text-sm"
        >
          <option value="">— pick a tier —</option>
          {SERVICE_LEVEL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
              {suggested === opt ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-4">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "global" | "tenant")}
          className="bg-tac-bg border border-tac-border rounded px-2 py-1 text-sm"
          disabled={!tenantId && scope === "tenant"}
          title={!tenantId ? "Pick a tenant to enable per-tenant overrides" : undefined}
        >
          <option value="global">Global</option>
          <option value="tenant" disabled={!tenantId}>
            Tenant override
          </option>
        </select>
      </td>
      <td className="py-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave || saving}
          className="text-xs px-3 py-1 bg-tac-accent text-tac-bg rounded font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {err && <p className="text-xs text-tac-warning mt-1">{err}</p>}
      </td>
    </tr>
  );
}

interface AliasTableProps {
  rows: CarrierServiceAliasWithCarrier[];
  onChanged: () => void;
}

function AliasTable({ rows, onChanged }: AliasTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-tac-muted border-b border-tac-border">
            <th className="py-2 pr-4 font-medium">Raw label</th>
            <th className="py-2 pr-4 font-medium">Canonical tier</th>
            <th className="py-2 pr-4 font-medium">Scope</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <AliasRow key={r.id} row={r} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface AliasRowProps {
  row: CarrierServiceAliasWithCarrier;
  onChanged: () => void;
}

function AliasRow({ row, onChanged }: AliasRowProps) {
  const [tier, setTier] = useState(row.canonical_tier);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = tier !== row.canonical_tier;

  async function patch() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/service-aliases/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canonical_tier: tier }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete alias "${row.raw_label}" → ${row.canonical_tier}?`)) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/service-aliases/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-tac-border/40 last:border-0">
      <td className="py-2 pr-4 font-mono text-xs">{row.raw_label}</td>
      <td className="py-2 pr-4">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="bg-tac-bg border border-tac-border rounded px-2 py-1 text-sm"
        >
          {SERVICE_LEVEL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-4 text-xs text-tac-muted">
        {row.tenant_id ? "Tenant override" : "Global"}
      </td>
      <td className="py-2">
        <div className="flex gap-2 items-center">
          {dirty && (
            <button
              type="button"
              onClick={patch}
              disabled={saving}
              className="text-xs px-3 py-1 bg-tac-accent text-tac-bg rounded font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="text-xs text-tac-muted hover:text-tac-warning disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        {err && <p className="text-xs text-tac-warning mt-1">{err}</p>}
      </td>
    </tr>
  );
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
