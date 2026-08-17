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

### Windows: setting up Electron the first time

`npm run dev` (and `install`/`build`) run `scripts/ensure-electron.js`
automatically, which verifies Electron's binary is present since npm's own
install-script security can silently skip the step that installs it.

**On Windows, this script does not download Electron automatically by
default.** On a machine we tested against, Windows Defender's behavioral
engine (`Get-MpThreatDetection`) flagged `node.exe` itself
(`Behavior:Win32/NodeSussProcLaunch.D`) purely for fetching an archive from
the internet and unpacking an executable from it — a pattern indistinguishable
from a malware dropper to Defender's heuristics, regardless of how it's
implemented. Removing all PowerShell/subprocess calls from the script (an
earlier version used them to inspect Defender's exclusion list) did not fix
this: even a version using nothing but the official `@electron/get` download
library and `extract-zip` still triggered it, because the flagged behavior is
the download-and-unpack operation itself, not any particular implementation
detail.

So on Windows, setup is a one-time manual step:

1. Run `npm install`, then `npm run dev` (or `npm run ensure-electron`). It
   will print the exact official download URL and checksum for your
   Electron version, e.g.:
   ```
   https://github.com/electron/electron/releases/download/vX.X.X/electron-vX.X.X-win32-x64.zip
   ```
2. Download that file in your browser (not via this script).
3. Optionally verify it's genuine before extracting — pure local file
   hashing, no network, no subprocess:
   ```bash
   npm run verify-electron-zip -- "C:\path\to\electron-vX.X.X-win32-x64.zip"
   ```
4. Extract the zip's contents **directly into** `node_modules\electron\dist`
   (not into a subfolder — if Windows Explorer's extract wizard suggests a
   destination subfolder, edit it out) using Explorer's "Extract All", so
   that `node_modules\electron\dist\electron.exe` exists afterward.
5. Re-run `npm run dev`. The script detects the file, writes the two small
   marker files Electron's package needs (`path.txt`, `dist\version` — plain
   text, no network or subprocess), and you're done. Every subsequent
   `npm run dev` is instant with zero network activity — nothing is
   downloaded again.

If a particular Windows machine is confirmed **not** to have this Defender
issue, automated download can be re-enabled for it:

```powershell
$env:ENSURE_ELECTRON_ALLOW_AUTO_DOWNLOAD = "true"
```

This setup never involves disabling Windows Defender, adding exclusions, or
running PowerShell from this project's scripts — everything the scripts do
is plain, local file I/O (checking a file exists, hashing a file, writing two
short text files).

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
