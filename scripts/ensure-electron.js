#!/usr/bin/env node
/**
 * Guarantees the real Electron binary is present in node_modules/electron/dist.
 *
 * Why this exists: on some machines (seen on Windows, likely antivirus/EDR/proxy
 * interference) electron's own postinstall (node_modules/electron/install.js) can
 * silently no-op or die with zero output, and a plain `npm install` afterwards
 * reports "up to date" without ever re-running that script — npm only tracks
 * whether the electron *package* was extracted, not whether its postinstall
 * side effect (downloading the ~200MB platform binary) actually succeeded.
 *
 * This script re-implements that one side effect directly, using Electron's own
 * official download + checksum-verification library (@electron/get) and the same
 * extraction library electron itself uses, but with three guarantees the stock
 * script doesn't make:
 *   1. Every code path prints something. There is no silent success or failure.
 *   2. A hard timeout turns a silent hang (proxy/firewall/AV swallowing the
 *      request) into a loud, actionable error instead of nothing.
 *   3. It's idempotent and safe to run before every `dev`/`start`/`build` via
 *      npm's automatic pre<script> hooks, so a broken binary self-heals instead
 *      of failing deep inside Electron with a confusing error.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const TIMEOUT_MS = Number(process.env.ENSURE_ELECTRON_TIMEOUT_MS) || 5 * 60 * 1000
const MIN_BINARY_BYTES = 30 * 1024 * 1024 // real electron binaries are 100MB+

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
[ensure-electron] This means the Electron binary download did not complete.
Most common causes on Windows:
  - Antivirus / EDR (Defender, CrowdStrike, etc.) silently blocking or killing
    node.exe while it downloads from github.com. Try adding this project
    folder to your antivirus exclusions, or temporarily disable real-time
    protection and re-run: npm run ensure-electron
  - A corporate proxy or firewall blocking github.com / githubusercontent.com.
    If you're behind a proxy, set HTTPS_PROXY / HTTP_PROXY env vars, or set
    an Electron mirror: set ELECTRON_MIRROR=<your-internal-mirror-url>
  - OneDrive syncing this project folder and locking files mid-extraction.
    Try moving the project outside any OneDrive-synced directory.

Re-run with more detail:
  npm run ensure-electron -- --verbose
`)
  // Force-exit rather than setting exitCode: the whole point of the timeout
  // above is to escape a silently-hung download promise. If we just set
  // exitCode and let the event loop drain naturally, that orphaned promise
  // keeps the process alive forever in exactly the scenario this guards
  // against, and the timeout protection never actually takes effect.
  process.exit(1)
}

function succeed(msg) {
  settled = true
  log(msg)
  // Force-exit for the same reason as fail(): don't let a lingering
  // keep-alive socket from the HTTP client silently hold the process open.
  process.exit(0)
}

process.on('exit', (code) => {
  if (!settled) {
    console.error(
      '\n[ensure-electron] The process is exiting (code ' +
        code +
        ') without reaching a normal completion path.\n' +
        '[ensure-electron] This strongly suggests something OUTSIDE Node.js — antivirus, an\n' +
        '[ensure-electron] EDR agent, or a corporate proxy — is terminating the download.\n' +
        '[ensure-electron] Check your antivirus / security software logs for node.exe activity\n' +
        '[ensure-electron] around this timestamp, or try running from an elevated terminal.'
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
    setTimeout(() => {
      reject(
        new Error(
          `Download did not complete within ${TIMEOUT_MS / 1000}s. ` +
            'Nothing progressed — this is the signature of a silent block, not a slow network.'
        )
      )
    }, TIMEOUT_MS).unref()
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
  try {
    log('extracting...')
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
    fail(
      `extraction completed but dist/${platformPath} is still missing or suspiciously small — ` +
        'likely antivirus quarantined the executable immediately after it was written'
    )
    return
  }

  const finalPath = path.join(distDir, platformPath)
  const finalStat = fs.statSync(finalPath)
  succeed(`installed successfully: ${finalPath} (${(finalStat.size / 1024 / 1024).toFixed(0)}MB)`)
}

main().catch((err) => {
  fail('unexpected error', err)
})
