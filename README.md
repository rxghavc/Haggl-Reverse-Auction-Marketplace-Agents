# Haggl

**Haggl is a reverse-auction marketplace layer.** Instead of picking the cheapest listing, three AI seller agents compete for your business in parallel, and you win on price, condition, and warranty together — not just the lowest number.

Live demo: [legibility-agent.vercel.app](https://legibility-agent.vercel.app)

## The problem

Shopping across multiple sellers — refurb electronics, in our case — means either taking the first listing you see, or burning 20 minutes across five tabs comparing price against condition against warranty. Nobody does that math properly, so most people default to "cheapest," even when a slightly pricier option with three extra months of warranty is the objectively better deal.

## What Haggl does

Point it at a product (refurbished iPhone 14 128GB, for the demo). Haggl:

1. **Finds three real listings** — Back Market, Reebelo, Swappa — sourced live via Tavily on every run and normalized into one schema.
2. **Spins up an isolated AI agent for each seller**, with a price floor it won't go below.
3. **Runs a buyer agent against all three simultaneously**, pushing each seller on whatever it's weakest on: price, condition, or warranty.
4. **Scores the outcomes under your priority** — cheapest, best condition, longest warranty, or balanced — and surfaces the winner with a one-line reason.

Run the same three listings through two different presets and the winner changes. That's the proof this isn't a price-sort with extra steps.

## Trust and control

- **Nothing buys itself.** The winning deal needs an explicit **Confirm Purchase** from a human, which moves the negotiation's status to `confirmed`. No payment is taken.
- **Failures are shown, not hidden.** If a seller's negotiation times out or fails, Haggl scores it on its listed terms and labels it as unnegotiated. A failed seller can still win if its listing is genuinely competitive — and the card says so.
- **No invented facts.** If a listing doesn't state a warranty, Haggl says "Warranty not listed" rather than "0 months."

## What it doesn't do

It doesn't discover what to buy — it optimizes the deal once you know. It's scoped to one product category by design: proving the mechanic beats faking breadth in a one-day build.

## How it's built

- **Next.js** app on Vercel; **Supabase** for listings, negotiations, and outcomes; **Shopify** Admin API mirrors each listing as a product.
- **Model-agnostic**: any OpenAI-compatible endpoint. Swapping providers is a config change (`MODEL_BASE_URL`, `MODEL_NAME`). The demo runs `openai/gpt-4o-mini` via OpenRouter for reliability under rate limits.
- **Resilient negotiation**: sellers run in parallel with `Promise.allSettled`, a 20s per-call timeout with one retry, and a 90s budget per run. One failed seller never takes down the other two.

| Path | Role |
| --- | --- |
| `lib/agents/legibility.ts` | Listing agent: Tavily search → LLM extraction → Supabase + Shopify |
| `lib/agents/seller-agent.ts` | Seller agent: concession menu (drop price, add warranty, hold) above its floor |
| `lib/agents/buyer-negotiator.ts` | Buyer agent: up to 3 rounds per seller, pressures the weakest attribute |
| `lib/agents/buyer-orchestrator.ts` | Runs all three negotiations in parallel and scores them |
| `lib/scoring.ts` | Preset weights and relative price / condition / warranty scores |

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000, pick a preset, and press **Negotiate**.

Copy `.env.example` to `.env.local`. With `MOCK_MODE=true` (or no model configured) the agents return deterministic mock responses. For real negotiations set:

```
MOCK_MODE=false
MODEL_BASE_URL=https://openrouter.ai/api/v1
MODEL_NAME=openai/gpt-4o-mini
MODEL_API_KEY=...
```

If Supabase returns `permission denied for table …`, run [`scripts/fix-grants.sql`](scripts/fix-grants.sql) in the Supabase SQL editor. Until then the app falls back to a local store.

## API

- `POST /api/negotiate` — `{ "preset": "balanced" | "cheapest" | "best_condition" | "longest_warranty", "refreshListings"?: boolean }`
- `POST /api/confirm` — `{ "negotiationId": string }`; marks the winning negotiation `confirmed`
- `POST /api/legibility` — refresh listings only (Tavily → extract → Supabase + Shopify)
