import { runListingAgent } from "@/lib/agents/listing-agent";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  try {
    const listings = await runListingAgent();
    return NextResponse.json({ ok: true, count: listings.length, listings });
  } catch (e) {
    console.error("[api/listings]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
