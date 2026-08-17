#!/usr/bin/env node
/**
 * Guarantees the real Electron binary is present in node_modules/electron/dist.
 *
 * Why this exists: npm's own install-script security can silently skip
 * electron's postinstall (node_modules/electron/install.js) — the step that
 * downloads the ~200MB platform binary — and a plain `npm install` afterwards
 * reports "up to date" without ever re-running it, since npm only tracks
 * whether the electron *package* was extracted, not whether that side effect
 * actually completed.
 *
 * WINDOWS: confirmed via Get-MpThreatDetection that Windows Defender's
 * behavioral engine flags this pattern directly:
 *
 *   ProcessName: C:\Program Files\nodejs\node.exe
 *   ThreatID:    2147959239 (Behavior:Win32/NodeSussProcLaunch.D)
 *   Resources:   behavior:_process: C:\Program Files\nodejs\node.exe
 *
 * Note there is no file resource in that detection — this is not about the
 * downloaded .exe's content, and removing all PowerShell/child_process calls
 * from this script (an earlier version used them to inspect/add a Defender
 * exclusion) did NOT fix it: even a script that only downloads via @electron/get
 * and extracts via extract-zip — zero subprocess calls anywhere — still hangs
 * during extraction on the affected machine. The behavior being flagged is
 * "node.exe fetches an archive from the internet and unpacks an executable
 * from it," full stop, independent of implementation. There is no way to
 * reimplement that operation in Node that doesn't match the same pattern.
 *
 * So on Windows, this script does NOT attempt an automated download by
 * default. Instead it tells you the exact official URL and target folder,
 * you download and extract it yourself (browser + Windows Explorer — tools
 * Defender already trusts for those specific actions), and this script's job
 * shrinks to what's actually safe to automate: checking the file is present
 * and a plausible size, and writing the two tiny marker files
 * (node_modules/electron/path.txt and dist/version) that electron's own
 * package needs to resolve the binary — plain fs.writeFileSync calls,
 * nothing resembling the flagged pattern. That verification is also what
 * makes every subsequent `npm run dev` instant with zero network activity —
 * no repeated downloads.
 *
 * macOS and Linux are unaffected by this issue (verified extensively) and
 * keep the original automated download+extract path. A Windows machine that
 * does NOT have this problem can opt back into the automated path with
 * ENSURE_ELECTRON_ALLOW_AUTO_DOWNLOAD=true.
 *
 * Every code path here prints something — there is no silent success or
 * failure — and it's wired via predev, prestart, prebuild:win/mac/linux, and
 * postinstall so a correctly-installed binary is confirmed instantly before
 * Electron ever tries to launch.
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
Re-run with more detail:
  npm run ensure-electron -- --verbose
`)
  process.exit(1)
}

function succeed(msg) {
  settled = true
  log(msg)
  process.exit(0)
}

// Registered lazily (inside the require.main guard at the bottom of this
// file), not at module load time — otherwise this fires spuriously whenever
// another script (verify-electron-zip.js) requires this file for its helper
// functions and then exits on its own, unrelated completion path.
function registerUnexpectedExitWarning() {
  process.on('exit', (code) => {
    if (!settled) {
      console.error(
        '\n[ensure-electron] The process is exiting (code ' +
          code +
          ') without reaching a normal completion path.\n' +
          '[ensure-electron] If this happened during a download/extract attempt, that step is\n' +
          '[ensure-electron] not supposed to run automatically on Windows by default — see\n' +
          '[ensure-electron] ENSURE_ELECTRON_ALLOW_AUTO_DOWNLOAD in the script source.'
      )
    }
  })
}

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
  // Deliberately NOT .unref()'d — see git history for why that matters here.
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Pure fs.writeFileSync — no network, no subprocess. electron's own
// node_modules/electron/index.js throws "Electron failed to install
// correctly" unless path.txt exists, even if dist/<binary> is genuinely
// present (e.g. placed there manually), so this always needs to run once.
function writeInstallMarkers(electronDir, distDir, platformPath, version) {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath)
  fs.writeFileSync(path.join(distDir, 'version'), `v${version}`)
}

function zipFileName(version, platform, arch) {
  return `electron-v${version}-${platform}-${arch}.zip`
}

function officialDownloadUrl(version, platform, arch) {
  return `https://github.com/electron/electron/releases/download/v${version}/${zipFileName(version, platform, arch)}`
}

function expectedZipChecksum(electronDir, version, platform, arch) {
  try {
    const checksums = require(path.join(electronDir, 'checksums.json'))
    return checksums[zipFileName(version, platform, arch)] || null
  } catch {
    return null
  }
}

function manualDownloadInstructions(electronDir, distDir, version, platform, arch) {
  const url = officialDownloadUrl(version, platform, arch)
  const checksum = expectedZipChecksum(electronDir, version, platform, arch)

  return `[ensure-electron] Windows Defender's behavioral engine flags Node.js downloading
[ensure-electron] and unpacking an executable — regardless of how that's implemented — so
[ensure-electron] this script does not attempt it automatically here. This is a one-time
[ensure-electron] manual step; every "npm run dev" after this is instant with no download.
[ensure-electron]
[ensure-electron] 1. Download this file in your browser (Edge/Chrome — not this script):
[ensure-electron]      ${url}
[ensure-electron]${checksum ? `\n[ensure-electron]    Expected SHA-256: ${checksum}\n[ensure-electron]    Verify it (optional) with:\n[ensure-electron]      npm run verify-electron-zip -- "C:\\path\\to\\${zipFileName(version, platform, arch)}"\n[ensure-electron]` : ''}
[ensure-electron] 2. Extract the zip's contents DIRECTLY into (not into a subfolder of):
[ensure-electron]      ${distDir}
[ensure-electron]    In Windows Explorer's extract wizard, edit the destination field to
[ensure-electron]    remove any extra folder it suggests, so that afterward this file
[ensure-electron]    exists:
[ensure-electron]      ${path.join(distDir, getPlatformPathSafe(platform))}
[ensure-electron]
[ensure-electron] 3. Re-run: npm run dev  (or: npm run ensure-electron)
[ensure-electron]    This script will detect the file, write the two small marker files
[ensure-electron]    electron needs (path.txt, dist/version — plain text, no network or
[ensure-electron]    subprocess involved), and you're done.
[ensure-electron]
[ensure-electron] If a machine is confirmed NOT to have this Defender issue, automated
[ensure-electron] download can be re-enabled for it:
[ensure-electron]   set ENSURE_ELECTRON_ALLOW_AUTO_DOWNLOAD=true`
}

function getPlatformPathSafe(platform) {
  try {
    return getPlatformPath(platform)
  } catch {
    return 'electron.exe'
  }
}

async function runAutomatedDownload(electronDir, distDir, platformPath, version, platform, arch, verbose) {
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

  log('extracting...')
  try {
    await extract(zipPath, { dir: distDir })
  } catch (err) {
    fail('extraction failed', err)
    return
  }

  writeInstallMarkers(electronDir, distDir, platformPath, version)

  if (!binaryLooksValid(electronDir, platformPath)) {
    fail(`dist/${platformPath} is missing immediately after extraction.`)
    return
  }

  log('binary present — confirming it is still there a moment later...')
  for (let i = 0; i < SETTLE_CHECKS; i++) {
    await sleep(SETTLE_DELAY_MS)
    if (!binaryLooksValid(electronDir, platformPath)) {
      fail(
        `dist/${platformPath} disappeared ${(((i + 1) * SETTLE_DELAY_MS) / 1000).toFixed(1)}s ` +
          'after extraction.'
      )
      return
    }
  }

  const finalPath = path.join(distDir, platformPath)
  const finalStat = fs.statSync(finalPath)
  succeed(`installed successfully: ${finalPath} (${(finalStat.size / 1024 / 1024).toFixed(0)}MB)`)
}

async function main() {
  const verbose = process.argv.includes('--verbose')
  const force = process.argv.includes('--force') || process.env.force_no_cache === 'true'

  const electronDir = path.dirname(require.resolve('electron/package.json'))
  const { version } = require('electron/package.json')
  const platform = process.env.npm_config_platform || os.platform()
  const arch = process.env.npm_config_arch || os.arch()
  const platformPath = getPlatformPath(platform)
  const distDir = path.join(electronDir, 'dist')

  log(`electron ${version} — platform=${platform} arch=${arch}`)

  if (!force && binaryLooksValid(electronDir, platformPath)) {
    // Binary present. Markers might still be missing if it was placed here
    // manually and this is the first run since — writing them is safe,
    // network-free, subprocess-free housekeeping either way.
    writeInstallMarkers(electronDir, distDir, platformPath, version)
    succeed(`binary already present at dist/${platformPath} — nothing to do`)
    return
  }

  const allowAutoDownload =
    platform !== 'win32' || process.env.ENSURE_ELECTRON_ALLOW_AUTO_DOWNLOAD === 'true'

  if (!allowAutoDownload) {
    fail(
      `dist/${platformPath} is missing, and automated download is disabled by default on ` +
        "Windows (see this script's header comment for why).\n\n" +
        manualDownloadInstructions(electronDir, distDir, version, platform, arch)
    )
    return
  }

  log(`binary missing or invalid at dist/${platformPath}, downloading...`)
  if (verbose) {
    log(`cache root: ${process.env.electron_config_cache || '(default)'}`)
    log(`HTTPS_PROXY=${process.env.HTTPS_PROXY || process.env.https_proxy || '(unset)'}`)
    log(`HTTP_PROXY=${process.env.HTTP_PROXY || process.env.http_proxy || '(unset)'}`)
    log(`ELECTRON_MIRROR=${process.env.ELECTRON_MIRROR || '(unset)'}`)
  }

  await runAutomatedDownload(electronDir, distDir, platformPath, version, platform, arch, verbose)
}

module.exports = { officialDownloadUrl, zipFileName, expectedZipChecksum }

// Only auto-run when invoked directly (`node ensure-electron.js`), not when
// required as a module by verify-electron-zip.js for its helper functions.
if (require.main === module) {
  registerUnexpectedExitWarning()
  main().catch((err) => {
    fail('unexpected error', err)
  })
}
