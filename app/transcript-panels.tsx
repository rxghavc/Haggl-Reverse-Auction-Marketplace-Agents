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
    <section className="space-y-3">
      <h3 className="text-sm text-mute">What each seller said</h3>
      {loadError && <p className="text-sm text-red-800">{loadError}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {ordered.map((o) => (
        <TranscriptPanel
          key={o.listing.id}
          outcome={o}
          record={transcripts[o.negotiationId]}
          loading={loading}
        />
      ))}
      </div>
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
    <div
      className={`border bg-sheet ${
        outcome.is_winner
          ? "border-line border-l-4 border-l-accent"
          : "border-line"
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            {vendor}
            {outcome.is_winner && (
              <span className="text-xs font-semibold text-accent">Winner</span>
            )}
          </span>
          <span className="mt-0.5 block text-sm text-mute">
            Listed ${outcome.listing.price.toFixed(0)}, now $
            {outcome.finalPrice.toFixed(0)},{" "}
            {describeWarranty(
              outcome.finalWarrantyMonths,
              outcome.listing.warranty_months
            )}
            {endedReason
              ? `, ${ENDED_LABELS[endedReason] ?? endedReason}`
              : ""}
          </span>
        </span>
        <span className="shrink-0 text-sm text-mute">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {outcome.negotiation_failed && (
            <p className="text-sm text-amber-900">
              Negotiation failed{record?.error ? `: ${record.error}` : ""}.
              Scored on its listed terms.
            </p>
          )}
          {loading && !record && (
            <p className="text-sm text-mute">Loading transcript…</p>
          )}
          {!loading && !record && !outcome.negotiation_failed && (
            <p className="text-sm text-mute">No transcript recorded.</p>
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
            <p className="px-3 text-sm text-mute">
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
      className={`turn-in px-3 py-2 text-sm ${
        isBuyer ? "bg-paper" : "bg-accent/8"
      }`}
    >
      <p className="text-xs font-medium text-mute">
        Round {turn.round}, {isBuyer ? "buyer" : vendor}
      </p>
      <p className="mt-1 leading-relaxed text-ink">{turn.content}</p>
      {turn.offer && (
        <p className="mt-1 text-sm font-medium text-accent">
          Offer: ${turn.offer.price.toFixed(0)} ·{" "}
          {describeWarranty(turn.offer.warranty_months, listedWarranty)}
          {(turn.offer.pending_warranty_months ?? 0) > 0
            ? ` · +${turn.offer.pending_warranty_months} mo awaiting seller`
            : ""}
          {" · "}
          {turn.offer.move.replace(/_/g, " ")}
        </p>
      )}
    </div>
  );
}
