import type { AnalysisReport, Finding, Verdict } from "mergebrake-shared";
import pc from "picocolors";

const MARKDOWN_MAIN_FINDING_LIMIT = 20;
const MARKDOWN_COLLAPSED_FINDING_LIMIT = 25;

const VERDICT_BADGE: Record<Verdict, string> = {
  SAFE: "🟢 SAFE",
  EXPAND_CONTRACT: "🟡 EXPAND / CONTRACT REQUIRED",
  BLOCK: "🔴 BLOCK — data loss or downtime risk",
};

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function renderTerminal(report: AnalysisReport): string {
  const out: string[] = [];
  out.push("");
  out.push(pc.bold("MergeBrake — schema impact guard"));
  out.push(pc.dim("─".repeat(56)));
  out.push(`Verdict:    ${colorVerdict(report.verdict)}`);
  out.push(`Risk score: ${report.riskScore}`);
  out.push(`ORM stack:  ${report.ormStack}    Dialect: ${report.dialect}`);
  if (report.findings.length > 0) {
    out.push(`Findings:   ${formatSeverityCounts(report.findings)}`);
  }
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

  const review = splitFindingsForReview(report.findings);
  out.push(`**Findings:** ${formatSeverityCounts(report.findings)}`);
  if (review.hiddenCount > 0) {
    out.push(
      `_Showing ${review.visible.length} actionable finding${review.visible.length === 1 ? "" : "s"}. ${review.hiddenCount} additional finding${review.hiddenCount === 1 ? "" : "s"} are collapsed below; full output stays available in JSON/SARIF._`,
    );
  }
  out.push("");

  for (let i = 0; i < review.visible.length; i++) {
    out.push(renderFindingMarkdown(review.visible[i]!, i + 1));
    out.push("");
  }

  if (review.overflow.length > 0) {
    out.push(renderCollapsedFindings("Additional actionable findings", review.overflow));
    out.push("");
  }

  if (review.info.length > 0) {
    out.push(renderCollapsedFindings("Informational findings collapsed", review.info));
    out.push("");
  }

  if (opts.githubAnnotations) {
    for (const f of report.findings) {
      const lvl = githubAnnotationLevel(f);
      if (!lvl) continue;
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

function splitFindingsForReview(findings: Finding[]): {
  visible: Finding[];
  overflow: Finding[];
  info: Finding[];
  hiddenCount: number;
} {
  const sorted = sortFindingsForReview(findings);
  const actionable = sorted.filter((f) => f.severity !== "info");
  const visible = actionable.slice(0, MARKDOWN_MAIN_FINDING_LIMIT);
  const overflow = actionable.slice(MARKDOWN_MAIN_FINDING_LIMIT);
  const info = sorted.filter((f) => f.severity === "info");
  return {
    visible,
    overflow,
    info,
    hiddenCount: overflow.length + info.length,
  };
}

function sortFindingsForReview(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDelta !== 0) return severityDelta;

    const impactDelta = Number(b.crossRefs.length > 0) - Number(a.crossRefs.length > 0);
    if (impactDelta !== 0) return impactDelta;

    const fileDelta = a.location.file.localeCompare(b.location.file);
    if (fileDelta !== 0) return fileDelta;

    return a.location.line - b.location.line;
  });
}

function renderCollapsedFindings(title: string, findings: Finding[]): string {
  const out: string[] = [];
  const shown = findings.slice(0, MARKDOWN_COLLAPSED_FINDING_LIMIT);
  const rest = findings.length - shown.length;

  out.push(`<details><summary><strong>${title}</strong> (${findings.length})</summary>`);
  out.push("");
  for (const f of shown) {
    out.push(
      `- ${sevEmoji(f.severity)} \`${f.ruleId}\` at \`${f.location.file}:${f.location.line}\` - ${f.title}`,
    );
  }
  if (rest > 0) {
    out.push(`- ... and ${rest} more. Use \`--format json\` or SARIF for the complete list.`);
  }
  out.push("");
  out.push("</details>");
  return out.join("\n");
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

function formatSeverityCounts(findings: Finding[]): string {
  const counts: Record<Finding["severity"], number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) counts[finding.severity] += 1;
  return (["critical", "high", "medium", "low", "info"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
}

function githubAnnotationLevel(f: Finding): "error" | "warning" | null {
  if (f.severity === "critical" || f.severity === "high") return "error";
  if (f.severity === "medium") return "warning";
  return null;
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
