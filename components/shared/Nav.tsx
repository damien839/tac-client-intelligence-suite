"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/simulator", label: "Shipping Strategy" },
  { href: "/audit", label: "Cost Audit" },
  { href: "/retention", label: "Retention Model" },
  { href: "/report", label: "Report" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="no-print bg-tac-bg-card border-b border-tac-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3">
            <span className="text-tac-accent text-lg tracking-[0.3em] font-light uppercase">
              The Aggregate Co.
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === item.href
                    ? "bg-tac-accent/10 text-tac-accent"
                    : "text-tac-muted hover:text-tac-text hover:bg-tac-bg-light"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Mobile menu */}
          <div className="md:hidden">
            <select
              value={pathname}
              onChange={(e) => {
                window.location.href = e.target.value;
              }}
              className="input-field text-sm py-1.5"
            >
              {navItems.map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </nav>
  );
}
