import { contextBridge, ipcRenderer } from 'electron'

const windowControls = {
  minimize: (): void => {
    ipcRenderer.send('window:minimize')
  },
  maximizeToggle: (): void => {
    ipcRenderer.send('window:maximize-toggle')
  },
  close: (): void => {
    ipcRenderer.send('window:close')
  },
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  onStateChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean): void =>
      callback(isMaximized)
    ipcRenderer.on('window:state-changed', listener)
    return () => ipcRenderer.removeListener('window:state-changed', listener)
  }
}

export interface SystemStatus {
  cpuModel: string
  coreCount: number
  cpuUsagePercent: number
  ramTotalGb: number
  ramUsedGb: number
  ramUsedPercent: number
  diskTotalGb: number | null
  diskFreeGb: number | null
  diskUsedPercent: number | null
  uptimeHours: number
  platform: string
}

export type SystemStatusResult = { ok: true; status: SystemStatus } | { ok: false; error: string }

const system = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    node: process.versions.node,
    electron: process.versions.electron
  },
  getStatus: (): Promise<SystemStatusResult> => ipcRenderer.invoke('system:status')
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type PlayerDirective =
  | { kind: 'load'; videoId: string; title?: string }
  | { kind: 'pause' }
  | { kind: 'play' }
  | { kind: 'volume'; value: number }

export interface SearchInfo {
  source: string
  query: string
  /** False when a search was attempted but every source failed. */
  ok: boolean
}

export type ChatSendResult =
  | {
      ok: true
      message: string
      player?: PlayerDirective
      search?: SearchInfo
      /** Short note when a memory action happened this turn (e.g. "Stored …"). */
      memory?: string
    }
  | { ok: false; error: string }

export interface ChatBackendStatus {
  configured: boolean
  model: string
}

const chat = {
  getStatus: (): Promise<ChatBackendStatus> => ipcRenderer.invoke('chat:get-status'),
  sendMessage: (history: ChatTurn[]): Promise<ChatSendResult> =>
    ipcRenderer.invoke('chat:send', { messages: history })
}

export type VoiceTranscribeResult = { ok: true; text: string } | { ok: false; error: string }

export type VoiceSpeakResult =
  { ok: true; audio: Uint8Array; mimeType: string } | { ok: false; error: string }

export interface TtsStatus {
  configured: boolean
  provider: string
  voice: string
}

const voice = {
  transcribe: (audio: ArrayBuffer, mimeType: string): Promise<VoiceTranscribeResult> =>
    ipcRenderer.invoke('voice:transcribe', { audio, mimeType }),
  getTtsStatus: (): Promise<TtsStatus> => ipcRenderer.invoke('voice:tts-status'),
  speak: (text: string): Promise<VoiceSpeakResult> => ipcRenderer.invoke('voice:speak', { text })
}

export type WeatherIcon =
  'sun' | 'part-cloud' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder'

export interface LocationWeather {
  id: string
  label: string
  temperature: number
  feelsLike: number
  condition: string
  icon: WeatherIcon
  windSpeed: number
  high: number
  low: number
}

export interface WeatherReport {
  updatedAt: number
  locations: LocationWeather[]
}

export type WeatherResult = { ok: true; report: WeatherReport } | { ok: false; error: string }

const weather = {
  get: (): Promise<WeatherResult> => ipcRenderer.invoke('weather:get')
}

export interface SpotifyPlaybackState {
  isPlaying: boolean
  trackName: string | null
  artists: string[]
  deviceName: string | null
  volumePercent: number | null
}

const spotify = {
  /** Live playback-state pushes from the main process (null = nothing playing). */
  onState: (callback: (state: SpotifyPlaybackState | null) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: SpotifyPlaybackState | null
    ): void => callback(state)
    ipcRenderer.on('spotify:state', listener)
    return () => ipcRenderer.removeListener('spotify:state', listener)
  }
}

const jarvisApi = {
  window: windowControls,
  system,
  chat,
  voice,
  weather,
  spotify
}

export type JarvisApi = typeof jarvisApi

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('jarvis', jarvisApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts) - fallback only if contextIsolation is ever disabled
  window.jarvis = jarvisApi
}
