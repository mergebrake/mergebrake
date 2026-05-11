import type { AnalysisReport, Finding, Verdict } from "mergebrake-shared";
import pc from "picocolors";

const VERDICT_BADGE: Record<Verdict, string> = {
  SAFE: "🟢 SAFE",
  EXPAND_CONTRACT: "🟡 EXPAND / CONTRACT REQUIRED",
  BLOCK: "🔴 BLOCK — data loss or downtime risk",
};

export function renderTerminal(report: AnalysisReport): string {
  const out: string[] = [];
  out.push("");
  out.push(pc.bold("MergeBrake — schema impact guard"));
  out.push(pc.dim("─".repeat(56)));
  out.push(`Verdict:    ${colorVerdict(report.verdict)}`);
  out.push(`Risk score: ${report.riskScore}`);
  out.push(`ORM stack:  ${report.ormStack}    Dialect: ${report.dialect}`);
  if (report.aiPrSignals.isLikelyAiGenerated) {
    const factor = report.aiPrSignals.scrutinyMultiplier.toFixed(2);
    out.push(
      pc.yellow(
        `AI-PR detected (scrutiny x${factor}): ${report.aiPrSignals.coAuthors.join(", ") || report.aiPrSignals.reasons.join("; ")}`,
      ),
    );
  }
  out.push("");

  if (report.findings.length === 0) {
    out.push(pc.green("No risky changes detected."));
    out.push("");
    return out.join("\n");
  }

  for (let i = 0; i < report.findings.length; i++) {
    out.push(renderFindingTerminal(report.findings[i]!, i + 1));
    out.push("");
  }

  out.push(pc.dim(`Scanned in ${report.durationMs}ms`));
  out.push("");
  return out.join("\n");
}

