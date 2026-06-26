"use client";

import Link from "next/link";
import { useState, useRef, useCallback } from "react";

interface ProgressData {
  completedTurns: number;
  totalTurns: number;
  currentTurn: string;
  currentSpeaker: string;
  failedTurns: number;
}

interface DoneData {
  audioBase64: string;
  format: string;
  stats: {
    successTurns: number;
    totalTurns: number;
    elapsedSeconds: number;
    totalAudioBytes: number;
    estimatedCostRmb: number;
  };
  segments?: Array<{
    segmentId: string;
    turnCount: number;
    audioBase64: string;
  }>;
}

type Status = "idle" | "synthesizing" | "done" | "error";

const SAMPLE_SCRIPT = {
  title: "测试播客",
  summary: "简短测试",
  target_duration_minutes: 1,
  source_claims: [],
  segments: [
    {
      id: "seg-001",
      topic: "开场",
      turns: [
        { id: "turn-001", speaker: "A", text: "嗨，欢迎收听今天的节目。" },
        { id: "turn-002", speaker: "B", text: "大家好，我是播客主持人。" },
      ],
    },
  ],
};

export default function AudioPage() {
  const [scriptText, setScriptText] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("currentScript") || JSON.stringify(SAMPLE_SCRIPT, null, 2);
    }
    return JSON.stringify(SAMPLE_SCRIPT, null, 2);
  });
  const [jobId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("currentJobId");
    }
    return null;
  });
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [result, setResult] = useState<DoneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const synthesize = useCallback(async () => {
    setStatus("synthesizing");
    setProgress(null);
    setResult(null);
    setError(null);
    setSelectedSegment(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(scriptText);
    } catch {
      setError("JSON 解析失败，请检查脚本格式");
      setStatus("error");
      return;
    }

    try {
      const resp = await fetch("/api/tts/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: parsed, job_id: jobId }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        setError(err.error || `HTTP ${resp.status}`);
        setStatus("error");
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        setError("No response stream");
        setStatus("error");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          const eventMatch = block.match(/^event: (\w+)/m);
          const dataMatch = block.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);

          if (event === "progress") {
            setProgress(data as ProgressData);
          } else if (event === "done") {
            setResult(data as DoneData);
            setStatus("done");
          } else if (event === "error") {
            setError(data.message || "Unknown error");
            setStatus("error");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setStatus("error");
    }
  }, [scriptText, jobId]);

  const progressPct =
    status === "synthesizing" && progress && progress.totalTurns > 0
      ? Math.round((progress.completedTurns / progress.totalTurns) * 100)
      : 0;

  const audioSrc = selectedSegment
    ? result?.segments?.find((s) => s.segmentId === selectedSegment)?.audioBase64
    : result?.audioBase64;
  const audioMime = result?.format === "mp3" ? "audio/mpeg" : "audio/ogg";

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            ← 返回
          </Link>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            音频工作台
          </h1>
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
            火山引擎 TTS
          </span>
          {jobId && (
            <span className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono">
              job: {jobId}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Script Input */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            📝 播客脚本
          </h2>
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            className="w-full h-96 p-4 text-sm font-mono rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            placeholder='Paste podcast script JSON...'
          />

          <button
            onClick={synthesize}
            disabled={status === "synthesizing"}
            className="w-full py-3 px-6 rounded-xl font-semibold text-white transition-all
              bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]
              disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed
              flex items-center justify-center gap-2"
          >
            {status === "synthesizing" ? (
              <>
                <span className="animate-spin">⏳</span>
                合成中...
              </>
            ) : (
              <>
                <span>🎙️</span>
                开始合成
              </>
            )}
          </button>
        </section>

        {/* Right: Results */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            🔉 音频结果
          </h2>

          {/* Progress */}
          {status === "synthesizing" && progress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
                <span>
                  {progress.completedTurns} / {progress.totalTurns} turns
                </span>
                {progress.currentTurn && (
                  <span>
                    {progress.currentSpeaker}: {progress.currentTurn}
                  </span>
                )}
              </div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {progress.failedTurns > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ {progress.failedTurns} turns failed
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {status === "error" && error && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-400">
                ❌ {error}
              </p>
            </div>
          )}

          {/* Done */}
          {status === "done" && result && (
            <div className="space-y-4">
              {/* Audio Player */}
              <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 space-y-3">
                <audio
                  ref={audioRef}
                  controls
                  className="w-full"
                  src={
                    audioSrc
                      ? `data:${audioMime};base64,${audioSrc}`
                      : undefined
                  }
                >
                  Your browser does not support audio.
                </audio>

                {/* Download */}
                {result.audioBase64 && (
                  <a
                    href={`data:${audioMime};base64,${result.audioBase64}`}
                    download="podcast.mp3"
                    className="block w-full text-center py-2 px-4 rounded-lg text-sm font-medium
                      bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300
                      hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    ⬇ 下载 MP3
                  </a>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                  <div className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
                    {result.stats.successTurns}/{result.stats.totalTurns}
                  </div>
                  <div className="text-xs text-zinc-500">turns</div>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                  <div className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
                    {result.stats.elapsedSeconds}s
                  </div>
                  <div className="text-xs text-zinc-500">elapsed</div>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                  <div className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
                    ¥{result.stats.estimatedCostRmb}
                  </div>
                  <div className="text-xs text-zinc-500">cost</div>
                </div>
              </div>

              {/* Per-segment audio */}
              {result.segments && result.segments.length > 1 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    片段
                  </h3>
                  {result.segments.map((seg) => (
                    <button
                      key={seg.segmentId}
                      onClick={() => setSelectedSegment(seg.segmentId)}
                      className={`w-full text-left p-3 rounded-lg text-sm border transition-colors
                        ${selectedSegment === seg.segmentId
                          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                          : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        }`}
                    >
                      <span className="font-medium">
                        {seg.segmentId}
                      </span>
                      <span className="text-zinc-400 ml-2">
                        ({seg.turnCount} turns)
                      </span>
                    </button>
                  ))}
                  {selectedSegment && (
                    <button
                      onClick={() => setSelectedSegment(null)}
                      className="text-xs text-zinc-500 hover:text-zinc-700"
                    >
                      ← 回到完整音频
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Idle */}
          {status === "idle" && (
            <div className="text-center py-20">
              <span className="text-5xl block mb-4">🎧</span>
              <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                等待合成
              </h2>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                粘贴播客脚本到左侧，点击「开始合成」
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
