import type { Protocol } from "../vault";

export type ProviderPreset = {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl: string;
  models: string[];
  embeddingModel?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai_chat",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o", "o4-mini"],
    embeddingModel: "text-embedding-3-small",
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai_chat",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
  },
  {
    id: "gemini",
    label: "Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    embeddingModel: "text-embedding-004",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    protocol: "openai_chat",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["llama3.2", "mistral", "qwen2.5"],
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    protocol: "openai_chat",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [],
  },
];

export function presetById(id: string): ProviderPreset {
  return PROVIDER_PRESETS.find((item) => item.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}
