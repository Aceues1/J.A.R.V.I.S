export class TtsConfigError extends Error {}
export class TtsRequestError extends Error {}

export interface TtsAudio {
  audio: Uint8Array
  mimeType: string
}

// A provider turns a piece of text into playable audio. Implementations live
// in this directory and are selected by the registry in ./index.ts, so new
// voices/providers can be added without touching the IPC layer or renderer.
export interface TtsProvider {
  /** Stable identifier used for TTS_PROVIDER and status reporting. */
  readonly name: string
  /** Human-readable voice label for status/diagnostics. */
  voiceLabel(): string
  isConfigured(): boolean
  synthesize(text: string): Promise<TtsAudio>
}
