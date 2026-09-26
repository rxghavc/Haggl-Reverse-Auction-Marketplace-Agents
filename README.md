# Haggl

Haggl is a reverse-auction layer for a purchase you already want. Seller agents compete in parallel on price, condition, and warranty. You see one scored deal, with the listing price next to the negotiated price, and nothing is bought until you confirm.

Live demo: [haggl-app.vercel.app](https://haggl-app.vercel.app)

Built at the [Grok Bot Commerce London Hackathon](https://gb-ecommerce-hackathon-09-2026.teamdeel.workers.dev/hackathon) on 26 September 2026 at Fleek HQ. The brief was agentic commerce: what a storefront looks like when the customer is a bot, whether a bot can negotiate, and how a person authorizes the purchase.

The live run trials one product, a refurbished iPhone 14 128GB Unlocked, with three sellers: Back Market, Reebelo, and Swappa. The product is not a phone app, and it is not limited to three sellers. Point it at any product, with as many listings as you have.

## How it works

1. The listing agent finds real pages for the product and turns each one into a structured record: vendor, price, condition, warranty, source URL.
2. That record is stored in Supabase and mirrored as a Shopify product, so the negotiation sits on a commerce object instead of a scraped blob.
3. A buyer orchestrator starts one negotiation per seller at the same time.
4. Each seller agent can drop its price or hold, above a floor it will not cross.
5. Haggl scores the finished offers under the priority you picked and shows the winner, the reason, and what each seller said.

Run the same listings under two priorities and the winner can change. The result is a tradeoff, not a sort by price.

## The agents

### Listing agent

This is the legibility step. Marketplace pages do not share a schema. Tavily searches for the product, the agent keeps hits that belong to the target sellers, and a model extracts only the fields it can actually read. Missing warranty stays null. It does not guess.

Each accepted listing is written to Supabase and created in Shopify through the Admin API, reusing an existing Shopify product when the same vendor, URL, and price are already there. Later runs reuse those listings until you ask for a refresh.

### Buyer orchestrator

Loads the listings, picks the weakest attribute to pressure for the chosen preset, and runs every seller negotiation with `Promise.allSettled`. One failed seller does not cancel the others. There is a 90 second budget for the run.

### Buyer negotiator

One conversation per seller, up to two rounds. The ask is computed from the other listings and a small step down from the listed price. It is not a free-form model request for a fantasy number. The transcript is saved with the negotiation.

### Seller agent

Isolated from the other sellers. It has the listing, a price floor, and two moves: drop the price, or hold. The model chooses the move. The code commits the price. A message that invents a warranty, or quotes a different price than the one committed, is replaced with the terms the code actually recorded. A hold ends that seller's negotiation.

## What you get

The live run returns one card:

- The winning seller, the price it settled on, and the price it was listed at.
- Condition and warranty. Unknown warranty reads "Warranty not stated", not "0 months".
- A one-line reason for the score.
- Listed price, negotiated price, and what you save against that listing.
- A collapsed transcript for each seller. The winner is marked. On a wide screen the three sit side by side.
- Confirm. That writes the negotiation status to `confirmed`. No payment is taken.

Presets: balanced, cheapest, best condition, longest warranty.

## Clarifications

- Haggl does not decide what to buy. It improves the deal once you know the product.
- The iPhone and the three sellers are the trial we shipped in a day. The same loop applies to another product and another set of sellers.
- Warranty in the score is the warranty on the listing. A seller cannot grant extra months. A request for more coverage can be sent to the seller on WhatsApp through Wassist, and it is not counted unless they approve it.
- If a negotiation fails or times out, Haggl scores that seller on its listed terms and says so. A failed seller can still win when the listing is the better deal.
- Seller agents stay inside a mandate: a floor, a price drop, or a hold. They do not invent facts to win the score.

## Stack

| Piece | Role |
| --- | --- |
| Next.js on Vercel | Product page, live run, and the negotiate and confirm APIs |
| Tavily | Search for the real listing pages |
| Listing agent | Extract structured fields from those pages. Never fill in a missing fact |
| Supabase | Listings, negotiations, transcripts, outcomes |
| Shopify Admin API | Mirror each listing as a product the deal is attached to |
| Buyer and seller agents | Parallel negotiation. OpenAI-compatible model endpoint |
| Wassist | WhatsApp notice to the seller when a deal needs a human check |
| Scoring | Preset weights over price, condition, and listed warranty |

The model is a config change: `MODEL_BASE_URL` and `MODEL_NAME`. The demo uses `openai/gpt-4o-mini` through OpenRouter. Timeouts are not retried. Empty replies and 429 or 5xx responses are retried once. Each seller needs at most two model calls because the buyer ask is computed.

| Path | Role |
| --- | --- |
| `lib/agents/listing-agent.ts` | Tavily search, extraction, Supabase, Shopify |
| `lib/agents/buyer-orchestrator.ts` | Parallel negotiations and the result card |
| `lib/agents/buyer-negotiator.ts` | Up to two rounds per seller |
| `lib/agents/seller-agent.ts` | Drop price or hold, above the floor |
| `lib/scoring.ts` | Preset weights and relative scores |
| `lib/wassist.ts` | Seller notice |

## Partners

Built during Cursor Commerce London, hosted at Fleek HQ by Josh Warwick (Wassist), Tamas Zoltan Palecian (Huge), and Francisco Terpolilli (Cursor).

Haggl uses Cursor, Vercel, Supabase, Shopify, Tavily, and Wassist.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 and choose Live run.

Copy `.env.example` to `.env.local`. With `MOCK_MODE=true`, or with no model configured, the agents return deterministic responses. For a real run:

```
MOCK_MODE=false
MODEL_BASE_URL=https://openrouter.ai/api/v1
MODEL_NAME=openai/gpt-4o-mini
MODEL_API_KEY=...
```

If Supabase returns `permission denied for table …`, run [`scripts/fix-grants.sql`](scripts/fix-grants.sql) in the Supabase SQL editor. Until then the app falls back to a local store.

## API

- `POST /api/negotiate` with `{ "preset": "balanced" | "cheapest" | "best_condition" | "longest_warranty", "refreshListings"?: boolean }`
- `POST /api/confirm` with `{ "negotiationId": string }`. Marks that negotiation `confirmed`.
- `POST /api/listings` refreshes listings only: Tavily, extract, Supabase, Shopify.
- `GET /api/transcripts?ids=` returns the saved buyer and seller turns for a finished run.
