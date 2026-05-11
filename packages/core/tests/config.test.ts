import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/parser.js";
import { applyConfig } from "../src/config/apply.js";
import type { Finding } from "@mergebrake/shared";

function finding(opts: Partial<Finding> & Pick<Finding, "ruleId">): Finding {
  return {
    ruleId: opts.ruleId,
    severity: opts.severity ?? "high",
    title: opts.title ?? "t",
    message: opts.message ?? "m",
    location: opts.location ?? { file: "prisma/migrations/x/migration.sql", line: 1 },
    ormStack: opts.ormStack ?? "prisma",
    dialect: opts.dialect ?? "postgres",
    affectedSymbols: opts.affectedSymbols ?? [],
    crossRefs: opts.crossRefs ?? [],
  };
}

describe("parseConfig", () => {
  it("accepts an empty document", () => {
    expect(parseConfig("").config).toEqual({});
    expect(parseConfig("---\n").config).toEqual({});
  });

  it("parses every known field with both kebab and camel keys", () => {
    const { config, warnings } = parseConfig(`
version: 1
fail-on: EXPAND_CONTRACT
ignore:
  - destructive/drop-column
severity:
  destructive/drop-table: medium
ignore-paths:
  - "prisma/migrations/2022*/**"
overrides:
  - paths: ["prisma/migrations/legacy/**"]
    ignore: ["locking/create-index-non-concurrent"]
    severity:
      destructive/rename-column: low
scan-scope: changed
cross-ref:
  globs: ["src/**/*.ts"]
  max-matches-per-symbol: 16
`);
    expect(config.version).toBe(1);
    expect(config.failOn).toBe("EXPAND_CONTRACT");
    expect(config.ignore).toEqual(["destructive/drop-column"]);
    expect(config.severity).toEqual({ "destructive/drop-table": "medium" });
    expect(config.ignorePaths).toEqual(["prisma/migrations/2022*/**"]);
    expect(config.overrides).toHaveLength(1);
    expect(config.overrides![0]!.severity).toEqual({
      "destructive/rename-column": "low",
    });
    expect(config.scanScope).toBe("changed");
    expect(config.crossRef?.globs).toEqual(["src/**/*.ts"]);
    expect(config.crossRef?.maxMatchesPerSymbol).toBe(16);
    expect(warnings).toEqual([]);
  });

  it("warns on unknown top-level keys but does not error", () => {
    const { config, warnings } = parseConfig("future-feature: true\nignore: [a]\n");
    expect(config.ignore).toEqual(["a"]);
    expect(warnings).toEqual(['unknown config key "future-feature"']);
  });

  it("rejects invalid severity values", () => {
    expect(() => parseConfig("severity:\n  rule/x: super-critical")).toThrow(
      /severity\.rule\/x must be one of/,
    );
  });

  it("rejects invalid fail-on", () => {
    expect(() => parseConfig("fail-on: maybe")).toThrow(/fail-on must be one of/);
  });

  it("rejects overrides without paths", () => {
    expect(() =>
      parseConfig("overrides:\n  - ignore: [x]\n"),
    ).toThrow(/overrides\[0\]\.paths must contain at least one glob/);
  });
});

describe("applyConfig", () => {
  it("drops ignored rule ids", () => {
    const out = applyConfig({
      findings: [
        finding({ ruleId: "destructive/drop-column" }),
        finding({ ruleId: "destructive/drop-table" }),
      ],
      config: { ignore: ["destructive/drop-column"] },
    });
    expect(out.map((f) => f.ruleId)).toEqual(["destructive/drop-table"]);
  });

  it("applies global severity overrides", () => {
    const out = applyConfig({
      findings: [
        finding({ ruleId: "locking/create-index-non-concurrent", severity: "medium" }),
      ],
      config: { severity: { "locking/create-index-non-concurrent": "low" } },
    });
    expect(out[0]!.severity).toBe("low");
  });

  it("drops findings whose path matches ignore-paths", () => {
    const out = applyConfig({
      findings: [
        finding({
          ruleId: "destructive/drop-column",
          location: {
            file: "prisma/migrations/2022_legacy/migration.sql",
            line: 1,
          },
        }),
        finding({
          ruleId: "destructive/drop-column",
          location: {
            file: "prisma/migrations/2026_recent/migration.sql",
            line: 1,
          },
        }),
      ],
      config: { ignorePaths: ["prisma/migrations/2022*/**"] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.location.file).toContain("2026");
  });

  it("respects per-path override ignore and severity (first match wins)", () => {
    const out = applyConfig({
      findings: [
        finding({
          ruleId: "locking/add-foreign-key-without-not-valid",
          severity: "high",
          location: {
            file: "prisma/migrations/legacy/migration.sql",
            line: 1,
          },
        }),
        finding({
          ruleId: "destructive/drop-column",
          severity: "critical",
          location: {
            file: "prisma/migrations/legacy/migration.sql",
            line: 1,
          },
        }),
      ],
      config: {
        overrides: [
          {
            paths: ["prisma/migrations/legacy/**"],
            ignore: ["locking/add-foreign-key-without-not-valid"],
            severity: { "destructive/drop-column": "medium" },
          },
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.ruleId).toBe("destructive/drop-column");
    expect(out[0]!.severity).toBe("medium");
  });

  it("handles brace expansion in ignore-paths", () => {
    const out = applyConfig({
      findings: [
        finding({ location: { file: "prisma/migrations/init.sql", line: 1 }, ruleId: "a" }),
        finding({ location: { file: "prisma/migrations/init.txt", line: 1 }, ruleId: "a" }),
      ],
      config: { ignorePaths: ["prisma/**/*.{sql,prisma}"] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.location.file).toContain(".txt");
  });
});
