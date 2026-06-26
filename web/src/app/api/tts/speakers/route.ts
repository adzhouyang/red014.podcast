import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    speakers: [
      { name: "咪仔 × 大乙先生", speakers: ["zh_female_mizai_uranus_bigtts", "zh_male_xuanyijieshuo_uranus_bigtts"] },
    ],
  });
}
