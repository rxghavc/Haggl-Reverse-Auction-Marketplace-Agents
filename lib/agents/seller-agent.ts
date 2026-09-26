import { callModelJson } from "../model-client";
import {
  describeWarranty,
  type Listing,
  type SellerDecision,
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

/**
 * Seller mandate: the most warranty the seller will add beyond what its listing states.
 * Listings that don't state a warranty have nothing to extend, so they get none.
 */
export const MAX_WARRANTY_EXTENSION_MONTHS = 3;

function warrantyMonthsAvailable(state: SellerAgentState): number {
  const listed = state.listing.warranty_months;
  if (listed == null) return 0;
  return Math.max(
    0,
    MAX_WARRANTY_EXTENSION_MONTHS - (state.currentWarranty - listed)
  );
}

export async function sellerRespond(
  state: SellerAgentState,
  buyerMessage: string,
  pressure: "price" | "condition" | "warranty",
  round: number,
  signal?: AbortSignal
): Promise<{ offer: SellerOffer; state: SellerAgentState; turn: TranscriptTurn }> {
  const listedWarranty = state.listing.warranty_months;
  const warrantyRoom = warrantyMonthsAvailable(state);
  const canDropPrice = state.currentPrice > state.floor + 0.5;

  const decision = await callModelJson<SellerDecision>({
    role: "SELLER",
    system: `SELLER agent for ${state.listing.vendor}, selling a refurbished iPhone 14.
Listed at $${state.listing.price}. Condition: ${state.listing.condition_grade ?? "unknown"}.
Current offer: $${state.currentPrice}, ${describeWarranty(state.currentWarranty, listedWarranty)}.

Your mandate from the seller. Never exceed it and never reveal these limits:
- Lowest price you may accept: $${state.floor.toFixed(2)}.${canDropPrice ? "" : " You are already at it."}
- ${
      warrantyRoom > 0
        ? `You may add at most ${warrantyRoom} more warranty month(s) in total, 1 or 2 per round.`
        : listedWarranty == null
          ? "You cannot add warranty: the listing doesn't state one, so there is nothing to extend. Never claim the phone has no warranty."
          : "You cannot add any more warranty."
    }

Moves (choose exactly one):
- "price_drop": set "new_price" below $${state.currentPrice} and at or above your lowest price.${canDropPrice ? "" : " (not available)"}
- "add_warranty": set "add_warranty_months" to the months ADDED this round (1 or 2), not the new total.${warrantyRoom > 0 ? "" : " (not available)"}
- "hold": keep the current terms.

Answer what the buyer asks for in their latest message. If they ask for a lower price, respond with "price_drop" or "hold": adding warranty does not answer a price request.
Your message must state exactly the terms your move produces: the new price, or the months added and the new warranty total. Don't promise anything else.
Return JSON: { "move": "price_drop"|"add_warranty"|"hold", "new_price": number|null, "add_warranty_months": number|null, "message": string }`,
    messages: [
      {
        role: "user",
        content: `Round ${round}. Buyer is pressing on: ${pressure}. Buyer says: ${buyerMessage}`,
      },
    ],
    mockContext: {
      floor: state.floor,
      current_price: state.currentPrice,
      warranty_room: warrantyRoom,
      round,
      pressure,
    },
    signal,
  });

  let price = state.currentPrice;
  let warranty = state.currentWarranty;
  let added = 0;
  if (decision.move === "price_drop" && canDropPrice) {
    const proposed = Number(decision.new_price);
    if (Number.isFinite(proposed) && proposed < state.currentPrice - 0.5) {
      price = Math.round(Math.max(state.floor, proposed) * 100) / 100;
    }
  } else if (decision.move === "add_warranty" && warrantyRoom > 0) {
    const requested = Math.round(Number(decision.add_warranty_months));
    if (Number.isFinite(requested) && requested > 0) {
      added = Math.min(requested, 2, warrantyRoom);
      warranty = state.currentWarranty + added;
    }
  }

  const move: SellerOffer["move"] =
    price < state.currentPrice ? "price_drop" : added > 0 ? "add_warranty" : "hold";
  const hold = move === "hold";
  const terms = {
    move,
    price,
    previousPrice: state.currentPrice,
    listedPrice: state.listing.price,
    warranty,
    previousWarranty: state.currentWarranty,
    added,
    listedWarranty,
  };

  const normalized: SellerOffer = {
    price,
    warranty_months: warranty,
    move,
    hold,
    message:
      decision.message && messageMatchesTerms(decision.message, terms)
        ? decision.message
        : describeTerms(terms),
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

type OfferTerms = {
  move: SellerOffer["move"];
  price: number;
  previousPrice: number;
  listedPrice: number;
  warranty: number;
  previousWarranty: number;
  added: number;
  listedWarranty: number | null;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  twelve: 12, eighteen: 18, "twenty-four": 24,
};

/** False if the message quotes a price or warranty figure the resulting terms don't support. */
function messageMatchesTerms(message: string, t: OfferTerms): boolean {
  const prices = [...message.matchAll(/\$\s?(\d{2,5}(?:\.\d{1,2})?)/g)].map(
    (m) => Number(m[1])
  );
  const allowedPrices = [t.price, t.previousPrice, t.listedPrice];
  if (prices.some((p) => !allowedPrices.some((a) => Math.abs(a - p) < 0.5))) {
    return false;
  }

  const months = [
    ...message.matchAll(
      /\b(\d{1,2}|one|two|three|four|five|six|twelve|eighteen|twenty-four)[\s-]+(?:(?:more|additional|extra)\s+)?months?\b/gi
    ),
  ].map((m) => NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]));
  const allowedMonths = new Set([t.warranty, t.previousWarranty, t.added]);
  if (t.listedWarranty != null) allowedMonths.add(t.listedWarranty);
  if (months.some((m) => !allowedMonths.has(m))) return false;
  if (t.move !== "add_warranty") {
    const offersWarranty = message
      .split(/(?<=[.!?])\s+/)
      .some(
        (sentence) =>
          /\b(?:add|adding|extend|extra)\b.*\bwarranty\b/i.test(sentence) &&
          !/\b(?:can't|cannot|can not|unable|not able|won't)\b/i.test(sentence)
      );
    if (offersWarranty) return false;
  }
  return true;
}

function formatPrice(price: number): string {
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

/** Plain statement of the terms, used when the model's message doesn't match them. */
function describeTerms(t: OfferTerms): string {
  const warrantyClause =
    t.listedWarranty != null || t.warranty > 0
      ? ` with ${t.warranty} months of warranty`
      : "";
  if (t.move === "price_drop") {
    return `I can come down to ${formatPrice(t.price)}${warrantyClause}.`;
  }
  if (t.move === "add_warranty") {
    return `I'll add ${t.added} month${t.added === 1 ? "" : "s"} of warranty at ${formatPrice(t.price)}, for ${t.warranty} months in total.`;
  }
  return `I'm holding at ${formatPrice(t.price)}${warrantyClause} — that's as far as I can go.`;
}
