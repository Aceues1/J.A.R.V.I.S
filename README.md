# JARVIS Desktop GUI

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### AI backend (Groq)

The "Ask Jarvis..." input is wired to Groq. The API key is used only in the
Electron main process and is never bundled into the renderer.

```bash
$ cp .env.example .env
# then edit .env and set GROQ_API_KEY=your-key-from-console.groq.com
```

### Development

```bash
$ npm run dev
```

### Windows: if Electron keeps disappearing (Defender quarantine)

`npm run dev` (and `install`/`build`) run `scripts/ensure-electron.js`
automatically, which downloads and verifies Electron's binary since npm's own
install-script security can silently skip it. On some Windows machines,
Windows Defender's cloud-delivered protection flags the generic, unsigned
Electron binary as a threat and quarantines it — this is a well-documented
false positive against Electron release builds, not a real threat.

`ensure-electron.js` does **not** run PowerShell or touch any security
settings on its own — an earlier version tried to, and that automation
itself triggered a separate Defender detection
(`Behavior:Win32/NodeSussProcLaunch.D`) against `node.exe`, since a Node
process spawning PowerShell to modify antivirus configuration looks
identical to a common malware technique. So the fix, if you hit this, is
always manual, done by hand in the Windows Security app:

1. Windows Security > Virus & threat protection > Manage settings (under
   "Virus & threat protection settings") > Add or remove exclusions > Add
   an exclusion > Folder > select `node_modules\electron`.
2. Re-run `npm run ensure-electron` (or `npm run dev`).
3. If you have no admin access on this machine at all: Windows Security >
   Virus & threat protection > Protection history > find the detection >
   Actions > Restore. This recovers just the one file without an
   exclusion, but Defender will likely re-quarantine it on the next fresh
   download.
4. For a permanent, upstream fix: submit the file as a false positive at
   https://www.microsoft.com/en-us/wdsi/filesubmission.

This never involves disabling Windows Defender, and the script never
attempts to add the exclusion for you.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
