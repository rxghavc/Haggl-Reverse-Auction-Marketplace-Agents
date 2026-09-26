import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { Listing } from "./types";
import { getSupabase } from "./supabase";

const DATA_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join("/tmp", "legibility-agent-data")
    : path.join(process.cwd(), ".data");
const LISTINGS_FILE = path.join(DATA_DIR, "listings.json");
const NEGOTIATIONS_FILE = path.join(DATA_DIR, "negotiations.json");
const OUTCOMES_FILE = path.join(DATA_DIR, "outcomes.json");

type NegotiationRow = {
  id: string;
  listing_id: string;
  preset: string;
  status: string;
  turn_count: number;
  transcript: unknown;
  final_price: number | null;
  final_terms: unknown;
  created_at: string;
  updated_at: string;
};

type OutcomeRow = {
  id: string;
  negotiation_id: string;
  price_score: number;
  condition_score: number;
  warranty_score: number;
  total_utility: number;
  is_winner: boolean;
  created_at: string;
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function isPermissionError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === "42501" ||
    msg.includes("permission denied") ||
    msg.includes("row-level security")
  );
}

export async function dbInsertListing(
  row: Omit<Listing, "id" | "created_at">
): Promise<Listing> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("listings")
      .insert({
        vendor: row.vendor,
        source_url: row.source_url,
        price: row.price,
        condition_grade: row.condition_grade,
        warranty_months: row.warranty_months,
        battery_health: row.battery_health,
        original_listed_date: row.original_listed_date,
        shopify_product_id: row.shopify_product_id,
      })
      .select("*")
      .single();
    if (error) {
      if (!isPermissionError(error)) throw new Error(error.message);
      console.warn("[store] Supabase listings insert denied — using local fallback");
    } else {
      return data as Listing;
    }
  } catch (e) {
    if (!(e instanceof Error && e.message.includes("Missing SUPABASE"))) {
      console.warn("[store] listings insert fallback", e);
    } else {
      throw e;
    }
  }

  const listing: Listing = {
    ...row,
    id: randomUUID(),
    created_at: new Date().toISOString(),
  };
  const all = await readJson<Listing[]>(LISTINGS_FILE, []);
  all.unshift(listing);
  await writeJson(LISTINGS_FILE, all);
  return listing;
}

/** Shopify product already created for this exact listing (vendor + URL + price), if any. */
export async function dbFindShopifyProductId(
  vendor: string,
  sourceUrl: string,
  price: number
): Promise<string | null> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("listings")
      .select("shopify_product_id")
      .eq("vendor", vendor)
      .eq("source_url", sourceUrl)
      .eq("price", price)
      .not("shopify_product_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      if (!isPermissionError(error)) throw new Error(error.message);
    } else {
      return (data?.[0]?.shopify_product_id as string | undefined) ?? null;
    }
  } catch (e) {
    console.warn("[store] shopify product lookup fallback", e);
  }

  const all = await readJson<Listing[]>(LISTINGS_FILE, []);
  return (
    all.find(
      (l) =>
        l.vendor === vendor &&
        l.source_url === sourceUrl &&
        l.price === price &&
        l.shopify_product_id
    )?.shopify_product_id ?? null
  );
}

export async function dbGetLatestListings(
  vendors: string[]
): Promise<Listing[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("listings")
      .select("*")
      .in("vendor", vendors)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      if (!isPermissionError(error)) throw new Error(error.message);
      console.warn("[store] Supabase listings select denied — using local fallback");
    } else if (data && data.length) {
      const rows = data as Listing[];
      const seen = new Set<string>();
      const out: Listing[] = [];
      for (const row of rows) {
        if (seen.has(row.vendor)) continue;
        seen.add(row.vendor);
        out.push(row);
        if (out.length === vendors.length) break;
      }
      return out;
    }
  } catch (e) {
    console.warn("[store] listings select fallback", e);
  }

  const all = await readJson<Listing[]>(LISTINGS_FILE, []);
  const seen = new Set<string>();
  const out: Listing[] = [];
  for (const row of all) {
    if (!vendors.includes(row.vendor) || seen.has(row.vendor)) continue;
    seen.add(row.vendor);
    out.push(row);
    if (out.length === vendors.length) break;
  }
  return out;
}

