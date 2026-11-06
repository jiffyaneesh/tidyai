export type Protocol = "openai_chat" | "gemini";

export type Profile = {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  patchModel: string;
  apiKey: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingKey: string;
};

const STORAGE_KEY = "tidyai.profiles";
const ACTIVE_KEY = "tidyai.activeProfile";
const DB_NAME = "tidyai";
const STORE = "vault";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
}

function idbSet(db: IDBDatabase, key: string, value: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function vaultKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await idbGet(db, "aes");
  if (existing) return existing;
  const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await idbSet(db, "aes", created);
  return created;
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function base64ToBytes(value: string): ArrayBuffer {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

export async function loadProfiles(): Promise<Profile[]> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const stored = JSON.parse(raw) as { iv: string; data: string };
  const key = await vaultKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(stored.iv) },
    key,
    base64ToBytes(stored.data),
  );
  const profiles = JSON.parse(new TextDecoder().decode(plain)) as Profile[];
  if (!Array.isArray(profiles)) return [];
  return profiles.map((profile) => ({
    ...profile,
    patchModel: profile.patchModel ?? "",
    embeddingModel: profile.embeddingModel ?? "",
    embeddingBaseUrl: profile.embeddingBaseUrl ?? "",
    embeddingKey: profile.embeddingKey ?? "",
  }));
}

export async function saveProfiles(profiles: Profile[]): Promise<void> {
  const key = await vaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(profiles)),
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) }),
  );
}

export function loadActiveId(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? "";
}

export function saveActiveId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function profileError(profile: Profile): string {
  if (!profile.label.trim()) return "Name the profile.";
  if (profile.protocol !== "openai_chat" && profile.protocol !== "gemini") {
    return "Protocol must be OpenAI-compatible or Gemini.";
  }
  let url: URL;
  try {
    url = new URL(profile.baseUrl.trim());
  } catch {
    return "Base URL must start with http:// or https://.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Base URL must start with http:// or https://.";
  }
  if (url.username || url.password) return "Base URL must not include a password.";
  if (!profile.model.trim()) return "Model id is required.";
  if (!profile.apiKey.trim()) return "API key is required. A local server can use any placeholder.";
  if (profile.embeddingBaseUrl.trim()) {
    let embedUrl: URL;
    try {
      embedUrl = new URL(profile.embeddingBaseUrl.trim());
    } catch {
      return "Embedding base URL must start with http:// or https://.";
    }
    if (embedUrl.protocol !== "http:" && embedUrl.protocol !== "https:") {
      return "Embedding base URL must start with http:// or https://.";
    }
    if (embedUrl.username || embedUrl.password) return "Embedding base URL must not include a password.";
  }
  return "";
}
