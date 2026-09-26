import { callModelJson } from "../model-client";
import type {
  Listing,
  SellerDecision,
  SellerOffer,
  TranscriptTurn,
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

/** Whole-dollar price at or above the floor, and strictly below the current ask. */
function commitPrice(proposed: number, floor: number, current: number): number | null {
  if (!Number.isFinite(proposed) || proposed >= current - 0.5) return null;
  const bounded = Math.max(floor, proposed);
  const dollars = Math.round(bounded);
  const next = dollars < floor ? Math.ceil(floor) : dollars;
  if (next >= current) return null;
  return next;
}

export async function sellerRespond(
  state: SellerAgentState,
  buyerMessage: string,
  pressure: "price" | "condition" | "warranty",
  round: number,
  signal?: AbortSignal
): Promise<{ offer: SellerOffer; state: SellerAgentState; turn: TranscriptTurn }> {
  const listedWarranty = state.listing.warranty_months;
  const canDropPrice = state.currentPrice > state.floor + 0.5;
  const warrantyFact =
    listedWarranty == null
      ? "The listing does not state a warranty. You cannot add one."
      : `The listing states ${listedWarranty} months of warranty. You cannot add more.`;

  const decision = await callModelJson<SellerDecision>({
    role: "SELLER",
    system: `SELLER agent for ${state.listing.vendor}, selling a refurbished iPhone 14.
Listed at $${Math.round(state.listing.price)}. Condition: ${state.listing.condition_grade ?? "not listed"}.
Current offer: $${Math.round(state.currentPrice)}. ${warrantyFact}

You sell on price only. Never reveal your floor of $${state.floor.toFixed(2)}.${canDropPrice ? "" : " You are already at the floor."}
Moves (choose exactly one):
- "price_drop": set "new_price" to a whole dollar below $${Math.round(state.currentPrice)} and at or above the floor.${canDropPrice ? "" : " (not available)"}
- "hold": keep the current price.

If the buyer asks for warranty, hold or drop the price, and say any extra coverage has to be confirmed by the seller. Do not say you are adding warranty.
Answer the latest message. Quote only the price your move produces.
Return JSON: { "move": "price_drop"|"hold", "new_price": number|null, "add_warranty_months": null, "message": string }`,
    messages: [
      {
        role: "user",
        content: `Round ${round}. Buyer is pressing on: ${pressure}. Buyer says: ${buyerMessage}`,
      },
    ],
    mockContext: {
      floor: state.floor,
      current_price: state.currentPrice,
      warranty_room: 0,
      round,
      pressure,
    },
    signal,
  });

  const rawMessage = decision.message ?? "";
  const messageGrantsWarranty =
    /\b(?:add|adding|extend|extra)\b[^.]*\bwarranty\b/i.test(rawMessage) &&
    !/\b(?:can't|cannot|can not|unable|won't|until|unless|not)\b/i.test(rawMessage);
  const triedWarranty =
    decision.move === "add_warranty" ||
    decision.move === "request_warranty" ||
    Number(decision.add_warranty_months) > 0 ||
    messageGrantsWarranty;
  let price = state.currentPrice;
  if (decision.move === "price_drop" && canDropPrice) {
    const next = commitPrice(Number(decision.new_price), state.floor, state.currentPrice);
    if (next != null) price = next;
  }

  const pending = triedWarranty
    ? Math.min(2, Math.max(1, Math.round(Number(decision.add_warranty_months)) || 1))
    : 0;
  const move: SellerOffer["move"] =
    price < state.currentPrice
      ? "price_drop"
      : pending > 0
        ? "request_warranty"
        : "hold";
  const hold = move === "hold";
  const terms = {
    move,
    price,
    previousPrice: state.currentPrice,
    listedPrice: state.listing.price,
    pending,
    listedWarranty,
  };

  const normalized: SellerOffer = {
    price,
    warranty_months: listedWarranty ?? 0,
    pending_warranty_months: pending,
    move,
    hold,
    warranty_blocked: triedWarranty,
    message:
      decision.message && messageMatchesTerms(decision.message, terms)
        ? decision.message
        : describeTerms(terms),
  };

  const consecutiveHolds = hold ? state.consecutiveHolds + 1 : 0;
  const next: SellerAgentState = {
    ...state,
    currentPrice: normalized.price,
    currentWarranty: listedWarranty ?? 0,
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
  pending: number;
  listedWarranty: number | null;
};

/** False if the message quotes a price the offer doesn't use, or grants warranty. */
function messageMatchesTerms(message: string, t: OfferTerms): boolean {
  const prices = [...message.matchAll(/\$\s?(\d{2,5}(?:\.\d{1,2})?)/g)].map(
    (m) => Number(m[1])
  );
  const allowedPrices = [t.price, t.previousPrice, Math.round(t.listedPrice)];
  if (prices.some((p) => !allowedPrices.some((a) => Math.abs(a - p) < 0.01))) {
    return false;
  }

  const grantsWarranty = message
    .split(/(?<=[.!?])\s+/)
    .some(
      (sentence) =>
        /\b(?:add|adding|extend|extra|included)\b.*\bwarranty\b/i.test(sentence) &&
        !/\b(?:can't|cannot|can not|unable|not able|won't|until|unless|not)\b/i.test(
          sentence
        )
    );
  if (grantsWarranty) return false;

  if (t.pending > 0 && !/\b(confirm|approval|approve|seller)\b/i.test(message)) {
    return false;
  }
  return true;
}

function formatPrice(price: number): string {
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

/** Plain statement of the terms, used when the model's message doesn't match them. */
function describeTerms(t: OfferTerms): string {
  const listed =
    t.listedWarranty == null
      ? "The listing doesn't state a warranty, and I can't add one from here."
      : `The listing warranty stays ${t.listedWarranty} months.`;
  const pending =
    t.pending > 0
      ? ` I've asked the seller to confirm ${t.pending} extra month${t.pending === 1 ? "" : "s"}; that is not part of this offer until they approve it.`
      : "";
  if (t.move === "price_drop") {
    return `I can come down to ${formatPrice(t.price)}. ${listed}${pending}`;
  }
  return `I'm holding at ${formatPrice(t.price)}. ${listed}${pending}`;
}
