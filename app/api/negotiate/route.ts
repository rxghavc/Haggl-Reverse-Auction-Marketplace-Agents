import { runBuyerOrchestrator } from "@/lib/agents/buyer-orchestrator";
import type { PresetId } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      preset?: PresetId;
      refreshListings?: boolean;
    };

    const result = await runBuyerOrchestrator({
      preset: body.preset ?? "balanced",
      refreshListings: body.refreshListings,
    });

    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[api/negotiate]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
