import type { AiPrSignals } from "@mergebrake/shared";

const AI_COAUTHOR_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  { pattern: /Co-Authored-By:\s*Claude Code\b/i, label: "Claude Code" },
  { pattern: /Co-Authored-By:\s*Claude(?!\s+Code)\b/i, label: "Claude" },
  { pattern: /Co-Authored-By:\s*Cursor\b/i, label: "Cursor" },
  { pattern: /Co-Authored-By:\s*(?:OpenAI\s+)?Codex\b/i, label: "Codex" },
  { pattern: /Co-Authored-By:\s*Copilot\b/i, label: "GitHub Copilot" },
  { pattern: /Co-Authored-By:\s*Devin\b/i, label: "Devin" },
  { pattern: /Co-Authored-By:\s*Aider\b/i, label: "Aider" },
];

const AI_FOOTER_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /Generated with \[?Claude Code\]?/i, reason: "Claude Code footer" },
  { pattern: /\bcursor-agent\b/i, reason: "Cursor agent marker" },
  { pattern: /\baider:/i, reason: "Aider footer" },
  { pattern: /\bgpt-engineer\b/i, reason: "gpt-engineer marker" },
  { pattern: /🤖 Generated/i, reason: "Robot-emoji generated footer" },
];

export function detectAiPrSignals(commitMessages: string[]): AiPrSignals {
  const coAuthors = new Set<string>();
  const reasons = new Set<string>();

  for (const raw of commitMessages) {
    const msg = raw ?? "";
    for (const { pattern, label } of AI_COAUTHOR_PATTERNS) {
      if (pattern.test(msg)) {
        coAuthors.add(label);
        reasons.add(`Detected co-author: ${label}`);
      }
    }
    for (const { pattern, reason } of AI_FOOTER_PATTERNS) {
      if (pattern.test(msg)) {
        reasons.add(reason);
      }
    }
  }

  const hasCoAuthoredByAi = coAuthors.size > 0;
  const isLikelyAiGenerated = hasCoAuthoredByAi || reasons.size > 0;

  // Scrutiny multiplier: 1x baseline; +1.5x if AI co-author; +0.5x more if multiple AI signals.
  let scrutinyMultiplier = 1;
  if (hasCoAuthoredByAi) scrutinyMultiplier += 1.5;
  if (reasons.size >= 2) scrutinyMultiplier += 0.5;

  return {
    hasCoAuthoredByAi,
    coAuthors: Array.from(coAuthors),
    isLikelyAiGenerated,
    reasons: Array.from(reasons),
    scrutinyMultiplier,
  };
}
