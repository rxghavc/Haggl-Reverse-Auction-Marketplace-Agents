import { buildResultCard } from "../result";
import { blindBaseline, scoreOffers, weakestAttribute } from "../scoring";
import { dbInsertOutcome } from "../store";
import type { NegotiationResult, PresetId, ResultCard } from "../types";
import { runBuyerNegotiator } from "./buyer-negotiator";
import { ensureListings } from "./listing-agent";

/** Per-seller budget, leaving headroom under the route's 120s maxDuration. */
const NEGOTIATION_BUDGET_MS = 90_000;

const ENABLED_PRESETS: PresetId[] = [
  "balanced",
  "cheapest",
  "best_condition",
  "longest_warranty",
];

export async function runBuyerOrchestrator(args: {
  preset?: PresetId;
  refreshListings?: boolean;
}): Promise<ResultCard> {
  const preset: PresetId = args.preset ?? "balanced";
  if (!ENABLED_PRESETS.includes(preset)) {
    throw new Error(`Unknown preset: ${preset}`);
  }

  const listings = await ensureListings(Boolean(args.refreshListings));
  if (listings.length < 3) {
    throw new Error("Need 3 vendor listings to negotiate");
  }

  const lowestComparable = Math.min(...listings.map((l) => l.price));
  const blindAsk = blindBaseline(listings);
  const signal = AbortSignal.timeout(NEGOTIATION_BUDGET_MS);

  const settled = await Promise.allSettled(
    listings.map((listing) =>
      runBuyerNegotiator({
        listing,
        peers: listings,
        lowestComparablePrice: lowestComparable,
        pressure: weakestAttribute(listing, listings),
        preset,
        signal,
      })
    )
  );

  const results: NegotiationResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const listing = listings[i];
    const error = s.reason instanceof Error ? s.reason.message : String(s.reason);
    console.warn(`[orchestrator] ${listing.vendor} negotiation rejected: ${error}`);
    return {
      listing,
      negotiationId: "",
      finalPrice: listing.price,
      finalWarrantyMonths: listing.warranty_months ?? 0,
      finalConditionGrade: listing.condition_grade,
      turnCount: 0,
      transcript: [],
      endedReason: "failed",
      error,
    };
  });

  if (results.every((r) => r.endedReason === "failed")) {
    throw new Error(
      `All seller negotiations failed: ${results
        .map((r) => `${r.listing.vendor}: ${r.error}`)
        .join("; ")}`
    );
  }

  const scored = scoreOffers(
    results.map((r) => ({
      listing: r.listing,
      finalPrice: r.finalPrice,
      finalWarrantyMonths: r.finalWarrantyMonths,
      negotiationId: r.negotiationId,
      negotiationFailed: r.endedReason === "failed",
    })),
    preset
  );

  await Promise.all(
    scored.filter((o) => o.negotiationId).map((o) =>
      dbInsertOutcome({
        negotiation_id: o.negotiationId,
        price_score: o.price_score,
        condition_score: o.condition_score,
        warranty_score: o.warranty_score,
        total_utility: o.total_utility,
        is_winner: o.is_winner,
      })
    )
  );

  return buildResultCard({ preset, outcomes: scored, blindAsk });
}
