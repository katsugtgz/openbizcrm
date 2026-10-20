/**
 * AI provider: OpenAI-compatible endpoint via @ai-sdk/openai-compatible.
 * TANPA SDK resmi openai — hanya AI SDK. Konfigurasi env:
 * - AI_GATEWAY_URL: base URL endpoint OpenAI-compatible (wajib, https
 *   kecuali host lokal/dev).
 * - AI_GATEWAY_MODEL: id model, default "gpt-4o-mini".
 * - AI_GATEWAY_API_KEY: kunci API gateway (opsional, Bearer auth).
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
  apiKey?: string;
}

/** Host yang boleh memakai http (loopback + nama lokal/dev). */
const INSECURE_LOCAL_HOST_RE =
  /^(localhost|127\.0\.0\.1|\[?::1\]?|.*\.(local|localhost|test|example|invalid))$/i;

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
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new ConfigError("AI_GATEWAY_URL tidak valid (bukan URL).");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError("AI_GATEWAY_URL harus berprotokol http/https.");
  }
  if (
    parsed.protocol === "http:" &&
    !INSECURE_LOCAL_HOST_RE.test(parsed.hostname)
  ) {
    throw new ConfigError(
      "AI_GATEWAY_URL memakai http ke host non-lokal — gunakan https " +
        "(http hanya untuk localhost/dev).",
    );
  }
  const apiKey = getUrl("AI_GATEWAY_API_KEY")?.trim() || undefined;
  return {
    baseURL,
    model: getUrl("AI_GATEWAY_MODEL")?.trim() || DEFAULT_AI_MODEL,
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Model LanguageModel siap pakai untuk generateText. */
export function getAiModel(config: AiProviderConfig = resolveAiConfig()) {
  const provider = createOpenAICompatible({
    name: "ai-gateway",
    baseURL: config.baseURL,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  });
  return provider.chatModel(config.model);
}
