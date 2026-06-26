import { NextRequest, NextResponse } from "next/server";
import { createManifest } from "@/jobs/manifest";
import { saveManifest } from "@/jobs/runner";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "请输入有效的网页链接" }, { status: 400 });
    }
    try { new URL(url); } catch {
      return NextResponse.json({ error: "链接格式无效" }, { status: 400 });
    }
    const { importWebpage } = await import("@/importers/webpage");
    const { normalizeText } = await import("@/cleaners/normalize");
    const { estimateDuration } = await import("@/planners/duration");
    const imported = await importWebpage(url);
    const cleaned = normalizeText(imported.rawText);
    const duration = estimateDuration(cleaned.cleanedChars);
    const manifest = createManifest("url", imported.title, cleaned.cleanedChars);
    manifest.status = "importing";
    manifest.source_url = url;
    const jobDir = saveManifest(manifest);
    return NextResponse.json({
      job_id: manifest.job_id,
      title: imported.title,
      sourceUrl: url,
      siteName: imported.siteName,
      byline: imported.byline,
      rawText: imported.rawText,
      cleanedText: cleaned.cleaned,
      cleaningChanges: cleaned.changes,
      cleanedChars: cleaned.cleanedChars,
      targetMinutes: duration.targetMinutes,
      jobDir,
    });
  } catch (err) {
    return NextResponse.json({ error: "网页抓取失败", detail: String(err) }, { status: 500 });
  }
}
