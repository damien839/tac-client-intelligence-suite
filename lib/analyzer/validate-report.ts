import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

let cached: { ajv: Ajv; validate: ValidateFunction } | null = null;

function getValidator(schema: Record<string, unknown>): ValidateFunction {
  if (cached) return cached.validate;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  cached = { ajv, validate };
  return validate;
}

export interface ValidationResult {
  ok: boolean;
  errors: ErrorObject[] | null;
  errorSummary: string | null;
}

export function validateReport(
  schema: Record<string, unknown>,
  payload: unknown
): ValidationResult {
  const validate = getValidator(schema);
  const ok = validate(payload);
  if (ok) {
    return { ok: true, errors: null, errorSummary: null };
  }
  const errors = validate.errors ?? [];
  const errorSummary = errors
    .slice(0, 10)
    .map((e) => `${e.instancePath || "<root>"} ${e.message ?? "invalid"}`)
    .join("; ");
  return { ok: false, errors, errorSummary };
}
