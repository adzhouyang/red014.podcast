import { NextRequest, NextResponse } from "next/server";
import { createManifest } from "@/jobs/manifest";
import { saveManifest } from "@/jobs/runner";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.type !== "application/pdf") {
      return NextResponse.json({ error: "请上传 PDF 文件" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const { importPdf } = await import("@/importers/pdf");
    const { normalizeText } = await import("@/cleaners/normalize");
    const { estimateDuration } = await import("@/planners/duration");
    const imported = await importPdf(buffer, file.name);
    const cleaned = normalizeText(imported.rawText);
    const duration = estimateDuration(cleaned.cleanedChars);
    const manifest = createManifest("pdf", imported.title, cleaned.cleanedChars);
    manifest.status = "importing";
    const jobDir = saveManifest(manifest);
    return NextResponse.json({
      job_id: manifest.job_id,
      title: imported.title,
      rawText: imported.rawText,
      cleanedText: cleaned.cleaned,
      cleaningChanges: cleaned.changes,
      pageCount: imported.pageCount,
      cleanedChars: cleaned.cleanedChars,
      targetMinutes: duration.targetMinutes,
      jobDir,
    });
  } catch (err) {
    return NextResponse.json({ error: "PDF 导入失败", detail: String(err) }, { status: 500 });
  }
}
