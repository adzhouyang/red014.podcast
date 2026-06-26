import { NextRequest, NextResponse } from "next/server";
import { createManifest } from "@/jobs/manifest";
import { saveManifest } from "@/jobs/runner";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "请上传 .txt 或 .md 文件" },
        { status: 400 },
      );
    }

    const { importTextFile } = await import("@/importers/text-file");
    const { normalizeText } = await import("@/cleaners/normalize");
    const { estimateDuration } = await import("@/planners/duration");

    const buffer = Buffer.from(await file.arrayBuffer());
    const imported = importTextFile(buffer, file.name, file.type);
    const cleaned = normalizeText(imported.rawText);
    const duration = estimateDuration(cleaned.cleanedChars);

    const manifest = createManifest(
      "text",
      imported.title,
      cleaned.cleanedChars,
    );
    manifest.status = "importing";
    manifest.source_path = imported.fileName;
    const jobDir = saveManifest(manifest);

    return NextResponse.json({
      job_id: manifest.job_id,
      title: imported.title,
      fileName: imported.fileName,
      fileSizeBytes: imported.fileSizeBytes,
      encoding: imported.encoding,
      rawText: imported.rawText,
      cleanedText: cleaned.cleaned,
      cleaningChanges: cleaned.changes,
      cleanedChars: cleaned.cleanedChars,
      targetMinutes: duration.targetMinutes,
      jobDir,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "文件导入失败", detail: String(err) },
      { status: 500 },
    );
  }
}
