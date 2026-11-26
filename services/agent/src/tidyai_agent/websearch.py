"""Server-side web search for hosts that lack provider-native search. No API key."""

from __future__ import annotations

from urllib.parse import quote, urlparse

import httpx

from tidyai_agent.stream import ProviderError, _egress_transport, check_base_url

# Fixed origins. Query text is a parameter; the host is never user-chosen.
# ponytail: Wikipedia is keyless and works for study. If you need open-web results,
# swap for a keyed search API (Brave/Tavily) behind the same search_web shape.
WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"
MAX_RESULTS = 5
MAX_QUERY = 300
# Wikimedia rejects bare bot UAs; a browser-compatible token is enough for low volume.
_UA = "Mozilla/5.0 (compatible; TidyAI/0.1; +http://127.0.0.1; educational study workspace)"

SEARCH_WEB = {
    "name": "search_web",
    "description": (
        "Search the public web (encyclopedia sources) for current or outside facts. "
        "Use it when the answer needs sources beyond the subject's notes."
    ),
    "parameters": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
}
WEB_TOOLS = [SEARCH_WEB]
WEB_TOOL_HINT = (
    "\n\nYou may call search_web when the question needs current or outside facts. "
    "Use the returned snippets. Do not invent a tool result."
)


def native_web_search(protocol: str, base_url: str) -> bool:
    """True when the host can do search inside the chat request itself."""
    if protocol == "gemini":
        return True
    if protocol != "openai_chat":
        return False
    host = (urlparse(base_url.strip()).hostname or "").lower()
    return host == "api.openai.com" or host.endswith(".openai.com")


def format_web_hits(hits: list[dict[str, str]]) -> str:
    if not hits:
        return "No web results."
    lines = []
    for hit in hits:
        lines.append(f"[{hit.get('title', 'result')}]({hit.get('url', '')})\n{hit.get('snippet', '')}")
    return "\n\n".join(lines)[:8000]


async def search_web(query: str, *, transport: httpx.AsyncBaseTransport | None = None) -> list[dict[str, str]]:
    """Return up to MAX_RESULTS encyclopedia hits. Empty list on soft failure."""
    q = (query or "").strip()[:MAX_QUERY]
    if not q:
        return []
    check_base_url("https://en.wikipedia.org")
    headers = {"User-Agent": _UA, "Accept": "application/json"}
    timeout = httpx.Timeout(10.0, read=20.0)
    transport = _egress_transport(transport)
    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport, follow_redirects=False) as client:
            listed = await client.get(
                WIKI_API,
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": q,
                    "srlimit": MAX_RESULTS,
                    "format": "json",
                    "utf8": 1,
                },
                headers=headers,
            )
            if listed.status_code in {301, 302, 303, 307, 308}:
                raise ProviderError("upstream", "Web search redirected.")
            if listed.status_code >= 400:
                return []
            try:
                rows = ((listed.json().get("query") or {}).get("search") or [])
            except ValueError:
                return []
            hits: list[dict[str, str]] = []
            for row in rows[:MAX_RESULTS]:
                if not isinstance(row, dict):
                    continue
                title = str(row.get("title") or "").strip()
                if not title:
                    continue
                snippet = _strip_markup(str(row.get("snippet") or ""))
                summary = await _wiki_summary(client, title, headers)
                if summary:
                    snippet = summary
                hits.append(
                    {
                        "title": title,
                        "url": f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}",
                        "snippet": snippet,
                    }
                )
            return hits
    except ProviderError:
        raise
    except (httpx.HTTPError, OSError, ValueError):
        return []


async def _wiki_summary(client: httpx.AsyncClient, title: str, headers: dict[str, str]) -> str:
    try:
        response = await client.get(WIKI_SUMMARY + quote(title, safe=""), headers=headers)
    except (httpx.HTTPError, OSError):
        return ""
    if response.status_code >= 400:
        return ""
    try:
        data = response.json()
    except ValueError:
        return ""
    if not isinstance(data, dict):
        return ""
    return str(data.get("extract") or "").strip()[:1200]


def _strip_markup(text: str) -> str:
    # Search snippets may include <span class="searchmatch">…</span>.
    out = []
    i = 0
    while i < len(text):
        if text[i] == "<":
            end = text.find(">", i)
            i = len(text) if end < 0 else end + 1
            continue
        out.append(text[i])
        i += 1
    return "".join(out).strip()
