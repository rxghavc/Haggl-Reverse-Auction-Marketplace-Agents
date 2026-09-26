import { dbConfirmNegotiation, dbGetNegotiation } from "@/lib/store";
import { buildConfirmNotice, notifySeller } from "@/lib/wassist";
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

    const existing = await dbGetNegotiation(id);
    const result = await dbConfirmNegotiation(id);
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    if (result.alreadyConfirmed || !existing) {
      return NextResponse.json(result);
    }
    const terms = existing.final_terms;
    const listed = terms.listed_warranty_months;
    const sellerNotice = await notifySeller(
      buildConfirmNotice({
        vendor: typeof terms.vendor === "string" ? terms.vendor : "the seller",
        price: existing.final_price ?? 0,
        listedWarranty: typeof listed === "number" ? listed : null,
        pendingMonths: Number(terms.pending_warranty_months) || 0,
      })
    );
    return NextResponse.json({ ...result, sellerNotice });
  } catch (e) {
    console.error("[api/confirm]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
