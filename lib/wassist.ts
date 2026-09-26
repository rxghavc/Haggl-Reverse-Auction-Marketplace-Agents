import type { SellerNotice } from "./types";

const BASE = "https://backend.wassist.app/api/v1";
const AGENT_NAME = "Haggl Desk";
const NOTICE_TIMEOUT_MS = 6_000;

type WassistConversation = {
  id: string;
  contact?: { phoneNumber?: string | null };
};

type WassistAgent = {
  id: string;
  name?: string;
  connectUrl?: string;
};

/** UK local 07933… becomes 447933… Digits only. */
export function sellerPhoneDigits(): string {
  const raw = (process.env.WASSIST_SELLER_PHONE ?? "07933454109").replace(
    /\D/g,
    ""
  );
  if (raw.startsWith("0")) return `44${raw.slice(1)}`;
  if (raw.startsWith("44")) return raw;
  return `44${raw}`;
}

export function sellerPhoneDisplay(): string {
  const digits = sellerPhoneDigits();
  return digits.startsWith("44") ? `0${digits.slice(2)}` : digits;
}

function phonesMatch(candidate: string | null | undefined, target: string): boolean {
  const left = (candidate ?? "").replace(/\D/g, "");
  const right = target.replace(/\D/g, "");
  if (!left || !right) return false;
  const tail = right.slice(-10);
  return left.endsWith(tail) || right.endsWith(left.slice(-10));
}

function headers(): Record<string, string> | null {
  const key = process.env.WASSIST_API_KEY?.trim();
  if (!key) return null;
  return {
    "X-API-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  return text.replace(/\s+/g, " ").slice(0, 240);
}

let cachedConnectUrl: string | undefined;

async function lookupConnectUrl(
  hdrs: Record<string, string>,
  signal: AbortSignal
): Promise<string | undefined> {
  if (cachedConnectUrl) return cachedConnectUrl;
  const id = process.env.WASSIST_AGENT_ID?.trim();
  if (id) {
    const res = await fetch(`${BASE}/agents/${id}/`, { headers: hdrs, signal });
    if (res.ok) {
      const agent = (await res.json()) as WassistAgent;
      if (agent.connectUrl) {
        cachedConnectUrl = agent.connectUrl;
        return cachedConnectUrl;
      }
    }
  }
  const res = await fetch(`${BASE}/agents/?limit=20`, { headers: hdrs, signal });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { results?: WassistAgent[] };
  const agent = body.results?.find((a) => a.name === AGENT_NAME);
  cachedConnectUrl = agent?.connectUrl;
  return cachedConnectUrl;
}

async function findConversation(
  hdrs: Record<string, string>,
  phone: string,
  signal: AbortSignal
): Promise<WassistConversation | null> {
  const res = await fetch(`${BASE}/conversations/?limit=20`, {
    headers: hdrs,
    signal,
  });
  if (!res.ok) {
    throw new Error(`Wassist conversations ${res.status}: ${await readError(res)}`);
  }
  const body = (await res.json()) as { results?: WassistConversation[] };
  return (
    body.results?.find((c) => phonesMatch(c.contact?.phoneNumber, phone)) ??
    null
  );
}

/**
 * Send a seller-facing WhatsApp via Wassist.
 * Every notice goes to WASSIST_SELLER_PHONE (default 07933454109).
 * Sandbox delivery needs that phone to have opened Haggl Desk once.
 */
export async function notifySeller(text: string): Promise<SellerNotice> {
  const phone = sellerPhoneDisplay();
  const hdrs = headers();
  if (!hdrs) {
    return {
      delivered: false,
      detail: `Seller was not messaged. WASSIST_API_KEY is not set (${phone}).`,
    };
  }

  const signal = AbortSignal.timeout(NOTICE_TIMEOUT_MS);
  try {
    const conversation = await findConversation(hdrs, sellerPhoneDigits(), signal);
    const connectUrl = await lookupConnectUrl(hdrs, signal).catch(() => undefined);
    if (!conversation) {
      return {
        delivered: false,
        connectUrl,
        detail: `No WhatsApp chat with ${phone} yet. Open Haggl Desk once from that phone, then seller checks can be delivered.`,
      };
    }

    const res = await fetch(`${BASE}/conversations/${conversation.id}/messages/`, {
      method: "POST",
      headers: hdrs,
      signal,
      body: JSON.stringify({
        type: "text",
        text: { body: text.slice(0, 1000) },
      }),
    });
    if (!res.ok) {
      return {
        delivered: false,
        connectUrl,
        detail: `WhatsApp to ${phone} was not delivered (${res.status}). ${await readError(res)}`,
      };
    }
    return {
      delivered: true,
      detail: `Sent the seller check to ${phone} on WhatsApp.`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      delivered: false,
      detail: `WhatsApp to ${phone} failed: ${message.slice(0, 180)}`,
    };
  }
}

export function buildDealNotice(args: {
  preset: string;
  winnerVendor: string;
  winnerPrice: number;
  listedWarranty: number | null;
  rows: Array<{
    vendor: string;
    price: number;
    listedWarranty: number | null;
    pendingMonths: number;
    ended: string;
  }>;
}): string {
  const listed =
    args.listedWarranty == null
      ? "not stated on the listing"
      : `${args.listedWarranty} months on the listing`;
  const pending = args.rows.filter((r) => r.pendingMonths > 0);
  const pendingLine = pending.length
    ? pending
        .map(
          (r) =>
            `${r.vendor}'s agent asked you to approve +${r.pendingMonths} month(s) at $${Math.round(r.price)}. That is NOT included until you reply YES.`
        )
        .join(" ")
    : "No extra warranty was promised. Reply YES only if you are adding warranty yourself.";
  const breakdown = args.rows
    .map((r) => {
      const warranty =
        r.listedWarranty == null
          ? "warranty not listed"
          : `${r.listedWarranty} mo listed`;
      return `${r.vendor}: $${Math.round(r.price)}, ${warranty}, ${r.ended.replace(/_/g, " ")}`;
    })
    .join("\n");

  return [
    "Haggl seller check. Every seller notice is routed to this phone.",
    `Winner under ${args.preset.replace(/_/g, " ")}: ${args.winnerVendor} at $${Math.round(args.winnerPrice)}. Warranty: ${listed}.`,
    pendingLine,
    breakdown,
    "Nothing is purchased until the buyer confirms in Haggl. No payment has been taken.",
  ].join("\n");
}

export function buildConfirmNotice(args: {
  vendor: string;
  price: number;
  listedWarranty: number | null;
  pendingMonths: number;
}): string {
  const warranty =
    args.listedWarranty == null
      ? "Warranty was not on the listing, and none was added."
      : `Listed warranty stays ${args.listedWarranty} months. No extra months were added.`;
  const pending =
    args.pendingMonths > 0
      ? ` The agent asked you to approve +${args.pendingMonths} months. Reply YES to approve that, otherwise it is not included.`
      : "";
  return `Buyer confirmed ${args.vendor} at $${Math.round(args.price)} for a refurbished iPhone 14. ${warranty}${pending} No payment was taken.`;
}
