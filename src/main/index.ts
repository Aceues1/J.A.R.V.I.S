import 'dotenv/config'
import { app, shell, session, desktopCapturer, screen, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { GroqConfigError, GroqRequestError, getGroqStatus, requestGroqReply } from './groq'
import { validateChatHistory } from './chat-validation'
import { transcribeAudio, validateAudioPayload } from './transcription'
import {
  TtsConfigError,
  TtsRequestError,
  getTtsStatus,
  synthesizeSpeech,
  validateSpeakPayload
} from './tts'
import { WeatherError, getWeatherReport } from './weather'
import { getSystemStatus } from './awareness'
import { registerAppsDir } from './control/apps'
import { registerExternalOpener } from './control/websites'
import { registerScreenCapturer, routeReply } from './control/router'
import { MAX_SCREENS, type ScreenImage } from './vision'
import { serveRendererDirectory } from './renderer-server'
import { getLiveSearchContext } from './webSearch'
import { runWebSearchSelfTest, selfTestEnabled } from './webSearch/debug'

// Captures every monitor as a labelled JPEG data URL. desktopCapturer reads
// the displays themselves, so this works while the JARVIS window is
// minimized or hidden.
async function captureAllScreens(): Promise<ScreenImage[]> {
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 }
  })
  return sources.slice(0, MAX_SCREENS).map((source, index) => {
    const display = displays.find((d) => String(d.id) === source.display_id)
    const primary = display && display.id === primaryId ? ', primary' : ''
    const size = display ? `, ${display.size.width}x${display.size.height}` : ''
    return {
      label: `Display ${index + 1} of ${sources.length}${primary}${size}`,
      dataUrl: `data:image/jpeg;base64,${source.thumbnail.toJPEG(70).toString('base64')}`
    }
  })
}

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    // Small enough for a slim side-by-side companion window; the HUD sheds
    // its side panels responsively below the Tailwind lg/xl breakpoints.
    minWidth: 460,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#05080c',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state-changed', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state-changed', false))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Production serves the renderer from a loopback HTTP origin instead of
    // file:// — YouTube's embed player rejects file:// origins (Error 153).
    try {
      const server = await serveRendererDirectory(join(__dirname, '../renderer'))
      mainWindow.loadURL(server.url)
    } catch (error) {
      console.error('[main] loopback renderer server failed; falling back to file://', error)
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.aceues1.jarvis')

  // Computer-control wiring: allowlisted registry in userData, the default
  // browser as the only URL opener, and the display capturer for vision.
  registerAppsDir(app.getPath('userData'))
  registerExternalOpener((url) => shell.openExternal(url))
  registerScreenCapturer(captureAllScreens)

  // Optional per-source web-search self-test (JARVIS_WEBSEARCH_DEBUG=1):
  // exercises each live source from the main process and prints PASS/FAIL to
  // the terminal — no model, no renderer, no secrets in the output.
  if (selfTestEnabled()) {
    void runWebSearchSelfTest()
  }

  // The renderer only ever needs the microphone; deny every other permission.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission === 'media') {
        const mediaTypes = (details as Electron.MediaAccessPermissionRequest).mediaTypes ?? []
        callback(mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio'))
        return
      }
      callback(false)
    }
  )
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    if (permission === 'media') {
      const mediaType = (details as { mediaType?: string }).mediaType
      return mediaType === undefined || mediaType === 'audio'
    }
    return false
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle('chat:get-status', () => getGroqStatus())

  ipcMain.handle('chat:send', async (_event, payload: unknown) => {
    const history = validateChatHistory(payload)
    if (!history) {
      return { ok: false as const, error: 'Malformed chat request.' }
    }

    try {
      // PRO 3: gate + layered live web search. Returns null when no live
      // data is needed; an honest failure block when sources fail; and
      // never throws — chat survives any search problem.
      const searchContext = await getLiveSearchContext(history)
      const reply = await requestGroqReply(history, searchContext?.block)
      // Action envelopes (open app/website, analyze screen, video playback)
      // are executed here; plain replies pass straight through. Player
      // directives ride along for the renderer's embedded player.
      const lastUser = [...history].reverse().find((turn) => turn.role === 'user')?.content ?? ''
      const routed = await routeReply(reply, lastUser)
      return {
        ok: true as const,
        message: routed.text,
        player: routed.player,
        search: searchContext
          ? { source: searchContext.source, query: searchContext.query, ok: searchContext.ok }
          : undefined
      }
    } catch (error) {
      if (error instanceof GroqConfigError || error instanceof GroqRequestError) {
        return { ok: false as const, error: error.message }
      }
      console.error('[chat:send] unexpected error', error)
      return { ok: false as const, error: 'Unexpected error contacting the AI backend.' }
    }
  })

  ipcMain.handle('voice:transcribe', async (_event, payload: unknown) => {
    const audio = validateAudioPayload(payload)
    if (!audio) {
      return { ok: false as const, error: 'Malformed audio payload.' }
    }

    try {
      const text = await transcribeAudio(audio)
      return { ok: true as const, text }
    } catch (error) {
      if (error instanceof GroqConfigError || error instanceof GroqRequestError) {
        return { ok: false as const, error: error.message }
      }
      console.error('[voice:transcribe] unexpected error', error)
      return { ok: false as const, error: 'Unexpected error transcribing audio.' }
    }
  })

  ipcMain.handle('voice:tts-status', () => getTtsStatus())

  ipcMain.handle('voice:speak', async (_event, payload: unknown) => {
    const text = validateSpeakPayload(payload)
    if (!text) {
      return { ok: false as const, error: 'Malformed speech request.' }
    }

    try {
      const { audio, mimeType } = await synthesizeSpeech(text)
      return { ok: true as const, audio, mimeType }
    } catch (error) {
      if (error instanceof TtsConfigError || error instanceof TtsRequestError) {
        return { ok: false as const, error: error.message }
      }
      console.error('[voice:speak] unexpected error', error)
      return { ok: false as const, error: 'Unexpected error synthesizing speech.' }
    }
  })

  ipcMain.handle('system:status', async () => {
    try {
      return { ok: true as const, status: await getSystemStatus() }
    } catch (error) {
      console.error('[system:status] unexpected error', error)
      return { ok: false as const, error: 'System status unavailable.' }
    }
  })

  ipcMain.handle('weather:get', async () => {
    try {
      const report = await getWeatherReport()
      return { ok: true as const, report }
    } catch (error) {
      if (error instanceof WeatherError) {
        return { ok: false as const, error: error.message }
      }
      console.error('[weather:get] unexpected error', error)
      return { ok: false as const, error: 'Unexpected error fetching weather.' }
    }
  })

  void createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
