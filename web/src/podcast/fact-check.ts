// ─── Fact Verification ──────────────────────────────
// PRD 12.3: Cross-check generated turn claims against source text
// Uses a secondary LLM pass per claim to verify factual accuracy.

import type { PodcastScript, Segment, Turn, SourceClaim } from "@/podcast/schema";

export type Verdict = "SUPPORTED" | "UNSUPPORTED" | "PARTIAL";

export interface ClaimVerification {
  claimId: string;
  claimText: string;
  verdict: Verdict;
  explanation: string;
}

export interface FactCheckResult {
  claims: ClaimVerification[];
  summary: {
    total: number;
    supported: number;
    unsupported: number;
    partial: number;
  };
}

/** Minimal provider interface for fact-check: only needs generateScript-like text output */
export interface FactCheckProvider {
  name: string;
  /** Send a prompt and get raw text response */
  check(prompt: string): Promise<string>;
}

/**
 * Build a fact-check prompt for a single claim: check if the turn
 * faithfully reflects the source claim's meaning.
 */
function buildCheckPrompt(
  claim: SourceClaim,
  relatedTurns: Turn[],
  sourceText: string,
): string {
  const turnTexts = relatedTurns
    .map((t) => `[${t.speaker}] ${t.text}`)
    .join("\n");
  const sourceSnippet = sourceText.slice(0, 2000);

  return `你是一个事实审查员。请判断以下播客台词是否忠实反映了原文中的事实。

## 原文事实
${claim.text}

## 相关台词
${turnTexts}

## 原文上下文（前 2000 字）
${sourceSnippet}

## 判断标准
- SUPPORTED：台词准确传达了原文事实，无编造或歪曲
- PARTIAL：台词部分准确，但遗漏了重要限定条件或轻微偏差
- UNSUPPORTED：台词明显歪曲了原文事实，或新增了原文没有的内容

请仅回复一行：SUPPORTED / PARTIAL / UNSUPPORTED，然后换行简短解释（不超过 50 字）。`;
}

/**
 * Verify all claims in a script against the source text.
 * Groups turns by claim ID, then checks each claim independently.
 */
export async function verifyClaims(
  script: PodcastScript,
  sourceText: string,
  provider: FactCheckProvider,
): Promise<FactCheckResult> {
  // Build claim → turns map
  const claimTurns = new Map<string, Turn[]>();
  for (const seg of script.segments) {
    for (const turn of seg.turns) {
      for (const cid of turn.source_claim_ids || []) {
        if (!claimTurns.has(cid)) claimTurns.set(cid, []);
        claimTurns.get(cid)!.push(turn);
      }
    }
  }

  const verifications: ClaimVerification[] = [];
  const claims = script.source_claims || [];

  for (const claim of claims) {
    const turns = claimTurns.get(claim.id) || [];
    if (turns.length === 0) {
      verifications.push({
        claimId: claim.id,
        claimText: claim.text,
        verdict: "PARTIAL",
        explanation: "无台词引用此 claim",
      });
      continue;
    }

    const prompt = buildCheckPrompt(claim, turns, sourceText);

    try {
      const raw = await provider.check(prompt);
      const lines = raw.trim().split("\n").filter((l) => l.trim());
      const verdictLine = lines[0]?.trim().toUpperCase() || "";
      const explanation = lines.slice(1).join(" ").slice(0, 100) || "无解释";

      let verdict: Verdict = "PARTIAL";
      if (verdictLine.startsWith("SUPPORTED")) verdict = "SUPPORTED";
      else if (verdictLine.startsWith("UNSUPPORTED")) verdict = "UNSUPPORTED";

      verifications.push({
        claimId: claim.id,
        claimText: claim.text,
        verdict,
        explanation,
      });
    } catch {
      verifications.push({
        claimId: claim.id,
        claimText: claim.text,
        verdict: "PARTIAL",
        explanation: "验证失败：API 错误",
      });
    }
  }

  return {
    claims: verifications,
    summary: {
      total: verifications.length,
      supported: verifications.filter((c) => c.verdict === "SUPPORTED").length,
      unsupported: verifications.filter((c) => c.verdict === "UNSUPPORTED").length,
      partial: verifications.filter((c) => c.verdict === "PARTIAL").length,
    },
  };
}
