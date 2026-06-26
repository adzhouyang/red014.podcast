import { NextResponse } from "next/server";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const TTS_OUTPUT =
  "/Users/jarvis/Library/Mobile Documents/iCloud~md~obsidian/Documents/Infinity/04 Personal Project/Red014.Podcast/tts-output";

export interface PodcastMeta {
  id: string;
  title: string;
  generated_at: string;
  stats: {
    total_turns: number;
    success_turns: number;
    fail_turns: number;
    total_audio_bytes: number;
    elapsed_seconds: number;
    estimated_cost: string;
  };
  segments: string[];
  final: string | null;
  dir_path: string;
}

export async function GET() {
  try {
    const entries = readdirSync(TTS_OUTPUT, { withFileTypes: true });
    const podcasts: PodcastMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(TTS_OUTPUT, entry.name);
      const metaPath = join(dirPath, "meta.json");

      try {
        const raw = readFileSync(metaPath, "utf-8");
        const meta = JSON.parse(raw);

        const finalPath = join(dirPath, "final.mp3");
        let finalExists = false;
        try {
          finalExists = statSync(finalPath).isFile();
        } catch {
          // final.mp3 doesn't exist
        }

        const segments: string[] = meta.files?.segments || [];
        const verifiedSegments = segments.filter((seg: string) => {
          try {
            return statSync(join(dirPath, seg)).isFile();
          } catch {
            return false;
          }
        });

        podcasts.push({
          id: entry.name,
          title: meta.title || entry.name,
          generated_at: meta.generated_at || "",
          stats: {
            total_turns: meta.stats?.total_turns ?? 0,
            success_turns: meta.stats?.success_turns ?? 0,
            fail_turns: meta.stats?.fail_turns ?? 0,
            total_audio_bytes: meta.stats?.total_audio_bytes ?? 0,
            elapsed_seconds: meta.stats?.elapsed_seconds ?? 0,
            estimated_cost: meta.stats?.estimated_cost ?? "N/A",
          },
          segments: verifiedSegments,
          final: finalExists ? "final.mp3" : null,
          dir_path: dirPath,
        });
      } catch {
        continue;
      }
    }

    podcasts.sort(
      (a, b) =>
        new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
    );

    return NextResponse.json({ podcasts });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to scan podcasts", detail: String(err) },
      { status: 500 }
    );
  }
}
