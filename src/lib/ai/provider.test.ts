import { describe, it, expect } from "vitest";
import {
  ConfigError,
  DEFAULT_AI_MODEL,
  getAiModel,
  resolveAiConfig,
} from "./provider";

describe("ai provider config (pure)", () => {
  it("URL kosong => ConfigError", () => {
    expect(() => resolveAiConfig(() => undefined)).toThrow(ConfigError);
    expect(() => resolveAiConfig(() => "")).toThrow(ConfigError);
    expect(() => resolveAiConfig(() => "  ")).toThrow(ConfigError);
  });

  it("URL terisi => model default gpt-4o-mini", () => {
    const c = resolveAiConfig((k) =>
      k === "AI_GATEWAY_URL" ? "http://gw.local/v1" : undefined,
    );
    expect(c).toEqual({
      baseURL: "http://gw.local/v1",
      model: DEFAULT_AI_MODEL,
    });
    expect(DEFAULT_AI_MODEL).toBe("gpt-4o-mini");
  });

  it("model override dihormati", () => {
    const c = resolveAiConfig((k) =>
      k === "AI_GATEWAY_URL"
        ? "http://gw.local/v1"
        : k === "AI_GATEWAY_MODEL"
          ? "llama-3"
          : undefined,
    );
    expect(c.model).toBe("llama-3");
  });

  it("getAiModel tanpa konfigurasi melempar ConfigError", () => {
    const prev = process.env.AI_GATEWAY_URL;
    delete process.env.AI_GATEWAY_URL;
    try {
      expect(() => getAiModel()).toThrow(ConfigError);
    } finally {
      if (prev !== undefined) process.env.AI_GATEWAY_URL = prev;
    }
  });
});
