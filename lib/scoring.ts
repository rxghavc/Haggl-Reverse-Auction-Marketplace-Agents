import type {
  Listing,
  PresetId,
  PresetWeights,
  ScoredOutcome,
} from "./types";

export const PRESET_WEIGHTS: Record<PresetId, PresetWeights> = {
  cheapest: { price: 0.7, condition: 0.15, warranty: 0.15 },
  best_condition: { price: 0.2, condition: 0.6, warranty: 0.2 },
  longest_warranty: { price: 0.2, condition: 0.2, warranty: 0.6 },
  balanced: { price: 0.4, condition: 0.3, warranty: 0.3 },
};

/** Early-exit threshold in negotiation loop (0.85 — may rarely hit on clustered sellers). */
export const UTILITY_THRESHOLD = 0.85;

/**
 * Ordinal rank for a condition grade label so peers can be min-max normalized.
 * Shared vocabulary across vendors (Back Market / Reebelo / Swappa).
 */
export function conditionRank(grade: string | null | undefined): number {
  if (!grade) return 1;
  const g = grade.toLowerCase();
  if (g.includes("like new") || g.includes("pristine") || g.includes("flawless")) {
    return 4;
  }
  if (
    g.includes("excellent") ||
    g.includes("premium") ||
    g.includes("certified") ||
    g.includes("very good") ||
    g.includes("very_good")
  ) {
    return 3;
  }
  if (g.includes("good") || g.includes("grade a") || g === "a") {
    return 2;
  }
  if (g.includes("fair") || g.includes("acceptable") || g.includes("grade b")) {
    return 1;
  }
  return 1;
}

/** @deprecated prefer relative condition via scoreOffers; kept for utility estimates */
export function conditionScore(grade: string | null | undefined): number {
  // Absolute map used only as a coarse hint when peers aren't available
  const rank = conditionRank(grade);
  if (rank >= 4) return 1.0;
  if (rank >= 3) return 0.75;
  if (rank >= 2) return 0.5;
  return 0.25;
}

function priceScore(thisPrice: number, prices: number[]): number {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === min) return 1;
  return 1 - (thisPrice - min) / (max - min);
}

function warrantyScore(thisWarranty: number, warranties: number[]): number {
  const max = Math.max(...warranties);
  if (max <= 0) return 0;
  return thisWarranty / max;
}

function conditionRelativeScore(
  thisRank: number,
  ranks: number[]
): number {
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  if (max === min) return 1;
  return (thisRank - min) / (max - min);
}

export type OfferSnapshot = {
  listing: Listing;
  finalPrice: number;
  finalWarrantyMonths: number;
  negotiationId?: string;
  /** Caller must pass listed price/warranty as final terms when this is true */
  negotiationFailed?: boolean;
};

export function scoreOffers(
  offers: OfferSnapshot[],
  preset: PresetId
): ScoredOutcome[] {
  const weights = PRESET_WEIGHTS[preset];
  const prices = offers.map((o) => o.finalPrice);
  const warranties = offers.map((o) => o.finalWarrantyMonths);
  const ranks = offers.map((o) => conditionRank(o.listing.condition_grade));

  const scored = offers.map((o, i) => {
    const price_score = priceScore(o.finalPrice, prices);
    const condition_score = conditionRelativeScore(ranks[i], ranks);
    const warranty_score = warrantyScore(o.finalWarrantyMonths, warranties);
    const total_utility =
      price_score * weights.price +
      condition_score * weights.condition +
      warranty_score * weights.warranty;

    return {
      negotiationId: o.negotiationId ?? "",
      listing: o.listing,
      finalPrice: o.finalPrice,
      finalWarrantyMonths: o.finalWarrantyMonths,
      price_score,
      condition_score,
      warranty_score,
      total_utility,
      is_winner: false,
      negotiation_failed: Boolean(o.negotiationFailed),
    };
  });

  let bestIdx = 0;
  for (let i = 1; i < scored.length; i++) {
    const a = scored[i];
    const b = scored[bestIdx];
    if (
      a.total_utility > b.total_utility + 1e-9 ||
      (Math.abs(a.total_utility - b.total_utility) < 1e-9 &&
        a.finalPrice < b.finalPrice)
    ) {
      bestIdx = i;
    }
  }
  if (scored.length > 0) scored[bestIdx].is_winner = true;
  return scored;
}

/** Average of the 3 original asking prices — credible "casual browse" baseline. */
export function blindBaseline(listings: Listing[]): number {
  if (listings.length === 0) return 0;
  const sum = listings.reduce((acc, l) => acc + l.price, 0);
  return sum / listings.length;
}

/** Weakest attribute for this listing vs peers (opening stats). */
export function weakestAttribute(
  listing: Listing,
  peers: Listing[]
): "price" | "condition" | "warranty" {
  const priceScores = peers.map((p) => -p.price);
  const condScores = peers.map((p) => conditionRank(p.condition_grade));
  const selfIdx = peers.findIndex((p) => p.id === listing.id);
  const rankWorse = (vals: number[], idx: number) => {
    const v = vals[idx];
    return vals.filter((x) => x > v).length;
  };

  const attrs: Array<{
    key: "price" | "condition" | "warranty";
    weakness: number;
  }> = [
    { key: "price", weakness: rankWorse(priceScores, selfIdx) },
    { key: "condition", weakness: rankWorse(condScores, selfIdx) },
  ];
  // Unknown warranty is not "0 months". Pressing it makes agents invent coverage.
  if (listing.warranty_months != null) {
    const warScores = peers.map((p) =>
      p.warranty_months == null ? -1 : p.warranty_months
    );
    attrs.push({ key: "warranty", weakness: rankWorse(warScores, selfIdx) });
  }

  attrs.sort((a, b) => b.weakness - a.weakness);
  return attrs[0].key;
}
