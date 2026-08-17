#!/usr/bin/env node
/**
 * Guarantees the real Electron binary is present in node_modules/electron/dist.
 *
 * Why this exists: npm's own install-script security can silently skip
 * electron's postinstall (node_modules/electron/install.js) — the step that
 * downloads the ~200MB platform binary — and a plain `npm install` afterwards
 * reports "up to date" without ever re-running it, since npm only tracks
 * whether the electron *package* was extracted, not whether that side effect
 * actually completed. This script re-implements just that one download +
 * extraction step directly, using Electron's own official download and
 * checksum-verification library (@electron/get) and the same extraction
 * library electron itself uses.
 *
 * On Windows, this can also collide with Windows Defender flagging the
 * generic, unsigned Electron binary as a false positive and quarantining it
 * shortly after it's written. THIS SCRIPT DOES NOT TRY TO FIX THAT. An
 * earlier version of this file called PowerShell (Add-MpPreference,
 * Get-MpPreference, Get-MpComputerStatus, Get-MpThreat) to inspect and
 * modify Defender's exclusion list automatically. That was a mistake:
 * Defender's behavioral engine flagged the resulting node.exe process itself
 * as suspicious (Behavior:Win32/NodeSussProcLaunch.D) — a Node.js process
 * spawning PowerShell to modify the antivirus's own configuration is exactly
 * the pattern real malware droppers use to disable protection before
 * dropping a payload, so a legitimate installer doing the same thing for
 * good reasons still looks identical to Defender's heuristics. This script
 * therefore spawns NO child processes and touches NO security settings, on
 * any platform. If Windows Defender quarantines the binary, that's reported
 * clearly as plain text in the failure message, with manual (GUI-only) steps
 * — never anything this script attempts on the user's behalf.
 *
 * Every code path here prints something — there is no silent success or
 * failure — and it's wired via predev, prestart, prebuild:win/mac/linux, and
 * postinstall so a broken binary self-heals before Electron ever tries to
 * launch.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const TIMEOUT_MS = Number(process.env.ENSURE_ELECTRON_TIMEOUT_MS) || 5 * 60 * 1000
const MIN_BINARY_BYTES = 30 * 1024 * 1024 // real electron binaries are 100MB+
const SETTLE_DELAY_MS = 1500
const SETTLE_CHECKS = 8 // ~12s of polling this process's own filesystem state — no child processes involved

let settled = false

function log(msg) {
  console.log(`[ensure-electron] ${msg}`)
}

function fail(msg, err) {
  settled = true
  console.error(`\n[ensure-electron] FAILED: ${msg}`)
  if (err) {
    console.error(`[ensure-electron] ${err.stack || err.message || err}`)
  }
  console.error(`
[ensure-electron] Other possible causes:
  - A corporate proxy or firewall blocking github.com / githubusercontent.com.
    If you're behind a proxy, set HTTPS_PROXY / HTTP_PROXY env vars, or set
    an Electron mirror: set ELECTRON_MIRROR=<your-internal-mirror-url>
  - OneDrive syncing this project folder and locking files mid-extraction.
    Try moving the project outside any OneDrive-synced directory.

Re-run with more detail:
  npm run ensure-electron -- --verbose
`)
  // Force-exit rather than setting exitCode: the whole point of the timeout
  // and settle-window logic below is to escape a silently-hung or
  // eventually-quarantined download. If we just set exitCode and let the
  // event loop drain naturally, an orphaned promise or timer could keep the
  // process alive far longer than intended.
  process.exit(1)
}

function succeed(msg) {
  settled = true
  log(msg)
  process.exit(0)
}

process.on('exit', (code) => {
  if (!settled) {
    console.error(
      '\n[ensure-electron] The process is exiting (code ' +
        code +
        ') without reaching a normal completion path.\n' +
        '[ensure-electron] This strongly suggests something OUTSIDE Node.js — antivirus, an\n' +
        '[ensure-electron] EDR agent, or a corporate proxy — is terminating the download.'
    )
  }
})

function getPlatformPath(platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error('Electron builds are not available on platform: ' + platform)
  }
}

function requireFromElectron(pkg) {
  const electronDir = path.dirname(require.resolve('electron/package.json'))
  return require(require.resolve(pkg, { paths: [electronDir] }))
}

function binaryLooksValid(electronDir, platformPath) {
  const binaryPath = path.join(electronDir, 'dist', platformPath)
  try {
    const stat = fs.statSync(binaryPath)
    return stat.isFile() && stat.size >= MIN_BINARY_BYTES
  } catch {
    return false
  }
}

function sleep(ms) {
  // Deliberately NOT .unref()'d: this is used to actively wait out settle
  // windows during extraction verification, and an unref'd timer lets Node
  // exit before it fires once nothing else is pending — which is exactly
  // the silent-early-exit bug this whole script exists to prevent.
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function quarantineFailureMessage(electronDir, platformPath) {
  return `dist/${platformPath} was missing or was deleted shortly after extraction. On \
Windows this is almost always Windows Defender quarantining the file — a well-documented \
false-positive pattern against generic, unsigned Electron release binaries, not a real \
threat.

[ensure-electron] This script does not keep retrying: every attempt extracts the identical \
bytes from the same downloaded zip, so Defender would reach the identical verdict every \
time — repeating it would only waste your time. It also does not run PowerShell or touch \
any security settings on its own; that behavior previously triggered a SEPARATE Defender \
detection (Behavior:Win32/NodeSussProcLaunch.D) against node.exe itself, because a Node \
process spawning PowerShell to modify antivirus configuration looks identical to a common \
malware technique, however legitimate the reason. So the fix has to be something you do \
by hand, in the Windows Security app itself — not something automated here:

[ensure-electron]   1. Windows Security > Virus & threat protection > Manage settings
[ensure-electron]      (under "Virus & threat protection settings") > Add or remove
[ensure-electron]      exclusions > Add an exclusion > Folder > select:
[ensure-electron]        ${electronDir}
[ensure-electron]   2. Then re-run: npm run ensure-electron
[ensure-electron]
[ensure-electron]   If you have no admin access on this machine at all: Windows Security >
[ensure-electron]   Virus & threat protection > Protection history > find the detection >
[ensure-electron]   Actions > Restore. This recovers just this one file without an
[ensure-electron]   exclusion, but Defender will likely re-quarantine it on the next fresh
[ensure-electron]   download.
[ensure-electron]
[ensure-electron]   For a permanent, upstream fix: submit the file as a false positive at
[ensure-electron]   https://www.microsoft.com/en-us/wdsi/filesubmission`
}

async function main() {
  const verbose = process.argv.includes('--verbose')
  const force = process.argv.includes('--force') || process.env.force_no_cache === 'true'

  const electronDir = path.dirname(require.resolve('electron/package.json'))
  const { version } = require('electron/package.json')
  const platform = process.env.npm_config_platform || os.platform()
  const arch = process.env.npm_config_arch || os.arch()
  const platformPath = getPlatformPath(platform)

  log(`electron ${version} — platform=${platform} arch=${arch}`)

  if (!force && binaryLooksValid(electronDir, platformPath)) {
    succeed(`binary already present at dist/${platformPath} — nothing to do`)
    return
  }

  log(`binary missing or invalid at dist/${platformPath}, downloading...`)
  if (verbose) {
    log(`cache root: ${process.env.electron_config_cache || '(default)'}`)
    log(`HTTPS_PROXY=${process.env.HTTPS_PROXY || process.env.https_proxy || '(unset)'}`)
    log(`HTTP_PROXY=${process.env.HTTP_PROXY || process.env.http_proxy || '(unset)'}`)
    log(`ELECTRON_MIRROR=${process.env.ELECTRON_MIRROR || '(unset)'}`)
  }

  let downloadArtifact, extract
  try {
    ;({ downloadArtifact } = requireFromElectron('@electron/get'))
    extract = requireFromElectron('extract-zip')
  } catch (err) {
    fail('could not load @electron/get or extract-zip from node_modules/electron', err)
    return
  }

  const checksums = require(path.join(electronDir, 'checksums.json'))

  let lastLoggedPercent = -1
  const downloadPromise = downloadArtifact({
    version,
    artifactName: 'electron',
    force: true,
    cacheRoot: process.env.electron_config_cache,
    checksums,
    platform,
    arch,
    downloadOptions: {
      quiet: false,
      getProgressCallback: async (progress) => {
        const percent = Math.floor((progress.percent || 0) * 100)
        if (percent !== lastLoggedPercent && percent % 10 === 0) {
          lastLoggedPercent = percent
          log(`downloading... ${percent}%`)
        }
      }
    }
  })

  const timeoutPromise = new Promise((_, reject) => {
    // Not .unref()'d, same reasoning as sleep() above — this timer is the
    // thing that's supposed to fire if everything else silently stalls, so
    // it must not be the thing that lets the process exit early instead.
    setTimeout(() => {
      reject(
        new Error(
          `Download did not complete within ${TIMEOUT_MS / 1000}s. ` +
            'Nothing progressed — this is the signature of a silent block, not a slow network.'
        )
      )
    }, TIMEOUT_MS)
  })

  let zipPath
  try {
    log('starting download (this can take a minute on first run)...')
    zipPath = await Promise.race([downloadPromise, timeoutPromise])
  } catch (err) {
    fail('download failed or timed out', err)
    return
  }

  try {
    const stat = fs.statSync(zipPath)
    log(`downloaded ${(stat.size / 1024 / 1024).toFixed(1)}MB, checksum verified by @electron/get`)
  } catch (err) {
    fail('downloaded artifact could not be read back from disk', err)
    return
  }

  const distDir = path.join(electronDir, 'dist')

  // A single attempt, always: every attempt would extract byte-identical
  // content from this same zip, so a real quarantine's verdict can't differ
  // between retries — there's nothing to gain from looping.
  log('extracting...')
  try {
    await extract(zipPath, { dir: distDir })
  } catch (err) {
    fail('extraction failed', err)
    return
  }

  try {
    fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath)
    fs.writeFileSync(path.join(distDir, 'version'), `v${version}`)
  } catch (err) {
    fail('extraction succeeded but writing path.txt/version markers failed', err)
    return
  }

  if (!binaryLooksValid(electronDir, platformPath)) {
    fail(quarantineFailureMessage(electronDir, platformPath))
    return
  }

  // The binary exists right now. On Windows, Defender's cloud-delivered
  // protection can quarantine a freshly-written, unsigned .exe a moment
  // *after* it's written and passes an initial scan — so watch it for a
  // while before trusting it, instead of declaring success the instant it
  // first appears. This only polls this process's own filesystem state
  // (fs.statSync) — it spawns nothing.
  log('binary present — confirming it is still there a moment later...')
  for (let i = 0; i < SETTLE_CHECKS; i++) {
    await sleep(SETTLE_DELAY_MS)
    if (!binaryLooksValid(electronDir, platformPath)) {
      log(
        `dist/${platformPath} disappeared ${(((i + 1) * SETTLE_DELAY_MS) / 1000).toFixed(1)}s ` +
          'after extraction.'
      )
      fail(quarantineFailureMessage(electronDir, platformPath))
      return
    }
  }

  const finalPath = path.join(distDir, platformPath)
  const finalStat = fs.statSync(finalPath)
  succeed(`installed successfully: ${finalPath} (${(finalStat.size / 1024 / 1024).toFixed(0)}MB)`)
}

main().catch((err) => {
  fail('unexpected error', err)
})
