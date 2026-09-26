import { dbConfirmNegotiation } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      negotiationId?: string;
    };
    const id = body.negotiationId?.trim();
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "negotiationId is required" },
        { status: 400 }
      );
    }

    const result = await dbConfirmNegotiation(id);
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/confirm]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
