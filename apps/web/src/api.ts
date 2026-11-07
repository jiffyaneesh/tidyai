const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

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

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    detail?: string | { msg?: string }[];
  } | null;
  if (body?.message) return body.message;
  if (typeof body?.detail === "string") return body.detail;
  return `Request failed (${response.status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

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
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Provider-Key": apiKey };
  if (embeddingKey) headers["X-Embedding-Key"] = embeddingKey;
  const response = await fetch(`${API}/v1/chats/${chatId}/turns`, {
    method: "POST",
    signal,
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
  if (!response.ok || !response.body) throw new Error(await readError(response));
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
