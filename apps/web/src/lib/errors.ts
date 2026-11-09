/** Map raw failures to one short sentence the student can act on. */

const NETWORK =
  "Could not reach the local API. Start it with uvicorn on port 8000, then retry.";

const FRIENDLY: Array<{ test: RegExp; message: string }> = [
  { test: /failed to fetch|networkerror|load failed|fetch/i, message: NETWORK },
  { test: /db_down|database is not running/i, message: "Database is not running. Start it with docker compose up -d." },
  { test: /missing_key|provider key|add a provider key/i, message: "Add a provider API key in Settings before you send." },
  { test: /bad_model|model id is missing/i, message: "Pick a model in Settings. The current profile has none." },
  { test: /bad_protocol/i, message: "That provider protocol is not supported. Use OpenAI-compatible or Gemini." },
  { test: /web mode needs a host|web_search/i, message: "Web mode needs OpenAI search or Gemini. Switch to Notes mode, or change provider." },
  { test: /empty answer|provider returned an empty/i, message: "The provider returned an empty answer. Try again or switch model." },
  { test: /too_long|size cap/i, message: "The answer was too long. Ask a narrower question." },
  { test: /redirected/i, message: "The provider redirected the request. Check the base URL in Settings." },
  { test: /401|unauthorized|invalid.?api.?key/i, message: "The provider rejected the API key. Check it in Settings." },
  { test: /429|rate.?limit/i, message: "The provider rate-limited this key. Wait a moment, then retry." },
  { test: /timeout|timed out/i, message: "The provider timed out. Retry, or try a faster model." },
  { test: /abort/i, message: "Stopped." },
];

export function friendlyError(err: unknown, fallback = "Something went wrong. Try again."): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
  const text = raw.trim();
  if (!text) return fallback;
  for (const rule of FRIENDLY) {
    if (rule.test.test(text)) return rule.message;
  }
  // Strip technical prefixes; keep a short human sentence.
  const cleaned = text.replace(/^Error:\s*/i, "").replace(/\s+/g, " ").trim();
  if (cleaned.length > 180) return `${cleaned.slice(0, 177)}…`;
  return cleaned || fallback;
}

export function composerBlockReason(input: {
  dbDown: boolean;
  hasProvider: boolean;
  hasChat: boolean;
  busy: boolean;
  draftEmpty: boolean;
}): string | null {
  if (input.dbDown) return "Database is down. Start Postgres, then Retry.";
  if (!input.hasProvider) return "Add a provider in Settings to send.";
  if (!input.hasChat) return "Open or create a chat first.";
  if (input.busy) return "Wait for this turn to finish, or Stop.";
  if (input.draftEmpty) return "Type a question to send.";
  return null;
}
