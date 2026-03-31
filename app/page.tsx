"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Nav from "@/components/shared/Nav";

interface ClientProfile {
  clientName: string;
  industry: string;
  auditDate: string;
  currency: string;
  modulesCompleted: string[];
}

const defaultProfile: ClientProfile = {
  clientName: "",
  industry: "",
  auditDate: new Date().toISOString().split("T")[0],
  currency: "AUD",
  modulesCompleted: [],
};

export default function HomePage() {
  const [profile, setProfile] = useState<ClientProfile>(defaultProfile);

  useEffect(() => {
    const saved = localStorage.getItem("tac-client-profile");
    if (saved) setProfile(JSON.parse(saved));
  }, []);

  const save = (updates: Partial<ClientProfile>) => {
    const updated = { ...profile, ...updates };
    setProfile(updated);
    localStorage.setItem("tac-client-profile", JSON.stringify(updated));
  };

  const modules = [
    {
      href: "/simulator",
      title: "Shipping Strategy Simulator",
      description:
        "Model free shipping thresholds, flat fee alternatives, and carrier mix impact on profit.",
      icon: "📦",
      id: "simulator",
    },
    {
      href: "/audit",
      title: "Cost Audit & Comparison",
      description:
        "Benchmark carrier and warehouse costs against TAC standards. Surface savings opportunities.",
      icon: "📊",
      id: "audit",
    },
    {
      href: "/retention",
      title: "EBIT & Retention Model",
      description:
        "Quantify EBIT uplift from improving repeat purchase rates and lowering blended CAC.",
      icon: "💰",
      id: "retention",
    },
  ];

  return (
    <>
      <Nav />
      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">
            Client Intelligence Suite
          </h1>
          <p className="text-tac-muted text-lg max-w-2xl mx-auto">
            Data-driven shipping strategy, cost benchmarking, and retention
            modelling for ecommerce operators.
          </p>
        </div>

        {/* Client Profile Card */}
        <div className="card mb-10">
          <h2 className="text-lg font-semibold mb-4 text-tac-accent">
            Client Profile
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label-text">Client Name</label>
              <input
                type="text"
                value={profile.clientName}
                onChange={(e) => save({ clientName: e.target.value })}
                placeholder="e.g. Brand Co."
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">Industry</label>
              <input
                type="text"
                value={profile.industry}
                onChange={(e) => save({ industry: e.target.value })}
                placeholder="e.g. Fashion / Apparel"
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">Audit Date</label>
              <input
                type="date"
                value={profile.auditDate}
                onChange={(e) => save({ auditDate: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">Currency</label>
              <select
                value={profile.currency}
                onChange={(e) => save({ currency: e.target.value })}
                className="input-field"
              >
                <option value="AUD">AUD</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="NZD">NZD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
        </div>

        {/* Module Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {modules.map((mod) => (
            <Link key={mod.href} href={mod.href}>
              <div className="card hover:border-tac-accent/50 transition-all cursor-pointer h-full group">
                <div className="text-4xl mb-4">{mod.icon}</div>
                <h3 className="text-lg font-semibold mb-2 group-hover:text-tac-accent transition-colors">
                  {mod.title}
                </h3>
                <p className="text-sm text-tac-muted">{mod.description}</p>
                {profile.modulesCompleted.includes(mod.id) && (
                  <p className="text-xs text-tac-success mt-3">✓ Completed</p>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="mt-10 text-center">
          <Link href="/report" className="btn-secondary inline-block">
            View Combined Report →
          </Link>
        </div>
      </main>
    </>
  );
}
