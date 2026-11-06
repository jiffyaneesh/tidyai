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
        content = message["content"]
        if role == "system":
            system.append(content)
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


async def stream_chat(
    *,
    protocol: str,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    transport: httpx.AsyncBaseTransport | None = None,
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
    else:
        url = _gemini_url(base, model_id)
        headers = {"x-goog-api-key": api_key.strip(), "Content-Type": "application/json"}
        body = _gemini_body(messages)

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
                if "text/event-stream" not in content_type:
                    raw = await response.aread()
                    try:
                        payload = json.loads(raw)
                    except json.JSONDecodeError as exc:
                        raise ProviderError("upstream", "Provider did not return a stream or JSON.") from exc
                    if isinstance(payload, dict):
                        piece = text_from_payload(protocol, payload)
                        if piece:
                            yield piece
                    return
                async for line in response.aiter_lines():
                    piece = text_from_sse_line(protocol, line)
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