export async function dbInsertNegotiation(
  row: Omit<NegotiationRow, "id" | "created_at" | "updated_at"> & {
    id?: string;
  }
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("negotiations")
      .insert({
        listing_id: row.listing_id,
        preset: row.preset,
        status: row.status,
        turn_count: row.turn_count,
        transcript: row.transcript,
        final_price: row.final_price,
        final_terms: row.final_terms,
      })
      .select("id")
      .single();
    if (error) {
      if (!isPermissionError(error)) throw new Error(error.message);
      console.warn("[store] negotiations insert denied — local fallback");
    } else {
      return { id: data.id as string };
    }
  } catch (e) {
    console.warn("[store] negotiations insert fallback", e);
  }

  const id = row.id ?? randomUUID();
  const all = await readJson<NegotiationRow[]>(NEGOTIATIONS_FILE, []);
  all.unshift({
    id,
    listing_id: row.listing_id,
    preset: row.preset,
    status: row.status,
    turn_count: row.turn_count,
    transcript: row.transcript,
    final_price: row.final_price,
    final_terms: row.final_terms,
    created_at: now,
    updated_at: now,
  });
  await writeJson(NEGOTIATIONS_FILE, all);
  return { id };
}

export async function dbUpdateNegotiation(
  id: string,
  patch: Partial<NegotiationRow>
): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("negotiations")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      if (!isPermissionError(error)) throw new Error(error.message);
      console.warn("[store] negotiations update denied — local fallback");
    } else {
      return;
    }
  } catch (e) {
    console.warn("[store] negotiations update fallback", e);
  }

  const all = await readJson<NegotiationRow[]>(NEGOTIATIONS_FILE, []);
  const idx = all.findIndex((n) => n.id === id);
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await writeJson(NEGOTIATIONS_FILE, all);
  }
}

const CONFIRMABLE_STATUSES = ["completed", "failed"];

export type ConfirmResult =
  | { ok: true; status: "confirmed"; alreadyConfirmed: boolean }
  | { ok: false; error: string };

/** Human authorization: completed/failed → confirmed. Idempotent on repeat clicks. */
export async function dbConfirmNegotiation(id: string): Promise<ConfirmResult> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("negotiations")
      .update({ status: "confirmed", updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", CONFIRMABLE_STATUSES)
      .select("id");
    if (error) {
      if (!isPermissionError(error)) throw new Error(error.message);
      console.warn("[store] negotiations confirm denied — local fallback");
    } else {
      if (data && data.length) {
        return { ok: true, status: "confirmed", alreadyConfirmed: false };
      }
      const { data: row, error: readErr } = await sb
        .from("negotiations")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);
      return confirmOutcomeFor(row?.status as string | undefined);
    }
  } catch (e) {
    console.warn("[store] negotiations confirm fallback", e);
  }

  const all = await readJson<NegotiationRow[]>(NEGOTIATIONS_FILE, []);
  const idx = all.findIndex((n) => n.id === id);
  if (idx < 0 || !CONFIRMABLE_STATUSES.includes(all[idx].status)) {
    return confirmOutcomeFor(idx < 0 ? undefined : all[idx].status);
  }
  all[idx] = { ...all[idx], status: "confirmed", updated_at: new Date().toISOString() };
  await writeJson(NEGOTIATIONS_FILE, all);
  return { ok: true, status: "confirmed", alreadyConfirmed: false };
}

function confirmOutcomeFor(status: string | undefined): ConfirmResult {
  if (status === "confirmed") {
    return { ok: true, status: "confirmed", alreadyConfirmed: true };
  }
  if (!status) return { ok: false, error: "Negotiation not found" };
  return { ok: false, error: `Negotiation is "${status}" and cannot be confirmed` };
}

export async function dbInsertOutcome(
  row: Omit<OutcomeRow, "id" | "created_at">
): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.from("outcomes").insert({
      negotiation_id: row.negotiation_id,
      price_score: row.price_score,
      condition_score: row.condition_score,
      warranty_score: row.warranty_score,
      total_utility: row.total_utility,
      is_winner: row.is_winner,
    });
    if (error) {
      if (!isPermissionError(error)) throw new Error(error.message);
      console.warn("[store] outcomes insert denied — local fallback");
    } else {
      return;
    }
  } catch (e) {
    console.warn("[store] outcomes insert fallback", e);
  }

  const all = await readJson<OutcomeRow[]>(OUTCOMES_FILE, []);
  all.unshift({
    ...row,
    id: randomUUID(),
    created_at: new Date().toISOString(),
  });
  await writeJson(OUTCOMES_FILE, all);
}
