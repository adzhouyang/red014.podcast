import { NextRequest, NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.RED014_DATA_DIR || join(process.cwd(), "data");
const JOBS_DIR = join(DATA_DIR, "jobs");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dir = searchParams.get("dir");
  const file = searchParams.get("file");

  if (!dir || !file) {
    return NextResponse.json(
      { error: "Missing 'dir' or 'file' query param" },
      { status: 400 }
    );
  }

  if (dir.includes("..") || file.includes("..") || dir.includes("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const filePath = join(JOBS_DIR, dir, "audio", file);

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 404 });
    }

    const buffer = readFileSync(filePath);
    const headers = new Headers({
      "Content-Type": "audio/mpeg",
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000",
    });

    return new NextResponse(buffer, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
