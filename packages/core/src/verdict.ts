import type {
  Finding,
  AiPrSignals,
  Verdict,
} from "mergebrake-shared";
import { SEVERITY_WEIGHT, VERDICT_THRESHOLDS } from "mergebrake-shared";

export function computeVerdict(input: {
  findings: Finding[];
  aiPrSignals: AiPrSignals;
}): { verdict: Verdict; riskScore: number } {
  const baseScore = input.findings.reduce(
    (acc, f) => acc + SEVERITY_WEIGHT[f.severity],
    0,
  );
  const multiplier = Math.max(1, input.aiPrSignals.scrutinyMultiplier);
  const riskScore = Math.round(baseScore * multiplier);

  let verdict: Verdict = "SAFE";
  if (riskScore >= VERDICT_THRESHOLDS.blockAtRiskScore) {
    verdict = "BLOCK";
  } else if (riskScore >= VERDICT_THRESHOLDS.expandContractAtRiskScore) {
    verdict = "EXPAND_CONTRACT";
  }
  return { verdict, riskScore };
}
