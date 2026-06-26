"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Turn {
  id: string;
  speaker: "A" | "B";
  text: string;
  delivery?: string;
  source_claim_ids?: string[];
}

interface Segment {
  id: string;
  topic?: string;
  turns: Turn[];
}

interface PodcastScript {
  title: string;
  summary: string;
  target_duration_minutes: number;
  source_claims: Array<{ id: string; text: string }>;
  segments: Segment[];
}

interface ScriptMeta {
  provider: string;
  model: string;
  elapsed_seconds: number;
}

export default function WorkbenchPage() {
  const router = useRouter();
  const [script, setScript] = useState<PodcastScript | null>(() => {
    if (typeof window !== "undefined") {
      const scriptStr = sessionStorage.getItem("currentScript");
      if (scriptStr) {
        try {
          return JSON.parse(scriptStr) as PodcastScript;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  const [meta] = useState<ScriptMeta | null>(() => {
    if (typeof window !== "undefined") {
      const metaStr = sessionStorage.getItem("currentMeta");
      if (metaStr) {
        try {
          return JSON.parse(metaStr) as ScriptMeta;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  const [editingTurn, setEditingTurn] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      const scriptStr = sessionStorage.getItem("currentScript");
      if (scriptStr) {
        try {
          const parsed = JSON.parse(scriptStr) as PodcastScript;
          return new Set(parsed.segments.map((s) => s.id));
        } catch {
          return new Set();
        }
      }
    }
    return new Set();
  });

  const toggleSegment = useCallback((segId: string) => {
    setExpandedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segId)) next.delete(segId);
      else next.add(segId);
      return next;
    });
  }, []);

  const startEdit = useCallback((turn: Turn) => {
    setEditingTurn(turn.id);
    setEditText(turn.text);
  }, []);

  const saveEdit = useCallback(
    (turnId: string) => {
      if (!script) return;
      const updated = { ...script };
      for (const seg of updated.segments) {
        const turn = seg.turns.find((t) => t.id === turnId);
        if (turn) {
          turn.text = editText;
          break;
        }
      }
      setScript(updated);
      setEditingTurn(null);
      sessionStorage.setItem("currentScript", JSON.stringify(updated));
    },
    [script, editText],
  );

  const cancelEdit = useCallback(() => {
    setEditingTurn(null);
  }, []);

  const handleRegenerate = useCallback(
    async (segId: string) => {
      if (!script || !meta) return;
      setRegenerating((prev) => new Set(prev).add(segId));
      try {
        const resp = await fetch("/api/script/regenerate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            script,
            segmentId: segId,
            provider: meta.provider,
            promptVersion: (script as unknown as Record<string, unknown>)._promptVersion as string | undefined,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Unknown" }));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }
        const { segment: newSegment } = await resp.json();
        const updated = { ...script };
        const idx = updated.segments.findIndex((s) => s.id === segId);
        if (idx >= 0) {
          updated.segments[idx] = newSegment;
        }
        setScript(updated);
        sessionStorage.setItem("currentScript", JSON.stringify(updated));
      } catch (err) {
        alert(
          `Regeneration failed: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      } finally {
        setRegenerating((prev) => {
          const next = new Set(prev);
          next.delete(segId);
          return next;
        });
      }
    },
    [script, meta],
  );

  const goToAudio = useCallback(() => {
    if (!script) return;
    sessionStorage.setItem("currentScript", JSON.stringify(script));
    router.push("/audio");
  }, [script, router]);

  const totalTurns =
    script?.segments.reduce((s, seg) => s + seg.turns.length, 0) || 0;
  const totalChars =
    script?.segments.reduce(
      (s, seg) =>
        s + seg.turns.reduce((t, turn) => t + (turn.text?.length || 0), 0),
      0,
    ) || 0;

  if (!script) {
    return (
      <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
            <Link
              href="/"
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              ← 返回
            </Link>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              脚本工作台
            </h1>
          </div>
        </header>
        <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
          <div className="text-center py-20">
            <span className="text-5xl block mb-4">📝</span>
            <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
              尚未加载脚本
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
              先生成脚本后在此编辑
            </p>
            <Link
              href="/"
              className="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              去生成脚本 →
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex-shrink-0"
            >
              ← 返回
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {script.title}
              </h1>
              <p className="text-xs text-zinc-400 truncate">{script.summary}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-400">
              <span>
                {totalTurns} 轮 · {(totalChars / 250).toFixed(0)} 分钟
              </span>
              {meta && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                  {meta.provider}
                </span>
              )}
            </div>
            <button
              onClick={goToAudio}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
            >
              <span>🎙️</span>
              生成音频
            </button>
          </div>
        </div>
      </header>

      {/* Main: Left (claims) + Center (script) */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
          {/* Left: Source Claims */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-3">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                来源要点 ({script.source_claims.length})
              </h3>
              <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
                {script.source_claims.map((claim) => (
                  <div
                    key={claim.id}
                    className="p-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs"
                  >
                    <span className="font-mono text-[10px] text-zinc-400">
                      {claim.id}
                    </span>
                    <p className="text-zinc-700 dark:text-zinc-300 mt-1 leading-relaxed">
                      {claim.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* Center: Script */}
          <div className="space-y-4">
            {script.segments.map((segment, segIdx) => {
              const isExpanded = expandedSegments.has(segment.id);
              return (
                <div
                  key={segment.id}
                  className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                >
                  {/* Segment header */}
                  <button
                    onClick={() => toggleSegment(segment.id)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-zinc-400">
                        {segment.id}
                      </span>
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {segment.topic || `片段 ${segIdx + 1}`}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {segment.turns.length} 轮
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {meta && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRegenerate(segment.id);
                          }}
                          disabled={regenerating.has(segment.id)}
                          className="text-[10px] px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-amber-600 hover:border-amber-300 dark:hover:border-amber-700 disabled:opacity-50 transition-colors"
                          title="AI 重新生成此片段"
                        >
                          {regenerating.has(segment.id) ? "⏳" : "🔄"}
                        </button>
                      )}
                      <span
                        className={`text-zinc-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      >
                        ▼
                      </span>
                    </div>
                  </button>

                  {/* Turns */}
                  {isExpanded && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800">
                      {segment.turns.map((turn) => (
                        <div
                          key={turn.id}
                          className={`px-4 py-3 border-b border-zinc-50 dark:border-zinc-800/50 last:border-b-0 ${
                            turn.speaker === "A"
                              ? "bg-blue-50/30 dark:bg-blue-950/10"
                              : "bg-purple-50/30 dark:bg-purple-950/10"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Speaker badge */}
                            <div
                              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                turn.speaker === "A"
                                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                                  : "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                              }`}
                            >
                              {turn.speaker}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-mono text-zinc-400">
                                  {turn.id}
                                </span>
                                {turn.delivery && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                                    {turn.delivery}
                                  </span>
                                )}
                              </div>

                              {editingTurn === turn.id ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editText}
                                    onChange={(e) =>
                                      setEditText(e.target.value)
                                    }
                                    className="w-full p-2 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    rows={3}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Escape") cancelEdit();
                                      if (
                                        (e.metaKey || e.ctrlKey) &&
                                        e.key === "Enter"
                                      )
                                        saveEdit(turn.id);
                                    }}
                                  />
                                  <div className="flex items-center gap-2 text-xs">
                                    <button
                                      onClick={() => saveEdit(turn.id)}
                                      className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                    >
                                      保存 (⌘Enter)
                                    </button>
                                    <button
                                      onClick={cancelEdit}
                                      className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                    >
                                      取消 (Esc)
                                    </button>
                                    <span className="text-zinc-400">
                                      {editText.length} 字
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <p
                                  className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed cursor-pointer hover:bg-yellow-50/50 dark:hover:bg-yellow-900/10 rounded px-1 -mx-1 py-0.5 transition-colors"
                                  onClick={() => startEdit(turn)}
                                  title="点击编辑台词"
                                >
                                  {turn.text}
                                </p>
                              )}

                              {/* Source claims */}
                              {turn.source_claim_ids &&
                                turn.source_claim_ids.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {turn.source_claim_ids.map((cid) => (
                                      <span
                                        key={cid}
                                        className="text-[9px] px-1 py-0.5 rounded font-mono bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                                      >
                                        {cid}
                                      </span>
                                    ))}
                                  </div>
                                )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
