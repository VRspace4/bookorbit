export type TtsProviderConfigKey = "azure" | "gcpChirp3" | "xai" | "kokoro";

export const AZURE_TTS_DEFAULT_REGION = "westus2";

export interface TtsProviderConfigEntry {
  enabled: boolean;
  apiKey: string;
}

export interface AzureTtsProviderConfigEntry extends TtsProviderConfigEntry {
  region: string;
}

export interface TtsProviderConfigurations {
  azure: AzureTtsProviderConfigEntry;
  gcpChirp3: TtsProviderConfigEntry;
  xai: TtsProviderConfigEntry;
  kokoro: TtsProviderConfigEntry;
}

export interface TtsProviderStatus {
  key: TtsProviderConfigKey;
  label: string;
  configured: boolean;
  enabled: boolean;
  hint?: string;
}

export interface TtsRuntimeProviderState {
  configured: boolean;
  apiKey?: string;
}

export interface AzureTtsRuntimeProviderState {
  configured: boolean;
  apiKey?: string;
  region?: string;
}

export interface TtsRuntimeConfig {
  azure: AzureTtsRuntimeProviderState;
  gcpChirp3: TtsRuntimeProviderState;
  xai: TtsRuntimeProviderState;
  kokoro: TtsRuntimeProviderState;
}
