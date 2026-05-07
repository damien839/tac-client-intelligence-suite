// Canonical freight service-level options used across rate cards + volumes.
// Stored values are Title Case so they match what carriers/3PLs use on
// invoices and rate cards. If the freight team needs a new option, add it
// here and existing free-form values stay valid (it's still a text column).

export const SERVICE_LEVEL_OPTIONS = [
  "Express",
  "Standard",
  "Next Day",
  "Same Day",
  "International Express",
  "International Standard",
] as const;

export type ServiceLevel = (typeof SERVICE_LEVEL_OPTIONS)[number];

export function isCanonicalServiceLevel(value: string): value is ServiceLevel {
  return (SERVICE_LEVEL_OPTIONS as readonly string[]).includes(value);
}
