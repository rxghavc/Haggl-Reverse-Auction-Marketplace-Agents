"use client";

import { useEffect, useState } from "react";
import {
  describeWarranty,
  type NegotiationTranscript,
  type ScoredOutcome,
  type TranscriptTurn,
} from "@/lib/types";

const TURN_REVEAL_MS = 450;

const ENDED_LABELS: Record<string, string> = {
  threshold_met: "Deal reached",
  floor_hold: "Seller held firm",
  cap_reached: "Round limit reached",
  failed: "Negotiation failed",
};

export function TranscriptPanels({ outcomes }: { outcomes: ScoredOutcome[] }) {
  const [fetched, setFetched] = useState<{
    key: string;
    transcripts: Record<string, NegotiationTranscript>;
    error: string | null;
  } | null>(null);

  const idsKey = outcomes
    .map((o) => o.negotiationId)
    .filter(Boolean)
    .join(",");
  const current = fetched?.key === idsKey ? fetched : null;
  const loading = Boolean(idsKey) && !current;
  const transcripts = current?.transcripts ?? {};
  const loadError = current?.error ?? null;

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    fetch(`/api/transcripts?ids=${encodeURIComponent(idsKey)}`)
      .then((res) => res.json())
      .then((data: { ok: boolean; transcripts?: NegotiationTranscript[]; error?: string }) => {
        if (!data.ok) throw new Error(data.error ?? "Failed to load transcripts");
        if (cancelled) return;
        setFetched({
          key: idsKey,
          transcripts: Object.fromEntries(
            (data.transcripts ?? []).map((t) => [t.id, t])
          ),
          error: null,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setFetched({
          key: idsKey,
          transcripts: {},
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const ordered = [...outcomes].sort((a, b) => b.total_utility - a.total_utility);

  return (
    <section className="space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-stone-500">
        Negotiation transcripts
      </h3>
      {loadError && <p className="text-sm text-red-800">{loadError}</p>}
      {ordered.map((o) => (
        <TranscriptPanel
          key={o.listing.id}
          outcome={o}
          record={transcripts[o.negotiationId]}
          loading={loading}
        />
      ))}
    </section>
  );
}

function TranscriptPanel({
  outcome,
  record,
  loading,
}: {
  outcome: ScoredOutcome;
  record: NegotiationTranscript | undefined;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [visibleTurns, setVisibleTurns] = useState(0);
  const vendor = outcome.listing.vendor;
  const endedReason = outcome.negotiation_failed
    ? "failed"
    : record?.endedReason ?? null;
  const turns = record?.transcript ?? [];
  const revealing = open && visibleTurns < turns.length;

  useEffect(() => {
    if (!revealing) return;
    const timer = setTimeout(
      () => setVisibleTurns((n) => n + 1),
      visibleTurns === 0 ? 150 : TURN_REVEAL_MS
    );
    return () => clearTimeout(timer);
  }, [revealing, visibleTurns]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    setVisibleTurns(reduceMotion ? Number.MAX_SAFE_INTEGER : 0);
    setOpen(true);
  }

  return (
    <div className="rounded-md border border-stone-300 bg-white">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {vendor}
            {outcome.is_winner && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                Winner
              </span>
            )}
          </span>
          <span className="block text-xs text-stone-600">
            ${outcome.finalPrice.toFixed(0)} ·{" "}
            {describeWarranty(
              outcome.finalWarrantyMonths,
              outcome.listing.warranty_months
            )}
            {endedReason ? ` · ${ENDED_LABELS[endedReason] ?? endedReason}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs text-stone-500">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-stone-200 px-4 py-3">
          {outcome.negotiation_failed && (
            <p className="text-sm text-amber-900">
              Negotiation failed{record?.error ? `: ${record.error}` : ""}.
              Scored on its listed terms.
            </p>
          )}
          {loading && !record && (
            <p className="text-sm text-stone-500">Loading transcript…</p>
          )}
          {!loading && !record && !outcome.negotiation_failed && (
            <p className="text-sm text-stone-500">No transcript recorded.</p>
          )}
          {turns.slice(0, visibleTurns).map((turn, i) => (
            <TranscriptLine
              key={i}
              turn={turn}
              vendor={vendor}
              listedWarranty={outcome.listing.warranty_months}
            />
          ))}
          {revealing && (
            <p className="px-3 text-xs text-stone-400">
              {turns[visibleTurns].role === "buyer"
                ? "Buyer agent"
                : `${vendor} agent`}{" "}
              is responding…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TranscriptLine({
  turn,
  vendor,
  listedWarranty,
}: {
  turn: TranscriptTurn;
  vendor: string;
  listedWarranty: number | null;
}) {
  const isBuyer = turn.role === "buyer";
  return (
    <div
      className={`turn-in rounded-md px-3 py-2 text-sm ${
        isBuyer ? "bg-stone-100" : "bg-emerald-50"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        Round {turn.round} · {isBuyer ? "Buyer agent" : `${vendor} agent`}
      </p>
      <p className="mt-0.5 leading-relaxed text-stone-800">{turn.content}</p>
      {turn.offer && (
        <p className="mt-1 text-xs font-medium text-emerald-900">
          Offer: ${turn.offer.price.toFixed(0)} ·{" "}
          {describeWarranty(turn.offer.warranty_months, listedWarranty)} ·{" "}
          {turn.offer.move.replace(/_/g, " ")}
        </p>
      )}
    </div>
  );
}
