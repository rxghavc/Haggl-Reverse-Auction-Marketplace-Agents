import { dbInsertNegotiation, dbUpdateNegotiation } from "../store";
import type {
  BuyerMessage,
  Listing,
  NegotiationResult,
  PresetId,
  TranscriptTurn,
} from "../types";
import { createSellerAgent, sellerRespond } from "./seller-agent";

const MAX_ROUNDS = 2;

export async function runBuyerNegotiator(args: {
  listing: Listing;
  peers: Listing[];
  lowestComparablePrice: number;
  pressure: "price" | "condition" | "warranty";
  preset: PresetId;
  signal?: AbortSignal;
}): Promise<NegotiationResult> {
  const negRow = await dbInsertNegotiation({
    listing_id: args.listing.id,
    preset: args.preset,
    status: "running",
    turn_count: 0,
    transcript: [],
    final_price: null,
    final_terms: null,
  });
  const negotiationId = negRow.id;

  try {
    return await negotiate(args, negotiationId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[negotiator] ${args.listing.vendor} failed: ${error}`);
    const listedWarranty = args.listing.warranty_months ?? 0;
    await dbUpdateNegotiation(negotiationId, {
      status: "failed",
      final_price: args.listing.price,
      final_terms: {
        warranty_months: listedWarranty,
        listed_warranty_months: args.listing.warranty_months,
        vendor: args.listing.vendor,
        condition_grade: args.listing.condition_grade,
        ended_reason: "failed",
        pressure: args.pressure,
        error,
      },
    }).catch((dbErr) =>
      console.warn("[negotiator] failed to record failure", dbErr)
    );
    return {
      listing: args.listing,
      negotiationId,
      finalPrice: args.listing.price,
      finalWarrantyMonths: listedWarranty,
      finalConditionGrade: args.listing.condition_grade,
      turnCount: 0,
      transcript: [],
      endedReason: "failed",
      error,
    };
  }
}

async function negotiate(
  args: Parameters<typeof runBuyerNegotiator>[0],
  negotiationId: string
): Promise<NegotiationResult> {
  let seller = createSellerAgent(args.listing, args.lowestComparablePrice);
  const transcript: TranscriptTurn[] = [];
  let endedReason: NegotiationResult["endedReason"] = "cap_reached";
  const target = openingAsk(args.listing, args.peers);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const ask = roundAsk(seller.currentPrice, target, round);
    const buyer = composeBuyer({
      listing: args.listing,
      peers: args.peers,
      price: seller.currentPrice,
      ask,
      moved: seller.currentPrice < args.listing.price - 0.5,
    });

    transcript.push({
      round,
      role: "buyer",
      content: buyer.message,
    });

    if (buyer.accept) {
      endedReason = "threshold_met";
      break;
    }

    const { state, turn } = await sellerRespond(
      seller,
      buyer.message,
      buyer.pressure_attribute,
      round,
      args.signal
    );
    seller = state;
    transcript.push(turn);

    if (turn.offer?.move !== "price_drop") {
      endedReason = "floor_hold";
      break;
    }
    if (seller.currentPrice <= ask) {
      endedReason = "threshold_met";
      break;
    }
    if (round === MAX_ROUNDS) {
      endedReason = "cap_reached";
    }
  }

  await dbUpdateNegotiation(negotiationId, {
    status: "completed",
    turn_count: transcript.filter((t) => t.role === "buyer").length,
    transcript,
    final_price: seller.currentPrice,
    final_terms: {
      warranty_months: args.listing.warranty_months ?? 0,
      listed_warranty_months: args.listing.warranty_months,
      pending_warranty_months: seller.lastOffer?.pending_warranty_months ?? 0,
      vendor: args.listing.vendor,
      condition_grade: args.listing.condition_grade,
      ended_reason: endedReason,
      pressure: args.pressure,
    },
  });

  return {
    listing: args.listing,
    negotiationId,
    finalPrice: seller.currentPrice,
    finalWarrantyMonths: args.listing.warranty_months ?? 0,
    finalConditionGrade: args.listing.condition_grade,
    turnCount: transcript.filter((t) => t.role === "buyer").length,
    transcript,
    endedReason,
  };
}

/** One step toward the next-cheapest peer, capped at about 4% so asks stay credible. */
function openingAsk(listing: Listing, peers: Listing[]): number {
  const others = peers.filter((p) => p.id !== listing.id).map((p) => p.price);
  const cheapestOther = others.length ? Math.min(...others) : listing.price;
  const step = Math.max(4, Math.round(listing.price * 0.04));
  const aimed = Math.max(listing.price - step, Math.min(listing.price - 1, cheapestOther));
  return Math.round(Math.min(listing.price - 1, aimed));
}

function peerFacts(listing: Listing, peers: Listing[]): string {
  const others = peers.filter((p) => p.id !== listing.id);
  if (!others.length) return "no other listing";
  return others
    .map((p) => {
      const warranty =
        p.warranty_months == null
          ? "warranty not listed"
          : `${p.warranty_months} mo warranty on the listing`;
      const condition = p.condition_grade ?? "condition not listed";
      return `${p.vendor} at $${Math.round(p.price)} (${condition}, ${warranty})`;
    })
    .join("; ");
}

function roundAsk(price: number, target: number, round: number): number {
  const current = Math.round(price);
  if (round === 1) return target;
  return Math.max(target, current - 4);
}

function composeBuyer(args: {
  listing: Listing;
  peers: Listing[];
  price: number;
  ask: number;
  moved: boolean;
}): BuyerMessage {
  const price = Math.round(args.price);
  const grade = args.listing.condition_grade ?? "not listed";
  const peers = peerFacts(args.listing, args.peers);
  const warranty =
    args.listing.warranty_months == null
      ? "Your listing doesn't state a warranty, so I won't count extra months unless you confirm them with the seller."
      : `I'm only counting the ${args.listing.warranty_months} months of warranty on the listing.`;

  if (args.moved && price <= args.ask) {
    return {
      message: `$${price} lines up with the other listings (${peers}). I'll take this offer.`,
      pressure_attribute: "price",
      accept: true,
    };
  }

  return {
    message: `I'm talking with ${args.listing.vendor}. The other listings are ${peers}. You're at $${price} and the condition is ${grade}. ${warranty} Can you do $${args.ask}?`,
    pressure_attribute: "price",
    accept: false,
  };
}
