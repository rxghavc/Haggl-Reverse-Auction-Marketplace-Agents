import type { PresetId, ResultCard, ScoredOutcome } from "./types";

/**
 * Pure result-card builder. WhatsApp / Wassist can wrap this later
 * without touching negotiation logic.
 */
export function buildResultCard(args: {
  preset: PresetId;
  outcomes: ScoredOutcome[];
  blindAsk: number;
}): ResultCard {
  const winner =
    args.outcomes.find((o) => o.is_winner) ?? args.outcomes[0];
  if (!winner) {
    throw new Error("No outcomes to build result card");
  }

  const reasonParts: string[] = [];
  const w = winner;
  if (w.price_score >= w.condition_score && w.price_score >= w.warranty_score) {
    reasonParts.push(`best price fit under ${args.preset.replace(/_/g, " ")}`);
  } else if (w.condition_score >= w.warranty_score) {
    reasonParts.push("stronger condition relative to peers");
  } else {
    reasonParts.push("stronger warranty relative to peers");
  }
  reasonParts.push(
    `utility ${w.total_utility.toFixed(2)} vs next-best ${
      [...args.outcomes]
        .filter((o) => !o.is_winner)
        .sort((a, b) => b.total_utility - a.total_utility)[0]
        ?.total_utility.toFixed(2) ?? "n/a"
    }`
  );

  const savings = Math.max(0, args.blindAsk - w.finalPrice);

  const failedVendors = args.outcomes
    .filter((o) => o.negotiation_failed)
    .map((o) => o.listing.vendor);
  let reason = `Won on ${reasonParts.join("; ")}.`;
  if (w.negotiation_failed) {
    reason += ` Negotiation with ${w.listing.vendor} failed — this is its listed price, not a negotiated one.`;
  }
  const otherFailed = failedVendors.filter((v) => v !== w.listing.vendor);
  if (otherFailed.length) {
    reason += ` Negotiation failed for ${otherFailed.join(", ")}; scored on listed terms.`;
  }

  return {
    winner: {
      vendor: w.listing.vendor,
      price: w.finalPrice,
      condition_grade: w.listing.condition_grade,
      warranty_months: w.finalWarrantyMonths,
      listed_warranty_months: w.listing.warranty_months,
      source_url: w.listing.source_url,
      negotiated: !w.negotiation_failed,
      negotiationId: w.negotiationId,
    },
    reason,
    failedVendors,
    blindComparison: {
      blindAsk: args.blindAsk,
      negotiatedPrice: w.finalPrice,
      savings,
    },
    outcomes: args.outcomes,
    preset: args.preset,
  };
}
