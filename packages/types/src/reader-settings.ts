export type ReaderFormatGroup = "epub" | "pdf" | "cbx" | "audio";
export type TtsProvider = "browser" | "azure" | "gcp-chirp3" | "xai" | "kokoro" | "gpt-4o-mini-tts";

// Formats the reader can actually open. Used to show/hide Read/Open buttons.
export const READER_OPENABLE_FORMATS = new Set([
  // epub reader (foliate)
  "epub",
  "mobi",
  "azw3",
  "azw",
  "fb2",
  // pdf reader
  "pdf",
  // comic reader
  "cbz",
  "cbr",
  "cb7",
  // audio reader
  "m4b",
  "mp3",
  "m4a",
  "opus",
  "ogg",
  "flac",
]);

export const FORMAT_TO_GROUP: Record<string, ReaderFormatGroup> = {
  epub: "epub",
  mobi: "epub",
  azw3: "epub",
  azw: "epub",
  fb2: "epub",
  txt: "epub",
  pdf: "pdf",
  cbx: "cbx",
  cbz: "cbx",
  cbr: "cbx",
  cb7: "cbx",
  m4b: "audio",
  mp3: "audio",
  m4a: "audio",
  opus: "audio",
  ogg: "audio",
  flac: "audio",
};

export function getFormatGroup(format: string): ReaderFormatGroup {
  return FORMAT_TO_GROUP[format.toLowerCase()] ?? "epub";
}

export const DEFAULT_TTS_SENTENCE_HIGHLIGHT_COLOR = "#4f6f7d";
export const DEFAULT_TTS_WORD_HIGHLIGHT_COLOR = "#0f4f5f";

export interface ThemeHighlightColors {
  ttsSentenceHighlightColor: string;
  ttsWordHighlightColor: string;
}

export interface EpubReaderSettings {
  themeName: string; // matches one of the reader's built-in theme names
  isDark: boolean;
  fontFamily: string | null; // null = use the book's embedded font
  fontSize: number; // 10-32
  lineHeight: number; // 0.8-3.0
  maxColumnCount: number; // 1-10
  gap: number; // 0-0.5 (column gap as fraction)
  maxInlineSize: number; // 400-1600 (max content width in px)
  maxBlockSize: number; // 600-2400 (max content height in px)
  justify: boolean;
  hyphenate: boolean;
  flow: "paginated" | "scrolled";
  // When false, new books open with the publisher's embedded styles instead of these defaults.
  // Per-book settings always apply regardless of this flag.
  overrideBookFormatting: boolean;
  // In-page footer display mode: 0 = pages, 1 = time remaining + session, 2 = chapter info
  footerDisplayMode: 0 | 1 | 2;
  ttsProvider: TtsProvider;
  ttsVoice: string | null;
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  ttsGcpChirp3Voice: string;
  ttsAzureVoice: string;
  ttsXaiVoice: string;
  ttsKokoroVoice: string;
  ttsGpt4oMiniVoice: string;
  ttsSkipBackSeconds: number;
  ttsSkipForwardSeconds: number;
  /** Per-theme TTS highlight overrides keyed by theme name. */
  themeHighlightColors?: Record<string, ThemeHighlightColors>;
  /** Effective highlight colors for the current theme (derived from theme defaults + overrides). */
  ttsSentenceHighlightColor: string;
  ttsWordHighlightColor: string;
}

export interface PdfReaderSettings {
  scrollMode: "vertical" | "horizontal" | "wrapped" | "page";
  spread: "none" | "odd" | "even";
  zoomMode: "fit-width" | "fit-page" | "custom";
  customScale: number; // 0.25-4.0, used when zoomMode is 'custom'
  rotation: 0 | 90 | 180 | 270;
}

export interface CbxReaderSettings {
  fitMode: "fit-page" | "fit-width" | "fit-height" | "actual";
  viewMode: "single" | "two-page";
  scrollMode: "paginated" | "infinite" | "long-strip";
  direction: "ltr" | "rtl";
  spreadAlignment: "normal" | "shifted";
  forceTwoPage: boolean;
  widePageSingletonMode: "auto" | "disable";
  bgColor: "black" | "gray" | "white";
}

export interface AudioReaderSettings {
  playbackSpeed: number; // 0.5-3.0
  volume: number; // 0.0-1.0
  skipBackSeconds: number;
  skipForwardSeconds: number;
}

export type ReaderSettingsMap = {
  epub: EpubReaderSettings;
  pdf: PdfReaderSettings;
  cbx: CbxReaderSettings;
  audio: AudioReaderSettings;
};

export type ReaderSettings = EpubReaderSettings | PdfReaderSettings | CbxReaderSettings | AudioReaderSettings;

export const EPUB_READER_DEFAULTS: EpubReaderSettings = {
  themeName: "default",
  isDark: false,
  fontFamily: null,
  fontSize: 16,
  lineHeight: 1.5,
  maxColumnCount: 2,
  gap: 0.05,
  maxInlineSize: 720,
  maxBlockSize: 1440,
  justify: true,
  hyphenate: true,
  flow: "paginated",
  overrideBookFormatting: true,
  footerDisplayMode: 0,
  ttsProvider: "kokoro",
  ttsVoice: null,
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsGcpChirp3Voice: "en-US-Chirp3-HD-Kore",
  ttsAzureVoice: "en-US-JennyNeural",
  ttsXaiVoice: "Eve",
  ttsKokoroVoice: "af_bella",
  ttsGpt4oMiniVoice: "coral",
  ttsSkipBackSeconds: 15,
  ttsSkipForwardSeconds: 30,
  ttsSentenceHighlightColor: DEFAULT_TTS_SENTENCE_HIGHLIGHT_COLOR,
  ttsWordHighlightColor: DEFAULT_TTS_WORD_HIGHLIGHT_COLOR,
};

export const PDF_READER_DEFAULTS: PdfReaderSettings = {
  scrollMode: "page",
  spread: "none",
  zoomMode: "fit-page",
  customScale: 1.0,
  rotation: 0,
};

export const CBX_READER_DEFAULTS: CbxReaderSettings = {
  fitMode: "fit-page",
  viewMode: "single",
  scrollMode: "paginated",
  direction: "ltr",
  spreadAlignment: "normal",
  forceTwoPage: false,
  widePageSingletonMode: "auto",
  bgColor: "black",
};

export const AUDIO_READER_DEFAULTS: AudioReaderSettings = {
  playbackSpeed: 1.0,
  volume: 1.0,
  skipBackSeconds: 10,
  skipForwardSeconds: 30,
};

export const READER_GROUP_DEFAULTS: ReaderSettingsMap = {
  epub: EPUB_READER_DEFAULTS,
  pdf: PDF_READER_DEFAULTS,
  cbx: CBX_READER_DEFAULTS,
  audio: AUDIO_READER_DEFAULTS,
};
