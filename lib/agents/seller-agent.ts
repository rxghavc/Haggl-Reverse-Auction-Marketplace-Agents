import { callModelJson } from "../model-client";
import {
  describeWarranty,
  type Listing,
  type SellerOffer,
  type TranscriptTurn,
} from "../types";

export function computeFloor(
  askingPrice: number,
  lowestComparablePrice: number
): number {
  const staleness_adjustment = 0; // locked — no real listing-date signal
  const base_floor =
    askingPrice - (askingPrice - lowestComparablePrice) * 0.5;
  return base_floor - askingPrice * staleness_adjustment;
}

export type SellerAgentState = {
  listing: Listing;
  floor: number;
  currentPrice: number;
  currentWarranty: number;
  lastOffer: SellerOffer | null;
  consecutiveHolds: number;
};

export function createSellerAgent(
  listing: Listing,
  lowestComparablePrice: number
): SellerAgentState {
  return {
    listing,
    floor: computeFloor(listing.price, lowestComparablePrice),
    currentPrice: listing.price,
    currentWarranty: listing.warranty_months ?? 0,
    lastOffer: null,
    consecutiveHolds: 0,
  };
}

export async function sellerRespond(
  state: SellerAgentState,
  buyerMessage: string,
  pressure: "price" | "condition" | "warranty",
  round: number,
  signal?: AbortSignal
): Promise<{ offer: SellerOffer; state: SellerAgentState; turn: TranscriptTurn }> {
  const offer = await callModelJson<SellerOffer>({
    role: "SELLER",
    system: `SELLER digital twin for ${state.listing.vendor}.
You sell a refurbished iPhone 14. Asking $${state.listing.price}.
Floor price $${state.floor.toFixed(2)} — never go below floor.
Condition: ${state.listing.condition_grade ?? "unknown"}.
Current offer: $${state.currentPrice}, ${describeWarranty(state.currentWarranty, state.listing.warranty_months)}.${
      state.listing.warranty_months == null
        ? `\nThe listing doesn't state a warranty: never claim it has none. "warranty_months" counts only months you add.`
        : ""
    }

Concession menu (choose one):
(a) drop price in increments toward floor
(b) add +1 or +2 warranty months at current price instead of dropping
(c) hold firm

Weigh proximity to floor and what the buyer is pressuring on.
Return JSON: { "price": number, "warranty_months": number, "move": "price_drop"|"add_warranty"|"hold", "hold": boolean, "message": string }`,
    messages: [
      {
        role: "user",
        content: `Round ${round}. Buyer pressure: ${pressure}. Buyer says: ${buyerMessage}`,
      },
    ],
    mockContext: {
      asking_price: state.listing.price,
      floor: state.floor,
      current_price: state.currentPrice,
      current_warranty: state.currentWarranty,
      round,
      pressure,
      last_hold: state.consecutiveHolds >= 1,
    },
    signal,
  });

  // Enforce floor
  const price = Math.max(state.floor, Number(offer.price));
  const warranty = Math.max(0, Number(offer.warranty_months));
  const hold =
    Boolean(offer.hold) ||
    (price >= state.currentPrice - 0.5 &&
      warranty <= state.currentWarranty &&
      offer.move === "hold");

  const normalized: SellerOffer = {
    price: Math.round(price * 100) / 100,
    warranty_months: warranty,
    move: hold ? "hold" : offer.move,
    hold,
    message: offer.message || `Offer: $${price} / ${warranty} mo warranty`,
  };

  const consecutiveHolds = hold ? state.consecutiveHolds + 1 : 0;
  const next: SellerAgentState = {
    ...state,
    currentPrice: normalized.price,
    currentWarranty: normalized.warranty_months,
    lastOffer: normalized,
    consecutiveHolds,
  };

  return {
    offer: normalized,
    state: next,
    turn: {
      round,
      role: "seller",
      content: normalized.message,
      offer: normalized,
    },
  };
}
