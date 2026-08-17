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

const system = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    node: process.versions.node,
    electron: process.versions.electron
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type ChatSendResult = { ok: true; message: string } | { ok: false; error: string }

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

const jarvisApi = {
  window: windowControls,
  system,
  chat,
  voice
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
