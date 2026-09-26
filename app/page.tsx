"use client";

import { useState } from "react";
import { describeWarranty, type PresetId, type ResultCard } from "@/lib/types";

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "cheapest", label: "Cheapest" },
  { id: "best_condition", label: "Best Condition" },
  { id: "longest_warranty", label: "Longest Warranty" },
];

export default function Home() {
  const [preset, setPreset] = useState<PresetId>("balanced");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultCard | null>(null);
  const [confirmState, setConfirmState] = useState<
    "idle" | "confirming" | "confirmed"
  >("idle");
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function negotiate() {
    setLoading(true);
    setError(null);
    setResult(null);
    setConfirmState("idle");
    setConfirmError(null);
    try {
      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset, refreshListings: true }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: ResultCard;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.result) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function confirmPurchase() {
    if (!result?.winner.negotiationId) return;
    setConfirmState("confirming");
    setConfirmError(null);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ negotiationId: result.winner.negotiationId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Confirm failed (${res.status})`);
      }
      setConfirmState("confirmed");
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : String(e));
      setConfirmState("idle");
    }
  }

  return (
    <div className="min-h-full bg-stone-100 text-stone-900">
      <main className="mx-auto flex w-full max-w-lg flex-col gap-8 px-6 py-16">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
            Haggl · Reverse auction
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Refurbished iPhone 14 128GB Unlocked
          </h1>
          <p className="text-sm leading-relaxed text-stone-600">
            Three AI seller agents compete for your business in parallel. You
            win on price, condition, and warranty together — and nothing buys
            itself until you confirm.
          </p>
        </header>

        <section className="space-y-3">
          <label className="block text-sm font-medium text-stone-700">
            Preset
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                  preset === p.id
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-300 bg-white hover:border-stone-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={negotiate}
          disabled={loading}
          className="h-12 rounded-md bg-emerald-700 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Negotiating…" : "Negotiate"}
        </button>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {result && (
          <article className="space-y-4 rounded-md border border-stone-300 bg-white p-5 shadow-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">
                Winning deal
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                {result.winner.vendor}
              </h2>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                ${result.winner.price.toFixed(0)}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {result.winner.condition_grade ?? "Condition n/a"} ·{" "}
                {describeWarranty(
                  result.winner.warranty_months,
                  result.winner.listed_warranty_months
                )}
              </p>
            </div>
            <p className="text-sm leading-relaxed text-stone-700">
              {result.reason}
            </p>
            <div className="border-t border-stone-200 pt-3 text-sm text-stone-600">
              Blind browse baseline (avg of 3 asks):{" "}
              <span className="font-medium text-stone-900">
                ${result.blindComparison.blindAsk.toFixed(0)}
              </span>
              {" · "}
              {result.winner.negotiated ? "Negotiated" : "Listed (negotiation failed)"}:{" "}
              <span className="font-medium text-stone-900">
                ${result.blindComparison.negotiatedPrice.toFixed(0)}
              </span>
              {" · "}
              Delta:{" "}
              <span className="font-medium text-emerald-800">
                ${result.blindComparison.savings.toFixed(0)}
              </span>
            </div>
            <a
              href={result.winner.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-emerald-800 underline underline-offset-2"
            >
              View source listing
            </a>
            <div className="space-y-2 border-t border-stone-200 pt-4">
              {!result.winner.negotiated && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Negotiation with {result.winner.vendor} failed. You are
                  confirming its listed price, not a negotiated one.
                </p>
              )}
              {confirmState === "confirmed" ? (
                <div className="flex h-12 items-center justify-center rounded-md border border-emerald-700 bg-emerald-50 text-sm font-semibold text-emerald-800">
                  Confirmed ✓ — {result.winner.vendor} at $
                  {result.winner.price.toFixed(0)}
                  {result.winner.negotiated ? "" : " (listed price)"}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={confirmPurchase}
                  disabled={
                    confirmState === "confirming" ||
                    !result.winner.negotiationId
                  }
                  className="h-12 w-full rounded-md bg-stone-900 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {confirmState === "confirming"
                    ? "Confirming…"
                    : `Confirm Purchase${
                        result.winner.negotiated ? "" : " at Listed Price"
                      } — $${result.winner.price.toFixed(0)}`}
                </button>
              )}
              {!result.winner.negotiationId && (
                <p className="text-xs text-stone-500">
                  This deal has no recorded negotiation, so it can&apos;t be
                  confirmed. Run the negotiation again.
                </p>
              )}
              {confirmError && (
                <p className="text-sm text-red-800">{confirmError}</p>
              )}
              <p className="text-xs text-stone-500">
                Confirming records your authorization only. No payment is
                taken.
              </p>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
