// Same-origin path. Vite proxies it in dev; a reverse proxy does in production.
const API = "/api";
const CSRF = { "X-Tidyai-Csrf": "1" };
export const UNAUTHORIZED_EVENT = "tidyai:unauthorized";

export type Project = { id: string; title: string; rootPageId?: string };
export type Chat = { id: string; projectId: string; title: string };
export type Message = { id: string; role: "user" | "assistant"; content: string };
export type NotePage = {
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  position: number;
  blocks?: Block[];
};
export type Block = {
  id: string;
  pageId: string;
  position: number;
  type: string;
  payload: Record<string, unknown>;
  version: number;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function readError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
    detail?: string | { msg?: string }[];
  } | null;
  const message =
    body?.message ?? (typeof body?.detail === "string" ? body.detail : `Request failed (${response.status}).`);
  if (response.status === 401 && body?.code === "unauthenticated") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return new ApiError(message, response.status, body?.code ?? "");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...CSRF, ...init?.headers },
  });
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function post<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  return request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

export type User = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  hasPassword: boolean;
  providers: string[];
  createdAt: string;
};
export type AuthConfig = { googleEnabled: boolean; passwordMin: number; passwordMax: number };
export type SessionInfo = {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent?: string;
  ip?: string;
};

export const auth = {
  config: () => request<AuthConfig>("/v1/auth/config"),
  me: () => request<User>("/v1/me"),
  signup: (email: string, password: string, displayName: string) =>
    post<{ ok: boolean }>("/v1/auth/signup", { email, password, displayName }),
  verify: (token: string) => post<User>("/v1/auth/verify", { token }),
  resend: (email: string) => post<{ ok: boolean }>("/v1/auth/resend-verification", { email }),
  login: (email: string, password: string) => post<User>("/v1/auth/login", { email, password }),
  logout: () => post<void>("/v1/auth/logout"),
  forgot: (email: string) => post<{ ok: boolean }>("/v1/auth/forgot", { email }),
  reset: (token: string, password: string) => post<void>("/v1/auth/reset", { token, password }),
  googleStart: (next: string) => `${API}/v1/auth/google/start?next=${encodeURIComponent(next)}`,
};

export const account = {
  update: (displayName: string) => post<User>("/v1/me", { displayName }, "PATCH"),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<void>("/v1/me/password", { currentPassword, newPassword }),
  sessions: () => request<SessionInfo[]>("/v1/me/sessions"),
  revokeSession: (id: string) => post<void>(`/v1/me/sessions/${encodeURIComponent(id)}`, undefined, "DELETE"),
  revokeOthers: () => post<{ revoked: number }>("/v1/me/sessions/revoke-others"),
  remove: (confirmEmail: string, password: string) => post<void>("/v1/me", { confirmEmail, password }, "DELETE"),
};

export function health(): Promise<{ status: string; db: string }> {
  return request("/health");
}

export function listProjects(): Promise<Project[]> {
  return request("/v1/projects");
}

export function createProject(title: string): Promise<Project> {
  return request("/v1/projects", { method: "POST", body: JSON.stringify({ title }) });
}

export function listChats(projectId: string): Promise<Chat[]> {
  return request(`/v1/projects/${projectId}/chats`);
}

export function createChat(projectId: string): Promise<Chat> {
  return request(`/v1/projects/${projectId}/chats`, {
    method: "POST",
    body: JSON.stringify({ title: "Untitled chat" }),
  });
}

export function renameChat(chatId: string, title: string): Promise<Chat> {
  return request(`/v1/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function listMessages(chatId: string): Promise<Message[]> {
  return request(`/v1/chats/${chatId}/messages`);
}

export function listPages(projectId: string): Promise<NotePage[]> {
  return request(`/v1/projects/${projectId}/pages`);
}

export function getPage(projectId: string, pageId: string): Promise<NotePage> {
  return request(`/v1/projects/${projectId}/pages/${pageId}`);
}

export function patchBlock(block: Block, payload: Record<string, unknown>): Promise<Block> {
  return request(`/v1/blocks/${block.id}`, {
    method: "PATCH",
    body: JSON.stringify({ version: block.version, payload }),
  });
}

export function putPageBlocks(
  projectId: string,
  pageId: string,
  blocks: { id: string; type: string; payload: Record<string, unknown> }[],
): Promise<Block[]> {
  return request(`/v1/projects/${projectId}/pages/${pageId}/blocks`, {
    method: "PUT",
    body: JSON.stringify({ blocks }),
  });
}

export type TurnEvent = { event: string; data: string };

export async function streamTurn(
  chatId: string,
  body: {
    text: string;
    protocol: string;
    baseUrl: string;
    model: string;
    patchModel: string;
    pageId: string;
    embeddingModel: string;
    embeddingBaseUrl: string;
    mode: "notes" | "web";
  },
  apiKey: string,
  onEvent: (event: TurnEvent) => void,
  signal: AbortSignal,
  embeddingKey = "",
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...CSRF, "X-Provider-Key": apiKey };
  if (embeddingKey) headers["X-Embedding-Key"] = embeddingKey;
  const response = await fetch(`${API}/v1/chats/${chatId}/turns`, {
    method: "POST",
    signal,
    credentials: "same-origin",
    headers,
    body: JSON.stringify({
      text: body.text,
      protocol: body.protocol,
      baseUrl: body.baseUrl,
      model: body.model,
      patchModel: body.patchModel || null,
      pageId: body.pageId,
      embeddingModel: body.embeddingModel || null,
      embeddingBaseUrl: body.embeddingBaseUrl || null,
      mode: body.mode,
    }),
  });
  if (!response.ok || !response.body) throw await readError(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    buffer += decoder.decode(step.value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      onEvent(parseEvent(buffer.slice(0, split)));
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
    }
  }
}

function parseEvent(raw: string): TurnEvent {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.join("\n") };
}
