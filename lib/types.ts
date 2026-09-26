export type PresetId =
  | "cheapest"
  | "best_condition"
  | "longest_warranty"
  | "balanced";

/** Warranty wording that doesn't claim "0 months" when the listing never stated one. */
export function describeWarranty(
  finalMonths: number,
  listedMonths: number | null
): string {
  if (listedMonths != null) return `${finalMonths} mo warranty`;
  if (finalMonths > 0) {
    return `+${finalMonths} mo warranty added (listed warranty unknown)`;
  }
  return "Warranty not listed";
}

export type PresetWeights = {
  price: number;
  condition: number;
  warranty: number;
};

export type ListingExtract = {
  vendor: string | null;
  price: number | null;
  condition_grade: string | null;
  warranty_months: number | null;
  source_url: string | null;
};

export type Listing = {
  id: string;
  vendor: string;
  source_url: string;
  price: number;
  condition_grade: string | null;
  warranty_months: number | null;
  battery_health: number | null;
  original_listed_date: string | null;
  shopify_product_id: string | null;
  created_at?: string;
};

export type SellerMove = "price_drop" | "add_warranty" | "hold";

/** What the seller model decides; the resulting terms are computed in code. */
export type SellerDecision = {
  move: SellerMove;
  new_price: number | null;
  /** Months added this round, not the new total */
  add_warranty_months: number | null;
  message: string;
};

export type SellerOffer = {
  price: number;
  warranty_months: number;
  move: SellerMove;
  hold: boolean;
  message: string;
};

export type BuyerMessage = {
  message: string;
  pressure_attribute: "price" | "condition" | "warranty";
  accept: boolean;
};

export type TranscriptTurn = {
  round: number;
  role: "buyer" | "seller";
  content: string;
  offer?: SellerOffer;
};

/** Persisted negotiation as read back from the transcript jsonb column */
export type NegotiationTranscript = {
  id: string;
  status: string;
  transcript: TranscriptTurn[];
  endedReason: string | null;
  error: string | null;
};

export type NegotiationResult = {
  listing: Listing;
  negotiationId: string;
  finalPrice: number;
  finalWarrantyMonths: number;
  finalConditionGrade: string | null;
  turnCount: number;
  transcript: TranscriptTurn[];
  endedReason: "floor_hold" | "threshold_met" | "cap_reached" | "failed";
  /** Set when endedReason is "failed"; final terms are then the listed terms */
  error?: string;
};

export type ScoredOutcome = {
  negotiationId: string;
  listing: Listing;
  finalPrice: number;
  finalWarrantyMonths: number;
  price_score: number;
  condition_score: number;
  warranty_score: number;
  total_utility: number;
  is_winner: boolean;
  /** Negotiation did not complete; scored on listed price/warranty with no concessions */
  negotiation_failed: boolean;
};

export type ResultCard = {
  winner: {
    vendor: string;
    price: number;
    condition_grade: string | null;
    warranty_months: number;
    /** Null when the source listing didn't state a warranty; warranty_months is then only seller-added months */
    listed_warranty_months: number | null;
    source_url: string;
    /** False when the winner's negotiation failed and the price is its listed price */
    negotiated: boolean;
    /** Empty when no negotiation row was recorded; such a winner cannot be confirmed */
    negotiationId: string;
  };
  reason: string;
  failedVendors: string[];
  blindComparison: {
    blindAsk: number;
    negotiatedPrice: number;
    savings: number;
  };
  outcomes: ScoredOutcome[];
  preset: PresetId;
};
