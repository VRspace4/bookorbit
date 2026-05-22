import type { TtsProvider } from "./reader-settings";

export const TTS_PROVIDERS = [
  "browser",
  "azure",
  "gcp-chirp3",
  "xai",
  "kokoro",
  "gpt-4o-mini-tts",
] as const satisfies readonly TtsProvider[];

export type TtsMonthlyUsage = Record<TtsProvider, number>;

export function emptyTtsMonthlyUsage(): TtsMonthlyUsage {
  return {
    browser: 0,
    azure: 0,
    "gcp-chirp3": 0,
    xai: 0,
    kokoro: 0,
    "gpt-4o-mini-tts": 0,
  };
}
