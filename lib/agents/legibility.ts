import { callModelJson } from "../model-client";
import { createProductFromListing } from "../shopify";
import {
  dbFindShopifyProductId,
  dbGetLatestListings,
  dbInsertListing,
} from "../store";
import type { Listing, ListingExtract } from "../types";

const TARGET_VENDORS = ["Back Market", "Reebelo", "Swappa"] as const;
const SEARCH_QUERY = "iPhone 14 128GB refurbished unlocked";

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
};

const MOCK_FALLBACKS: Record<
  (typeof TARGET_VENDORS)[number],
  Omit<Listing, "id" | "created_at">
> = {
  "Back Market": {
    vendor: "Back Market",
    source_url: "mock://backmarket/iphone-14-128",
    price: 389,
    condition_grade: "Good",
    warranty_months: 12,
    battery_health: null,
    original_listed_date: new Date().toISOString().slice(0, 10),
    shopify_product_id: null,
  },
  Reebelo: {
    vendor: "Reebelo",
    source_url: "mock://reebelo/iphone-14-128",
    price: 419,
    condition_grade: "Excellent",
    warranty_months: 12,
    battery_health: null,
    original_listed_date: new Date().toISOString().slice(0, 10),
    shopify_product_id: null,
  },
  Swappa: {
    vendor: "Swappa",
    source_url: "mock://swappa/iphone-14-128",
    price: 355,
    condition_grade: "Very Good",
    warranty_months: 0,
    battery_health: null,
    original_listed_date: new Date().toISOString().slice(0, 10),
    shopify_product_id: null,
  },
};

function matchVendor(text: string): (typeof TARGET_VENDORS)[number] | null {
  const t = text.toLowerCase();
  if (t.includes("backmarket") || t.includes("back market")) return "Back Market";
  if (t.includes("reebelo")) return "Reebelo";
  if (t.includes("swappa")) return "Swappa";
  return null;
}

async function tavilySearch(): Promise<TavilyResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    console.warn("[legibility] TAVILY_API_KEY missing — using mock listings");
    return [];
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query: SEARCH_QUERY,
      search_depth: "advanced",
      include_answer: false,
      max_results: 15,
    }),
  });

  if (!res.ok) {
    console.error("[legibility] Tavily error", await res.text());
    return [];
  }

  const data = (await res.json()) as { results?: TavilyResult[] };
  return data.results ?? [];
}

function pickVendorResults(
  results: TavilyResult[]
): Map<(typeof TARGET_VENDORS)[number], TavilyResult> {
  const map = new Map<(typeof TARGET_VENDORS)[number], TavilyResult>();
  for (const r of results) {
    const hay = `${r.title ?? ""} ${r.url ?? ""} ${r.content ?? ""}`;
    const vendor = matchVendor(hay);
    if (!vendor || map.has(vendor)) continue;
    // Discard aggregators / blogs
    const url = (r.url ?? "").toLowerCase();
    if (
      url.includes("refurbme") ||
      url.includes("refurb.me") ||
      url.includes("plug.") ||
      url.includes("wirecutter") ||
      url.includes("reddit.com") ||
      url.includes("youtube.com")
    ) {
      continue;
    }
    map.set(vendor, r);
  }
  return map;
}

async function extractListing(
  vendor: (typeof TARGET_VENDORS)[number],
  result: TavilyResult
): Promise<ListingExtract> {
  const content = result.raw_content ?? result.content ?? "";
  return callModelJson<ListingExtract>({
    role: "EXTRACT",
    system: `EXTRACT listing fields from search snippet. Return JSON only:
{ "vendor": string|null, "price": number|null, "condition_grade": string|null, "warranty_months": number|null, "source_url": string|null }
Return null for any field not confidently found — never guess.`,
    messages: [
      {
        role: "user",
        content: `Vendor hint: ${vendor}\nURL: ${result.url}\nTitle: ${result.title}\nContent:\n${content}`,
      },
    ],
    mockContext: {
      vendor,
      url: result.url ?? `https://example.com/${vendor}`,
      content: `${result.title ?? ""}\n${content}`,
    },
  });
}

export async function runLegibilityAgent(): Promise<Listing[]> {
  const results = await tavilySearch();
  const byVendor = pickVendorResults(results);
  const today = new Date().toISOString().slice(0, 10);
  const listings: Listing[] = [];

  for (const vendor of TARGET_VENDORS) {
    const hit = byVendor.get(vendor);
    let draft: Omit<Listing, "id" | "created_at">;

    if (hit) {
      const extracted = await extractListing(vendor, hit);
      if (
        extracted.vendor == null ||
        extracted.price == null ||
        extracted.source_url == null
      ) {
        draft = {
          ...MOCK_FALLBACKS[vendor],
          original_listed_date: today,
          shopify_product_id: null,
        };
      } else {
        draft = {
          vendor: TARGET_VENDORS.includes(
            extracted.vendor as (typeof TARGET_VENDORS)[number]
          )
            ? (extracted.vendor as (typeof TARGET_VENDORS)[number])
            : vendor,
          source_url: extracted.source_url,
          price: extracted.price,
          condition_grade: extracted.condition_grade,
          warranty_months: extracted.warranty_months,
          battery_health: null,
          original_listed_date: today,
          shopify_product_id: null,
        };
      }
    } else {
      draft = {
        ...MOCK_FALLBACKS[vendor],
        original_listed_date: today,
        shopify_product_id: null,
      };
    }

    let shopifyProductId = await dbFindShopifyProductId(
      draft.vendor,
      draft.source_url,
      draft.price
    );
    if (!shopifyProductId) {
      const shopify = await createProductFromListing(draft);
      if (shopify.error) {
        console.warn(`[shopify] ${vendor}: ${shopify.error}`);
      }
      shopifyProductId = shopify.productId;
    }

    const saved = await dbInsertListing({
      ...draft,
      shopify_product_id: shopifyProductId,
    });
    listings.push(saved);
  }

  return listings;
}

/** Latest one listing per target vendor, or empty if none. */
export async function getLatestListings(): Promise<Listing[]> {
  return dbGetLatestListings([...TARGET_VENDORS]);
}

export async function ensureListings(refresh = false): Promise<Listing[]> {
  if (!refresh) {
    const existing = await getLatestListings();
    if (existing.length === 3) return existing;
  }
  return runLegibilityAgent();
}
