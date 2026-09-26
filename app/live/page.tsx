"use client";

import { useState } from "react";
import { describeWarranty, type PresetId, type ResultCard } from "@/lib/types";
import { SiteNav } from "../site-nav";
import { TranscriptPanels } from "../transcript-panels";

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "cheapest", label: "Cheapest" },
  { id: "best_condition", label: "Best Condition" },
  { id: "longest_warranty", label: "Longest Warranty" },
];

export default function LiveRun() {
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
        body: JSON.stringify({ preset }),
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

  const winnerOutcome = result?.outcomes.find((o) => o.is_winner);
  const listedPrice = winnerOutcome?.listing.price;
  const priceDropped =
    listedPrice != null && listedPrice - (result?.winner.price ?? 0) > 0.5;

  return (
    <div className="min-h-full text-ink">
      <SiteNav here="live" />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-14">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-10">
          <header className="space-y-3">
            <h1 className="offer-type text-4xl font-medium leading-tight tracking-tight">
              Refurbished iPhone 14 128GB Unlocked
            </h1>
            <p className="max-w-md text-base leading-relaxed text-mute">
              This run trials one product with three sellers. You compare
              price, condition, and warranty, then confirm the deal you want.
            </p>
          </header>

          <section className="space-y-3">
            <label className="block text-sm font-medium text-ink">
              What matters most
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`rounded-md border px-3 py-2.5 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    preset === p.id
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-sheet text-ink hover:border-ink"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          <div className="space-y-3">
            <button
              type="button"
              onClick={negotiate}
              disabled={loading}
              className="h-12 w-full rounded-md bg-accent text-sm font-semibold text-white hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-70"
            >
              {loading ? "Negotiating…" : "Negotiate"}
            </button>
            {loading && (
              <div role="status" aria-live="polite" className="space-y-2">
                <p className="text-sm text-mute">
                  The sellers are answering. This usually takes about 20
                  seconds.
                </p>
                <div className="h-0.5 overflow-hidden bg-line">
                  <div className="negotiate-bar h-full w-1/3 bg-accent" />
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          {result && (
            <article className="space-y-5 border border-l-4 border-line border-l-accent bg-sheet p-6">
              <div>
                <p className="text-sm text-mute">Winning deal</p>
                <h2 className="mt-1 text-lg font-semibold text-ink">
                  {result.winner.vendor}
                </h2>
                <p className="offer-type mt-2 text-5xl font-medium tabular-nums leading-none text-ink">
                  ${result.winner.price.toFixed(0)}
                </p>
                {listedPrice != null && (
                  <p className="mt-3 text-sm text-mute">
                    Listed at ${listedPrice.toFixed(0)}.{" "}
                    {priceDropped
                      ? `Negotiated down to $${result.winner.price.toFixed(0)}.`
                      : "The seller held that price."}
                  </p>
                )}
                <p className="mt-3 text-sm leading-relaxed text-mute">
                  {result.winner.condition_grade ?? "Condition not stated"}
                  <span className="mt-0.5 block">
                    {describeWarranty(
                      result.winner.warranty_months,
                      result.winner.listed_warranty_months
                    )}
                  </span>
                </p>
              </div>
              <p className="text-sm leading-relaxed text-ink">{result.reason}</p>
              <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                <div>
                  <dt className="text-mute">Listed</dt>
                  <dd className="mt-1 font-medium tabular-nums text-ink">
                    ${(listedPrice ?? result.winner.price).toFixed(0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-mute">Negotiated</dt>
                  <dd className="mt-1 font-medium tabular-nums text-ink">
                    ${result.winner.price.toFixed(0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-mute">You save</dt>
                  <dd className="mt-1 font-medium tabular-nums text-accent">
                    $
                    {Math.max(
                      0,
                      (listedPrice ?? result.winner.price) - result.winner.price
                    ).toFixed(0)}
                  </dd>
                </div>
              </dl>
              <a
                href={result.winner.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                View source listing
              </a>
              <div className="space-y-3 border-t border-line pt-4">
                {!result.winner.negotiated && (
                  <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    Negotiation with {result.winner.vendor} failed. You are
                    confirming its listed price, not a negotiated one.
                  </p>
                )}
                {confirmState === "confirmed" ? (
                  <div className="flex h-12 items-center justify-center border border-accent bg-sheet text-sm font-semibold text-accent">
                    Confirmed. {result.winner.vendor} at $
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
                    className="h-12 w-full rounded-md bg-ink text-sm font-semibold text-white hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {confirmState === "confirming"
                      ? "Confirming…"
                      : `Confirm purchase at $${result.winner.price.toFixed(0)}`}
                  </button>
                )}
                {!result.winner.negotiationId && (
                  <p className="text-sm text-mute">
                    This deal has no recorded negotiation, so it can&apos;t be
                    confirmed. Run the negotiation again.
                  </p>
                )}
                {confirmError && (
                  <p className="text-sm text-red-800">{confirmError}</p>
                )}
                <p className="text-sm text-mute">
                  Confirming records your authorization only. No payment is
                  taken.
                </p>
              </div>
            </article>
          )}
        </div>

        {result && <TranscriptPanels outcomes={result.outcomes} />}
      </main>
    </div>
  );
}
