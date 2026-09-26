import type {
  BuyerMessage,
  ListingExtract,
  SellerDecision,
} from "./types";

export type ModelRole = "EXTRACT" | "SELLER" | "BUYER";

export type CallModelArgs = {
  system: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  role: ModelRole;
  json?: boolean;
  /** Extra context for MOCK_MODE deterministic responses */
  mockContext?: Record<string, unknown>;
  /** Aborts the call (including retries) when the caller's budget runs out */
  signal?: AbortSignal;
};

const CALL_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;
/** Opt-in: on reasoning models (e.g. Grok 4.x) this also caps hidden reasoning tokens and can yield empty replies. */
const MAX_OUTPUT_TOKENS = process.env.MODEL_MAX_TOKENS
  ? Number(process.env.MODEL_MAX_TOKENS)
  : undefined;

const MAX_RETRY_DELAY_MS = 3_000;

/** Failures worth a second attempt: empty replies, network errors, 429/5xx. Timeouts are not retried. */
class RetryableModelError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 0
  ) {
    super(message);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

function isMockMode(): boolean {
  const flag = (process.env.MOCK_MODE ?? "true").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") {
    // Still mock if no provider configured
    const base = (process.env.MODEL_BASE_URL ?? "").trim();
    const key = (process.env.MODEL_API_KEY ?? "").trim();
    if (!base || !key) return true;
    return false;
  }
  return true;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model response was not valid JSON");
  }
}

function mockExtract(ctx?: Record<string, unknown>): ListingExtract {
  const vendor = String(ctx?.vendor ?? "Back Market");
  const url = String(ctx?.url ?? "https://www.backmarket.com/en-us/iphone-14");
  const content = String(ctx?.content ?? "").toLowerCase();

  const priceMatch = content.match(/\$?\s*([0-9]{3,4}(?:\.[0-9]{2})?)/);
  let price: number | null = priceMatch ? Number(priceMatch[1]) : null;

  const defaults: Record<string, { price: number; grade: string; warranty: number }> = {
    "Back Market": { price: 389, grade: "Good", warranty: 12 },
    Reebelo: { price: 419, grade: "Excellent", warranty: 12 },
    Swappa: { price: 355, grade: "Very Good", warranty: 0 },
  };
  const d = defaults[vendor] ?? { price: 399, grade: "Good", warranty: 6 };
  if (price == null || price < 150 || price > 1200) price = d.price;

  let grade: string | null = d.grade;
  if (content.includes("excellent") || content.includes("premium")) grade = "Excellent";
  else if (content.includes("very good")) grade = "Very Good";
  else if (content.includes("fair")) grade = "Fair";
  else if (content.includes("good")) grade = "Good";

  let warranty: number | null = d.warranty;
  const wMatch = content.match(/(\d+)\s*(?:-?\s*)?(?:month|mo)\s*warranty/);
  if (wMatch) warranty = Number(wMatch[1]);

  return {
    vendor,
    price,
    condition_grade: grade,
    warranty_months: warranty,
    source_url: url,
  };
}

function mockSeller(ctx?: Record<string, unknown>): SellerDecision {
  const currentPrice = Number(ctx?.current_price ?? 400);
  const floor = Number(ctx?.floor ?? currentPrice * 0.9);
  const round = Number(ctx?.round ?? 1);
  const room = currentPrice - floor;

  const drop = Math.max(4, Math.min(room * (round === 1 ? 0.45 : 0.6), room));
  const next = Math.max(floor, Math.round(currentPrice - drop));
  if (room < 5 || next >= currentPrice - 1) {
    return {
      move: "hold",
      new_price: null,
      add_warranty_months: null,
      message: `That is as low as I can go — $${currentPrice}.`,
    };
  }

  return {
    move: "price_drop",
    new_price: next,
    add_warranty_months: null,
    message: `I can come down to $${next}.`,
  };
}

function mockBuyer(ctx?: Record<string, unknown>): BuyerMessage {
  const pressure = (ctx?.pressure as BuyerMessage["pressure_attribute"]) ?? "price";
  const round = Number(ctx?.round ?? 1);
  const utility = Number(ctx?.utility ?? 0);
  const accept = utility >= 0.85 || round >= 3;

  const lines: Record<typeof pressure, string> = {
    price: `Your price is high versus peers. Round ${round}: can you move closer to market?`,
    condition: `Condition is weaker than alternatives. Can you improve terms or price to compensate?`,
    warranty: `Warranty coverage lags the others. Can you extend warranty or drop price?`,
  };

  return {
    message: accept
      ? `That works for me given the tradeoffs — I'll take this offer.`
      : lines[pressure],
    pressure_attribute: pressure,
    accept,
  };
}

function mockResponse(role: ModelRole, ctx?: Record<string, unknown>): string {
  if (role === "EXTRACT") return JSON.stringify(mockExtract(ctx));
  if (role === "SELLER") return JSON.stringify(mockSeller(ctx));
  return JSON.stringify(mockBuyer(ctx));
}

export async function callModel(args: CallModelArgs): Promise<string> {
  if (isMockMode()) {
    return mockResponse(args.role, args.mockContext);
  }

  const base = process.env.MODEL_BASE_URL?.trim();
  const key = process.env.MODEL_API_KEY?.trim();
  const model = process.env.MODEL_NAME?.trim() || "gpt-4o-mini";

  if (!base || !key) {
    throw new Error(
      "MOCK_MODE=false but MODEL_BASE_URL / MODEL_API_KEY are missing"
    );
  }

  const url = `${base.replace(/\/$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model,
    temperature: 0.3,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: args.json ? { type: "json_object" } : undefined,
    messages: [
      { role: "system", content: `[${args.role}]\n${args.system}` },
      ...args.messages,
    ],
  });

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    args.signal?.throwIfAborted();
    try {
      return await callOnce(url, key, body, args.signal);
    } catch (e) {
      if (!(e instanceof RetryableModelError)) throw e;
      lastError = e;
      console.warn(
        `[model] ${args.role} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message.slice(0, 160)}`
      );
      if (attempt < MAX_ATTEMPTS && e.retryAfterMs > 0) {
        await sleep(e.retryAfterMs, args.signal);
      }
    }
  }
  throw lastError ?? new Error("Model call failed");
}

async function callOnce(
  url: string,
  key: string,
  body: string,
  outer?: AbortSignal
): Promise<string> {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body,
      signal,
    });
    text = await res.text();
  } catch (e) {
    if (outer?.aborted) throw outer.reason ?? e;
    if (timeout.aborted) {
      throw new Error(`timed out after ${CALL_TIMEOUT_MS}ms`);
    }
    throw new RetryableModelError(
      `network error: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!res.ok) {
    const msg = `Model API error ${res.status}: ${text.slice(0, 400)}`;
    if (res.status === 429) {
      const retryAfterSec = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : MAX_RETRY_DELAY_MS;
      throw new RetryableModelError(msg, Math.min(delay, MAX_RETRY_DELAY_MS));
    }
    if (res.status >= 500) {
      throw new RetryableModelError(msg, 500);
    }
    throw new Error(msg);
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new RetryableModelError("unparseable API response body");
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new RetryableModelError("empty model response");
  return content;
}

export async function callModelJson<T>(args: CallModelArgs): Promise<T> {
  const text = await callModel({ ...args, json: true });
  return extractJson(text) as T;
}
