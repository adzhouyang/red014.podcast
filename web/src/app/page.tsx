"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { listScriptProviders, listPrompts } from "@/providers/scripts";

type InputMode = "text" | "pdf" | "url";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<InputMode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreview, setPdfPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedText, setImportedText] = useState<string | null>(null);
  const [targetDuration, setTargetDuration] = useState(10);
  const [provider, setProvider] = useState("anthropic");
  const [promptVersion, setPromptVersion] = useState("v1");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePdfSelect = useCallback((file: File) => {
    if (file.type !== "application/pdf") {
      setError("请选择 PDF 文件");
      return;
    }
    setError(null);
    setPdfFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setPdfPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handlePdfSelect(file);
    },
    [handlePdfSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handlePdfSelect(file);
    },
    [handlePdfSelect]
  );

  const handleUrlFetch = useCallback(async () => {
    if (!url.trim()) {
      setError("请输入网页链接");
      return;
    }
    try {
      setIsProcessing(true);
      setError(null);
      const response = await fetch("/api/import/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
      const data = await response.json();
      setImportedText(data.cleanedText || data.rawText || "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "获取网页内容失败"
      );
    } finally {
      setIsProcessing(false);
    }
  }, [url]);

  const handleSubmit = useCallback(async () => {
    if (mode === "url" && !url.trim()) {
      setError("请输入网页链接");
      return;
    }
    if (mode === "text" && !text.trim()) {
      setError("请输入或导入内容");
      return;
    }
    if (mode === "pdf" && !pdfFile) {
      setError("请选择 PDF 文件");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      let importResponse: Response;
      if (mode === "text") {
        importResponse = await fetch("/api/import/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } else if (mode === "pdf") {
        const formData = new FormData();
        formData.append("file", pdfFile!);
        importResponse = await fetch("/api/import/pdf", {
          method: "POST",
          body: formData,
        });
      } else {
        importResponse = await fetch("/api/import/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
      }

      if (!importResponse.ok) {
        const err = await importResponse.json();
        throw new Error(err.error || "Import failed");
      }

      const importData = await importResponse.json();
      const cleanedText = importData.cleanedText || importData.rawText || "";
      if (!cleanedText.trim()) {
        throw new Error("未能提取有效文本内容");
      }

      const scriptResp = await fetch("/api/script/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: importData.job_id,
          title: importData.title,
          cleanedText,
          targetDurationMinutes: targetDuration,
          provider,
          promptVersion,
        }),
      });

      if (!scriptResp.ok) {
        const err = await scriptResp.json();
        throw new Error(err.error || "Script generation failed");
      }

      const scriptData = await scriptResp.json();

      sessionStorage.setItem("currentJobId", importData.job_id || scriptData.job_id || "");
      sessionStorage.setItem(
        "currentScript",
        JSON.stringify(scriptData.script),
      );
      sessionStorage.setItem(
        "currentMeta",
        JSON.stringify(scriptData.meta),
      );
      router.push("/workbench");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "处理失败",
      );
    } finally {
      setIsProcessing(false);
    }
  }, [mode, text, url, pdfFile, targetDuration, provider, promptVersion, router]);

  const tabs: { key: InputMode; label: string; icon: string }[] = [
    { key: "text", label: "粘贴文本", icon: "📋" },
    { key: "pdf", label: "上传 PDF", icon: "📄" },
    { key: "url", label: "输入链接", icon: "🔗" },
  ];

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-zinc-950 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <span className="text-2xl">🎙️</span>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Red014.Podcast
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              文章转双人对谈播客
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        {/* Tabs */}
        <nav className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl mb-8">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setMode(tab.key);
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                mode === tab.key
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Input Area */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
          {mode === "text" && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                粘贴文章内容
              </label>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                placeholder="在此粘贴公众号文章、博客或其他文本内容…"
                rows={16}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-y font-mono"
              />
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>{text.length} 字符</span>
                {text.length > 0 && (
                  <button
                    onClick={() => setText("")}
                    className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
          )}

          {mode === "pdf" && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                  pdfFile
                    ? "border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/30"
                    : "border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500 bg-zinc-50 dark:bg-zinc-800/50"
                }`}
              >
                {pdfFile ? (
                  <div className="space-y-2">
                    <span className="text-4xl block">📑</span>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {pdfFile.name}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {(pdfFile.size / 1024).toFixed(1)} KB · PDF
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPdfFile(null);
                        setPdfPreview(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                      className="text-xs text-red-500 hover:text-red-600 mt-1"
                    >
                      移除文件
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <span className="text-4xl block">📤</span>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      点击选择或拖拽 PDF 文件到此处
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      支持文字型 PDF
                    </p>
                  </div>
                )}
              </div>
              {pdfPreview && (
                <details className="text-sm">
                  <summary className="text-zinc-500 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300">
                    预览 PDF
                  </summary>
                  <iframe
                    src={pdfPreview}
                    className="w-full h-96 mt-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
                    title="PDF Preview"
                  />
                </details>
              )}
            </div>
          )}

          {mode === "url" && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                输入文章链接
              </label>
              <div className="flex gap-3">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUrlFetch();
                  }}
                  placeholder="https://example.com/article"
                  className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono"
                />
                <button
                  onClick={handleUrlFetch}
                  disabled={isProcessing || !url.trim()}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {isProcessing ? "获取中…" : "获取内容"}
                </button>
              </div>
              {importedText && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <span>✓</span>
                    <span>已成功提取 {importedText.length} 字符</span>
                  </div>
                  <textarea
                    readOnly
                    value={importedText.slice(0, 500) + (importedText.length > 500 ? "\n\n… 已截断预览" : "")}
                    rows={10}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400 resize-none font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Options */}
        <div className="mt-6 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              目标时长：{targetDuration} 分钟
            </label>
            <input
              type="range"
              min="5"
              max="20"
              step="1"
              value={targetDuration}
              onChange={(e) => setTargetDuration(parseInt(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-zinc-200 dark:bg-zinc-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600"
            />
            <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
              <span>5分钟</span>
              <span>10分钟</span>
              <span>15分钟</span>
              <span>20分钟</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              脚本模型
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              {listScriptProviders().map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name === "anthropic" ? `Claude / Anthropic (推荐) — ${p.models.join(", ")}` : `${p.name} — ${p.models.join(", ")}`}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-zinc-400">
              请确保已配置对应模型的 API Key。
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              提示词版本
            </label>
            <select
              value={promptVersion}
              onChange={(e) => setPromptVersion(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              {listPrompts().map((v) => (
                <option key={v} value={v}>
                  {v === "v1" ? "v1 (基础)" : v === "v2" ? "v2 (增强·推荐)" : v}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-zinc-400">
              v2 强化事实验证和自然口语表达。可搭配不同模型 A/B 对比。
            </p>
          </div>
        </div>

        {/* Submit */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isProcessing}
            className="px-6 py-3 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <span className="animate-spin">⏳</span>
                生成脚本中…
              </>
            ) : (
              <>
                开始生成播客
                <span>→</span>
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
