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

If you hit this, the script prints exactly what to do, but the short version:

1. **Add an exclusion via the Windows Security app itself** — Virus & threat
   protection > Manage settings > Add or remove exclusions > Add an exclusion
   > Folder > select `node_modules\electron`.
2. If Add-MpPreference from an elevated PowerShell reports success but
   Defender still quarantines the file anyway, **Tamper Protection is almost
   certainly on** — it deliberately blocks security-setting changes made
   outside the Windows Security app, even from an elevated session, and can
   let the PowerShell command report success without it actually taking
   effect. Step 1 above is the reliable fix in that case, not PowerShell.
3. For a permanent fix, submit the file as a false positive at
   https://www.microsoft.com/en-us/wdsi/filesubmission.

This never involves disabling Windows Defender.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
