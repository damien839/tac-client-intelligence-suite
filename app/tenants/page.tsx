"use client";

import { useState } from "react";
import Nav from "@/components/shared/Nav";
import { useTenant } from "@/lib/tenant-context";
import type { Tenant, TenantKind } from "@/lib/db/types";

export default function TenantsPage() {
  const { tenants, addTenant, setActiveTenantId, activeTenant } = useTenant();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TenantKind>("prospect");
  const [industry, setIndustry] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          industry: industry.trim() || undefined,
          currency: currency.trim() || "AUD",
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create tenant");
      addTenant(data as Tenant);
      setName("");
      setIndustry("");
      setNotes("");
      setShowForm(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const clients = tenants.filter((t) => t.kind === "client");
  const prospects = tenants.filter((t) => t.kind === "prospect");

  return (
    <>
      <Nav />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Tenants</h1>
            <p className="text-tac-muted">
              Manage clients and prospects. The active tenant scopes all uploads, rate cards, and analyses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="px-4 py-2 rounded-lg bg-tac-accent text-tac-bg text-sm font-medium"
          >
            {showForm ? "Cancel" : "+ New Tenant"}
          </button>
        </div>

        {showForm && (
          <div className="card mb-8">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">Create Tenant</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-tac-muted mb-1">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ECX Group"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-tac-muted mb-1">Type</label>
                <div className="flex gap-2">
                  {(["client", "prospect"] as TenantKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        kind === k
                          ? "border-tac-accent bg-tac-accent/10 text-tac-accent"
                          : "border-tac-border text-tac-muted hover:text-tac-text"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-tac-muted mb-1">Industry</label>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="Apparel, FMCG, Health…"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-tac-muted mb-1">Currency</label>
                <input
                  type="text"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="input-field w-full uppercase"
                  maxLength={3}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-tac-muted mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="input-field w-full"
                />
              </div>
            </div>
            {error && <p className="text-sm text-tac-danger mt-3">{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg border border-tac-border text-tac-muted hover:text-tac-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !name.trim()}
                className="px-4 py-2 rounded-lg bg-tac-accent text-tac-bg font-medium disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create Tenant"}
              </button>
            </div>
          </div>
        )}

        <TenantList
          title="Clients"
          tenants={clients}
          activeId={activeTenant?.id ?? null}
          onSelect={setActiveTenantId}
        />
        <TenantList
          title="Prospects"
          tenants={prospects}
          activeId={activeTenant?.id ?? null}
          onSelect={setActiveTenantId}
        />

        {tenants.length === 0 && !showForm && (
          <div className="card text-center py-12 border-dashed">
            <p className="text-tac-muted mb-4">No tenants yet.</p>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="px-4 py-2 rounded-lg bg-tac-accent text-tac-bg font-medium"
            >
              Create your first tenant
            </button>
          </div>
        )}
      </main>
    </>
  );
}

interface TenantListProps {
  title: string;
  tenants: Tenant[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

function TenantList({ title, tenants, activeId, onSelect }: TenantListProps) {
  if (tenants.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3 text-tac-muted uppercase tracking-wider text-xs">
        {title} <span className="text-tac-text">({tenants.length})</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tenants.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`card text-left transition-colors ${
              t.id === activeId
                ? "border-tac-accent bg-tac-accent/5"
                : "hover:border-tac-accent/50"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-tac-text">{t.name}</h3>
              {t.id === activeId && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-tac-accent/20 text-tac-accent">
                  active
                </span>
              )}
            </div>
            {t.industry && (
              <p className="text-xs text-tac-muted">{t.industry}</p>
            )}
            <p className="text-xs text-tac-muted mt-2">{t.currency}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
