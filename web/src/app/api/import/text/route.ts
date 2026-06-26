import { NextRequest, NextResponse } from "next/server";
import { importPlainText } from "@/importers/plain-text";
import { normalizeText } from "@/cleaners/normalize";
import { estimateDuration } from "@/planners/duration";
import { createManifest } from "@/jobs/manifest";
import { saveManifest } from "@/jobs/runner";

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.trim().length < 10) {
      return NextResponse.json({ error: "文本内容过短，至少需要 10 个字符" }, { status: 400 });
    }
    const imported = importPlainText(text);
    const cleaned = normalizeText(imported.rawText);
    const duration = estimateDuration(cleaned.cleanedChars);
    const manifest = createManifest("text", imported.title, cleaned.cleanedChars);
    manifest.status = "importing";
    const jobDir = saveManifest(manifest);
    return NextResponse.json({
      job_id: manifest.job_id,
      title: imported.title,
      rawText: imported.rawText,
      cleanedText: cleaned.cleaned,
      cleaningChanges: cleaned.changes,
      cleanedChars: cleaned.cleanedChars,
      targetMinutes: duration.targetMinutes,
      jobDir,
    });
  } catch (err) {
    return NextResponse.json({ error: "导入失败", detail: String(err) }, { status: 500 });
  }
}
