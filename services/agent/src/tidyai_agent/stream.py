"""Provider streaming. Two wire protocols. No database.

ponytail: a third protocol (Anthropic's native API, for example) needs code.
A new host that speaks OpenAI chat completions is a settings row, not a change here.
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Mapping
from urllib.parse import quote, urlparse

import httpx

from tidyai_agent.retrieve import EMBEDDING_DIM, ToolAssembler

PROTOCOLS = frozenset({"openai_chat", "gemini"})
_MAX_CHARS = 100_000

_SECRET = re.compile(
    r"(sk-[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z_\-]{10,}|Bearer\s+\S+)",
    re.IGNORECASE,
)


class ProviderError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def redact(text: str) -> str:
    return _SECRET.sub("redacted", text)


def check_base_url(url: str) -> str:
    cleaned = url.strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ProviderError("bad_base_url", "Base URL must start with http:// or https://.")
    if parsed.username or parsed.password:
        raise ProviderError("bad_base_url", "Base URL must not include a username or password.")
    return cleaned.rstrip("/")


def check_model(model: str) -> str:
    cleaned = model.strip()
    if not cleaned or len(cleaned) > 200 or any(ch in cleaned for ch in "\r\n"):
        raise ProviderError("bad_model", "Model id is missing or not usable.")
    return cleaned


def _openai_text(payload: Mapping) -> str | None:
    error = payload.get("error")
    if isinstance(error, dict):
        detail = error.get("message") or "upstream error"
        raise ProviderError("upstream", redact(str(detail))[:400])
    choices = payload.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return None
    choice = choices[0]
    delta = choice.get("delta")
    if isinstance(delta, dict):
        content = delta.get("content")
        if isinstance(content, str) and content:
            return content
    message = choice.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str) and content:
            return content
        if isinstance(content, list):
            parts = [
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            joined = "".join(parts)
            return joined or None
    return None


def _gemini_text(payload: Mapping) -> str | None:
    error = payload.get("error")
    if isinstance(error, dict):
        detail = error.get("message") or "upstream error"
        raise ProviderError("upstream", redact(str(detail))[:400])
    candidates = payload.get("candidates") or []
    if not candidates or not isinstance(candidates[0], dict):
        return None
    parts = ((candidates[0].get("content") or {}).get("parts") or [])
    texts = [
        part.get("text", "")
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ]
    joined = "".join(texts)
    return joined or None


def text_from_payload(protocol: str, payload: Mapping) -> str | None:
    if protocol == "openai_chat":
        return _openai_text(payload)
    if protocol == "gemini":
        return _gemini_text(payload)
    raise ProviderError("bad_protocol", "Protocol must be openai_chat or gemini.")


def text_from_sse_line(protocol: str, line: str) -> str | None:
    stripped = line.strip()
    if not stripped.startswith("data:"):
        return None
    data = stripped[5:].strip()
    if not data or data == "[DONE]":
        return None
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return text_from_payload(protocol, payload)


def _openai_url(base: str) -> str:
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _gemini_url(base: str, model: str) -> str:
    if ":streamGenerateContent" in base:
        return base
    return f"{base}/models/{quote(model, safe='')}:streamGenerateContent?alt=sse"


def _gemini_body(messages: list[dict]) -> dict:
    system: list[str] = []
    contents: list[dict] = []
    for message in messages:
        role = message["role"]
        content = message.get("content") or ""
        if role == "system":
            if content:
                system.append(content)
            continue
        if role == "tool":
            contents.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "functionResponse": {
                                "name": message.get("name") or "search_notes",
                                "response": {"result": content},
                            }
                        }
                    ],
                }
            )
            continue
        if role == "assistant" and message.get("tool_calls"):
            parts: list[dict] = []
            if content:
                parts.append({"text": content})
            for call in message["tool_calls"]:
                function = call.get("function") or {}
                raw = function.get("arguments") or "{}"
                try:
                    args = json.loads(raw) if isinstance(raw, str) else raw
                except json.JSONDecodeError:
                    args = {"query": raw}
                if not isinstance(args, dict):
                    args = {"query": str(args)}
                parts.append(
                    {
                        "functionCall": {
                            "name": function.get("name") or "search_notes",
                            "args": args,
                        }
                    }
                )
            contents.append({"role": "model", "parts": parts})
            continue
        contents.append(
            {
                "role": "model" if role == "assistant" else "user",
                "parts": [{"text": content}],
            }
        )
    body: dict = {"contents": contents}
    if system:
        body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system)}]}
    return body


def _apply_tools(protocol: str, body: dict, tools: list[dict] | None) -> None:
    if not tools:
        return
    if protocol == "openai_chat":
        body["tools"] = [{"type": "function", "function": tool} for tool in tools]
        body["tool_choice"] = "auto"
        return
    body["tools"] = [
        {
            "functionDeclarations": [
                {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["parameters"],
                }
                for tool in tools
            ]
        }
    ]


def _openai_embed_url(base: str) -> str:
    if base.endswith("/embeddings"):
        return base
    if base.endswith("/chat/completions"):
        return base[: -len("/chat/completions")] + "/embeddings"
    return f"{base}/embeddings"


def _gemini_root(base: str) -> str:
    if "/models/" in base:
        return base.split("/models/")[0]
    return base


async def stream_chat(
    *,
    protocol: str,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    tools: list[dict] | None = None,
    assembler: ToolAssembler | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    web_search: bool = False,
) -> AsyncIterator[str]:
    if protocol not in PROTOCOLS:
        raise ProviderError("bad_protocol", "Protocol must be openai_chat or gemini.")
    if not api_key.strip():
        raise ProviderError("missing_key", "Add a provider key in settings.")
    base = check_base_url(base_url)
    model_id = check_model(model)
    if protocol == "openai_chat":
        url = _openai_url(base)
        headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
        body = {"model": model_id, "messages": messages, "stream": True}
        # A1: Chat Completions search path. Hosts that lack it return 4xx → ProviderError.
        if web_search:
            body["web_search_options"] = {"search_context_size": "medium"}
    else:
        url = _gemini_url(base, model_id)
        headers = {"x-goog-api-key": api_key.strip(), "Content-Type": "application/json"}
        body = _gemini_body(messages)
        if web_search:
            # Gemini Google Search grounding (native tool, not a functionDeclaration).
            body["tools"] = [{"google_search": {}}]
    if not (web_search and protocol == "gemini"):
        _apply_tools(protocol, body, tools)

    timeout = httpx.Timeout(10.0, read=120.0)
    sent = 0
    async with httpx.AsyncClient(timeout=timeout, transport=transport, follow_redirects=False) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    raise ProviderError("upstream", "Provider redirected. The key was not forwarded.")
                if response.status_code >= 400:
                    raw = (await response.aread())[:500].decode("utf-8", "replace")
                    raise ProviderError(
                        "upstream",
                        f"Provider returned {response.status_code}. {redact(raw)[:400]}",
                    )
                content_type = response.headers.get("content-type", "")
                def take(payload: dict) -> str | None:
                    if assembler is not None:
                        assembler.feed(protocol, payload)
                    return text_from_payload(protocol, payload)

                if "text/event-stream" not in content_type:
                    raw = await response.aread()
                    try:
                        payload = json.loads(raw)
                    except json.JSONDecodeError as exc:
                        raise ProviderError("upstream", "Provider did not return a stream or JSON.") from exc
                    if isinstance(payload, dict):
                        piece = take(payload)
                        if piece:
                            yield piece
                    return
                async for line in response.aiter_lines():
                    stripped = line.strip()
                    if not stripped.startswith("data:"):
                        continue
                    data = stripped[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    piece = take(payload)
                    if not piece:
                        continue
                    sent += len(piece)
                    if sent > _MAX_CHARS:
                        raise ProviderError("too_long", "Provider response exceeded the size cap.")
                    yield piece
        except httpx.TimeoutException:
            raise ProviderError("timeout", "Provider timed out.") from None
        except httpx.HTTPError:
            raise ProviderError("upstream", "Could not reach the provider.") from None


async def complete_chat(**kwargs) -> str:
    parts: list[str] = []
    async for piece in stream_chat(**kwargs):
        parts.append(piece)
    return "".join(parts)


def _fit(vector: list) -> list[float] | None:
    if not isinstance(vector, list) or len(vector) != EMBEDDING_DIM:
        return None
    try:
        return [float(value) for value in vector]
    except (TypeError, ValueError):
        return None


async def embed_texts(
    *,
    protocol: str,
    base_url: str,
    api_key: str,
    model: str,
    texts: list[str],
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[list[float] | None]:
    """One embeddings call. A vector that is not 1536 numbers comes back as None."""
    if protocol not in PROTOCOLS:
        raise ProviderError("bad_protocol", "Protocol must be openai_chat or gemini.")
    if not api_key.strip():
        raise ProviderError("missing_key", "Add a provider key in settings.")
    if not texts:
        return []
    base = check_base_url(base_url)
    model_id = check_model(model)
    timeout = httpx.Timeout(10.0, read=60.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport, follow_redirects=False) as client:
            if protocol == "openai_chat":
                return await _embed_openai(client, base, api_key.strip(), model_id, texts)
            return await _embed_gemini(client, base, api_key.strip(), model_id, texts)
    except httpx.TimeoutException:
        raise ProviderError("timeout", "Provider timed out.") from None
    except httpx.HTTPError:
        raise ProviderError("upstream", "Could not reach the provider.") from None


async def _read_json(response: httpx.Response) -> dict:
    if response.status_code in {301, 302, 303, 307, 308}:
        raise ProviderError("upstream", "Provider redirected. The key was not forwarded.")
    # ponytail: 2MB holds a 32-by-1536 embedding body. Error text stays short so a key cannot fill the log.
    raw = (await response.aread())[: 4000 if response.status_code >= 400 else 2_000_000]
    if response.status_code >= 400:
        raise ProviderError(
            "upstream",
            f"Provider returned {response.status_code}. {redact(raw.decode('utf-8', 'replace'))[:400]}",
        )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProviderError("upstream", "Provider did not return JSON.") from exc
    if not isinstance(payload, dict):
        raise ProviderError("upstream", "Provider did not return JSON.")
    return payload


async def _embed_openai(client, base: str, api_key: str, model: str, texts: list[str]) -> list[list[float] | None]:
    url = _openai_embed_url(base)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {"model": model, "input": texts, "dimensions": EMBEDDING_DIM}
    try:
        response = await client.post(url, headers=headers, json=body)
        payload = await _read_json(response)
    except ProviderError:
        response = await client.post(url, headers=headers, json={"model": model, "input": texts})
        payload = await _read_json(response)
    rows = payload.get("data") or []
    ordered: list[list[float] | None] = [None] * len(texts)
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            index = row.get("index")
            if not isinstance(index, int) or not 0 <= index < len(texts):
                continue
            ordered[index] = _fit(row.get("embedding"))
    return ordered


async def _embed_gemini(client, base: str, api_key: str, model: str, texts: list[str]) -> list[list[float] | None]:
    url = f"{_gemini_root(base)}/models/{quote(model, safe='')}:embedContent"
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    ordered: list[list[float] | None] = []
    for text in texts:
        response = await client.post(
            url,
            headers=headers,
            json={
                "content": {"parts": [{"text": text}]},
                "outputDimensionality": EMBEDDING_DIM,
            },
        )
        payload = await _read_json(response)
        values = (payload.get("embedding") or {}).get("values") if isinstance(payload.get("embedding"), dict) else None
        ordered.append(_fit(values))
    return ordered
