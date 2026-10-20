/**
 * AI provider: OpenAI-compatible endpoint via @ai-sdk/openai-compatible.
 * TANPA SDK resmi openai — hanya AI SDK. Konfigurasi env:
 * - AI_GATEWAY_URL: base URL endpoint OpenAI-compatible (wajib).
 * - AI_GATEWAY_MODEL: id model, default "gpt-4o-mini".
 * URL kosong => ConfigError (route membalas 503 dengan pesan setup).
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const DEFAULT_AI_MODEL = "gpt-4o-mini";

export interface AiProviderConfig {
  baseURL: string;
  model: string;
}

/** Murni: ambil konfigurasi dari getter (testable tanpa process.env). */
export function resolveAiConfig(
  getUrl: (key: string) => string | undefined = (k) => process.env[k],
): AiProviderConfig {
  const baseURL = getUrl("AI_GATEWAY_URL")?.trim();
  if (!baseURL) {
    throw new ConfigError(
      "AI belum dikonfigurasi: set AI_GATEWAY_URL (endpoint OpenAI-compatible) " +
        "dan AI_GATEWAY_MODEL (opsional, default gpt-4o-mini) di .env.",
    );
  }
  return {
    baseURL,
    model: getUrl("AI_GATEWAY_MODEL")?.trim() || DEFAULT_AI_MODEL,
  };
}

/** Model LanguageModel siap pakai untuk generateText. */
export function getAiModel(config: AiProviderConfig = resolveAiConfig()) {
  const provider = createOpenAICompatible({
    name: "ai-gateway",
    baseURL: config.baseURL,
  });
  return provider.chatModel(config.model);
}
