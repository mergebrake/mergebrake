import { parse as parseYaml } from "yaml";
import type { Severity } from "@mergebrake/shared";
import {
  FAIL_ON_VALUES,
  SEVERITY_VALUES,
  type MergeBrakeConfig,
  type MergeBrakeOverride,
} from "./types.js";

export interface ParseConfigResult {
  config: MergeBrakeConfig;
  /** Non-fatal warnings about unknown / suspicious fields. */
  warnings: string[];
}

/**
 * Parse and validate a YAML configuration string.
 * Throws a single `Error` (with all problems aggregated) when the file cannot
 * be coerced into a config. Non-fatal warnings are returned alongside the
 * config so callers can surface them on stderr.
 */
export function parseConfig(yamlText: string): ParseConfigResult {
  if (yamlText.trim().length === 0) {
    return { config: {}, warnings: [] };
  }

  let raw: unknown;
  try {
    raw = parseYaml(yamlText) ?? {};
  } catch (err) {
    throw new Error(
      `failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("config root must be a mapping");
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const out: MergeBrakeConfig = {};
  const root = raw as Record<string, unknown>;
  const KNOWN_KEYS = new Set([
    "version",
    "fail-on",
    "failOn",
    "ignore",
    "severity",
    "ignore-paths",
    "ignorePaths",
    "overrides",
    "scan-scope",
    "scanScope",
    "cross-ref",
    "crossRef",
  ]);
  for (const key of Object.keys(root)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(`unknown config key "${key}"`);
    }
  }

  // version
  if ("version" in root) {
    if (root.version === 1) out.version = 1;
    else
      errors.push(
        `version must be 1; got ${JSON.stringify(root.version)}`,
      );
  }

  // fail-on
  const failOn = root["fail-on"] ?? root["failOn"];
  if (failOn !== undefined) {
    if (typeof failOn !== "string" || !FAIL_ON_VALUES.includes(failOn as never)) {
      errors.push(
        `fail-on must be one of ${FAIL_ON_VALUES.join(", ")}; got ${JSON.stringify(failOn)}`,
      );
    } else {
      out.failOn = failOn as NonNullable<MergeBrakeConfig["failOn"]>;
    }
  }

  // ignore
  if (root.ignore !== undefined) {
    const list = asStringArray(root.ignore, "ignore", errors);
    if (list) out.ignore = list;
  }

  // severity
  if (root.severity !== undefined) {
    const map = asSeverityMap(root.severity, "severity", errors);
    if (map) out.severity = map;
  }

  // ignore-paths
  const ignorePaths = root["ignore-paths"] ?? root["ignorePaths"];
  if (ignorePaths !== undefined) {
    const list = asStringArray(ignorePaths, "ignore-paths", errors);
    if (list) out.ignorePaths = list;
  }

  // overrides
  if (root.overrides !== undefined) {
    const arr = root.overrides;
    if (!Array.isArray(arr)) {
      errors.push("overrides must be an array");
    } else {
      const parsed: MergeBrakeOverride[] = [];
      arr.forEach((item, idx) => {
        const prefix = `overrides[${idx}]`;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push(`${prefix} must be a mapping`);
          return;
        }
        const itemRec = item as Record<string, unknown>;
        const paths = asStringArray(itemRec.paths, `${prefix}.paths`, errors);
        if (!paths || paths.length === 0) {
          errors.push(`${prefix}.paths must contain at least one glob`);
          return;
        }
        const override: MergeBrakeOverride = { paths };
        if (itemRec.ignore !== undefined) {
          const ig = asStringArray(itemRec.ignore, `${prefix}.ignore`, errors);
          if (ig) override.ignore = ig;
        }
        if (itemRec.severity !== undefined) {
          const sev = asSeverityMap(
            itemRec.severity,
            `${prefix}.severity`,
            errors,
          );
          if (sev) override.severity = sev;
        }
        parsed.push(override);
      });
      out.overrides = parsed;
    }
  }

  // scan-scope
  const scanScope = root["scan-scope"] ?? root["scanScope"];
  if (scanScope !== undefined) {
    if (scanScope !== "changed" && scanScope !== "all") {
      errors.push(
        `scan-scope must be "changed" or "all"; got ${JSON.stringify(scanScope)}`,
      );
    } else {
      out.scanScope = scanScope;
    }
  }

  // cross-ref
  const crossRef = root["cross-ref"] ?? root["crossRef"];
  if (crossRef !== undefined) {
    if (!crossRef || typeof crossRef !== "object" || Array.isArray(crossRef)) {
      errors.push("cross-ref must be a mapping");
    } else {
      const cr = crossRef as Record<string, unknown>;
      const parsed: NonNullable<MergeBrakeConfig["crossRef"]> = {};
      if (cr.globs !== undefined) {
        const list = asStringArray(cr.globs, "cross-ref.globs", errors);
        if (list) parsed.globs = list;
      }
      if (
        cr.maxMatchesPerSymbol !== undefined ||
        cr["max-matches-per-symbol"] !== undefined
      ) {
        const value =
          cr.maxMatchesPerSymbol ?? cr["max-matches-per-symbol"];
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
          errors.push(
            `cross-ref.maxMatchesPerSymbol must be a positive integer; got ${JSON.stringify(value)}`,
          );
        } else {
          parsed.maxMatchesPerSymbol = value;
        }
      }
      if (Object.keys(parsed).length > 0) out.crossRef = parsed;
    }
  }

  if (errors.length > 0) {
    throw new Error(`invalid mergebrake config: ${errors.join("; ")}`);
  }

  return { config: out, warnings };
}

function asStringArray(
  value: unknown,
  field: string,
  errors: string[],
): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings`);
    return null;
  }
  const out: string[] = [];
  let ok = true;
  for (let i = 0; i < value.length; i++) {
    const v = value[i];
    if (typeof v !== "string" || v.length === 0) {
      errors.push(`${field}[${i}] must be a non-empty string`);
      ok = false;
      continue;
    }
    out.push(v);
  }
  return ok ? out : null;
}

function asSeverityMap(
  value: unknown,
  field: string,
  errors: string[],
): Record<string, Severity> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field} must be a mapping`);
    return null;
  }
  const out: Record<string, Severity> = {};
  let ok = true;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string" || !SEVERITY_VALUES.includes(v as Severity)) {
      errors.push(
        `${field}.${k} must be one of ${SEVERITY_VALUES.join(", ")}; got ${JSON.stringify(v)}`,
      );
      ok = false;
      continue;
    }
    out[k] = v as Severity;
  }
  return ok ? out : null;
}
