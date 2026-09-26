import { callModelJson } from "../model-client";
import { conditionScore, scoreOffers, UTILITY_THRESHOLD } from "../scoring";
import { dbInsertNegotiation, dbUpdateNegotiation } from "../store";
import {
  describeWarranty,
  type BuyerMessage,
  type Listing,
  type NegotiationResult,
  type PresetId,
  type TranscriptTurn,
} from "../types";
import {
  createSellerAgent,
  sellerRespond,
  type SellerAgentState,
} from "./seller-agent";

const MAX_ROUNDS = 3;

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

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const utility = estimateUtility(
      args.listing,
      seller,
      args.peers,
      args.preset
    );

    const buyer = await callModelJson<BuyerMessage>({
      role: "BUYER",
      system: `BUYER negotiator. Isolated session vs ${args.listing.vendor}.
Preset: ${args.preset}. Open by pressuring: ${args.pressure} (this seller's weakest attribute vs peers).
Max ${MAX_ROUNDS} rounds. If the seller says it can't move on something, switch to what it can move on.
"pressure_attribute" must be the attribute your message asks the seller to improve.
Return JSON: { "message": string, "pressure_attribute": "price"|"condition"|"warranty", "accept": boolean }`,
      messages: [
        {
          role: "user",
          content: `Round ${round}. Current offer $${seller.currentPrice}, ${describeWarranty(seller.currentWarranty, args.listing.warranty_months)}, condition ${args.listing.condition_grade}. Est. utility ${utility.toFixed(3)}. Transcript: ${JSON.stringify(transcript.slice(-4))}`,
        },
      ],
      mockContext: {
        pressure: args.pressure,
        round,
        utility,
      },
      signal: args.signal,
    });

    transcript.push({
      round,
      role: "buyer",
      content: buyer.message,
    });

    if (buyer.accept && utility >= UTILITY_THRESHOLD) {
      endedReason = "threshold_met";
      break;
    }

    const { state, turn } = await sellerRespond(
      seller,
      buyer.message,
      buyer.pressure_attribute ?? args.pressure,
      round,
      args.signal
    );
    seller = state;
    transcript.push(turn);

    if (seller.consecutiveHolds >= 1) {
      endedReason = "floor_hold";
      break;
    }

    const utilAfter = estimateUtility(
      args.listing,
      seller,
      args.peers,
      args.preset
    );
    if (utilAfter >= UTILITY_THRESHOLD) {
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
      warranty_months: seller.currentWarranty,
      condition_grade: args.listing.condition_grade,
      ended_reason: endedReason,
      pressure: args.pressure,
    },
  });

  return {
    listing: args.listing,
    negotiationId,
    finalPrice: seller.currentPrice,
    finalWarrantyMonths: seller.currentWarranty,
    finalConditionGrade: args.listing.condition_grade,
    turnCount: transcript.filter((t) => t.role === "buyer").length,
    transcript,
    endedReason,
  };
}

function estimateUtility(
  listing: Listing,
  seller: SellerAgentState,
  peers: Listing[],
  preset: PresetId
): number {
  const snapshots = peers.map((p) => {
    if (p.id === listing.id) {
      return {
        listing: p,
        finalPrice: seller.currentPrice,
        finalWarrantyMonths: seller.currentWarranty,
      };
    }
    return {
      listing: p,
      finalPrice: p.price,
      finalWarrantyMonths: p.warranty_months ?? 0,
    };
  });
  const scored = scoreOffers(snapshots, preset);
  return (
    scored.find((s) => s.listing.id === listing.id)?.total_utility ??
    conditionScore(listing.condition_grade) * 0.3
  );
}