function renderFindingTerminal(f: Finding, idx: number): string {
  const sev = severityBadge(f.severity);
  const lines: string[] = [];
  lines.push(`${pc.bold(`#${idx}`)} ${sev} ${pc.bold(f.title)}`);
  lines.push(pc.dim(`  ${f.location.file}:${f.location.line}  [${f.ruleId}]`));
  lines.push(`  ${f.message}`);
  if (f.crossRefs.length > 0) {
    lines.push("");
    lines.push(pc.bold(`  App-code impact (${f.crossRefs.length} reference${f.crossRefs.length === 1 ? "" : "s"}):`));
    for (const r of f.crossRefs.slice(0, 5)) {
      lines.push(`    • ${pc.cyan(r.file)}:${r.line}  ${pc.dim(r.snippet)}`);
    }
    if (f.crossRefs.length > 5) {
      lines.push(`    … and ${f.crossRefs.length - 5} more`);
    }
  }
  if (f.recipe) {
    lines.push("");
    lines.push(pc.bold("  Expand/contract recipe:"));
    lines.push(`    ${f.recipe.summary}`);
    for (const s of f.recipe.steps) {
      lines.push(`    ${pc.bold(`[${s.phase}]`)} ${s.description}`);
      if (s.sql) {
        for (const sqlLine of s.sql.split("\n")) {
          if (sqlLine.trim().length === 0) continue;
          lines.push(pc.green(`        ${sqlLine}`));
        }
      }
    }
  }
  return lines.join("\n");
}

export function renderMarkdown(
  report: AnalysisReport,
  opts: { githubAnnotations?: boolean } = {},
): string {
  const out: string[] = [];
  out.push("## MergeBrake — schema impact guard");
  out.push("");
  out.push(`**Verdict:** ${VERDICT_BADGE[report.verdict]}  •  **Risk score:** ${report.riskScore}`);
  out.push("");
  out.push(`- ORM stack: \`${report.ormStack}\``);
  out.push(`- Dialect: \`${report.dialect}\``);
  if (report.aiPrSignals.isLikelyAiGenerated) {
    out.push(
      `- 🤖 **AI-generated PR detected** (scrutiny ×${report.aiPrSignals.scrutinyMultiplier.toFixed(2)}): ${report.aiPrSignals.coAuthors.join(", ") || report.aiPrSignals.reasons.join("; ")}`,
    );
  }
  out.push("");

  if (report.findings.length === 0) {
    out.push("_No risky changes detected._");
    return out.join("\n") + "\n";
  }

  for (let i = 0; i < report.findings.length; i++) {
    out.push(renderFindingMarkdown(report.findings[i]!, i + 1));
    out.push("");
  }

  if (opts.githubAnnotations) {
    for (const f of report.findings) {
      const lvl = f.severity === "critical" || f.severity === "high" ? "error" : "warning";
      const msg = escapeGitHubAnnotationMessage(f.title);
      const file = escapeGitHubAnnotationProperty(f.location.file);
      const title = escapeGitHubAnnotationProperty("MergeBrake");
      out.push(
        `::${lvl} file=${file},line=${f.location.line},title=${title}::${msg}`,
      );
    }
  }

  out.push("");
  out.push(`<sub>Scanned in ${report.durationMs}ms by MergeBrake.</sub>`);
  return out.join("\n") + "\n";
}

function renderFindingMarkdown(f: Finding, idx: number): string {
  const out: string[] = [];
  out.push(`### ${idx}. ${sevEmoji(f.severity)} ${f.title}`);
  out.push("");
  out.push(`\`${f.location.file}:${f.location.line}\`  •  rule \`${f.ruleId}\``);
  out.push("");
  out.push(f.message);
  if (f.crossRefs.length > 0) {
    out.push("");
    out.push(`**App-code impact** — \`${f.crossRefs[0]!.symbol}\` is still referenced in:`);
    out.push("");
    out.push("```");
    for (const r of f.crossRefs.slice(0, 8)) {
      out.push(`${r.file}:${r.line}   ${r.snippet}`);
    }
    if (f.crossRefs.length > 8) {
      out.push(`… and ${f.crossRefs.length - 8} more`);
    }
    out.push("```");
  }
  if (f.recipe) {
    out.push("");
    out.push(`**Expand / contract recipe:** ${f.recipe.summary}`);
    for (const s of f.recipe.steps) {
      out.push("");
      out.push(`<details><summary><strong>[${s.phase}]</strong> ${s.description.split("\n")[0]}</summary>`);
      out.push("");
      if (s.appCodeNote) {
        out.push(`> ${s.appCodeNote}`);
        out.push("");
      }
      if (s.sql) {
        out.push("```sql");
        out.push(s.sql.trimEnd());
        out.push("```");
      }
      out.push("</details>");
    }
  }
  if (f.docsUrl) {
    out.push("");
    out.push(`[📖 Rule docs](${f.docsUrl})`);
  }
  return out.join("\n");
}

export function renderJson(report: AnalysisReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

function severityBadge(sev: Finding["severity"]): string {
  switch (sev) {
    case "critical":
      return pc.bgRed(pc.white(" CRITICAL "));
    case "high":
      return pc.bgYellow(pc.black(" HIGH "));
    case "medium":
      return pc.yellow(" MEDIUM ");
    case "low":
      return pc.blue(" LOW ");
    case "info":
    default:
      return pc.dim(" INFO ");
  }
}

function sevEmoji(sev: Finding["severity"]): string {
  switch (sev) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🔵";
    default:
      return "ℹ️";
  }
}

function colorVerdict(v: Verdict): string {
  switch (v) {
    case "SAFE":
      return pc.green(VERDICT_BADGE[v]);
    case "EXPAND_CONTRACT":
      return pc.yellow(VERDICT_BADGE[v]);
    case "BLOCK":
      return pc.red(pc.bold(VERDICT_BADGE[v]));
  }
  return String(v);
}

function escapeGitHubAnnotationMessage(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function escapeGitHubAnnotationProperty(value: string): string {
  return escapeGitHubAnnotationMessage(value)
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}
