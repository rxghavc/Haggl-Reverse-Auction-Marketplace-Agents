import { dbGetNegotiationTranscripts } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const ids = (new URL(req.url).searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    const transcripts = await dbGetNegotiationTranscripts(ids);
    return NextResponse.json({ ok: true, transcripts });
  } catch (e) {
    console.error("[api/transcripts]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
