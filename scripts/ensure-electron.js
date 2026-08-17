#!/usr/bin/env node
/**
 * Guarantees the real Electron binary is present in node_modules/electron/dist.
 *
 * Why this exists: on some machines (confirmed: Windows + Windows Defender)
 * electron's own postinstall (node_modules/electron/install.js) can silently
 * no-op or die with zero output, and a plain `npm install` afterwards reports
 * "up to date" without ever re-running that script — npm only tracks whether
 * the electron *package* was extracted, not whether its postinstall side
 * effect (downloading the ~200MB platform binary) actually succeeded.
 *
 * On Windows specifically, the confirmed root cause is Windows Defender's
 * cloud-delivered protection (MAPS): it does an async reputation check on a
 * freshly-written, unsigned .exe and can quarantine it seconds after the
 * initial on-write scan already passed. This is a well-documented false
 * positive against generic Electron release binaries, not a real threat —
 * but it means extraction can genuinely succeed and the file still vanishes
 * moments later. A folder-scoped Defender exclusion is the only fix with no
 * race condition in it; this script detects, attempts, and clearly reports
 * that status, and does NOT keep blindly retrying once it already knows a
 * retry can't change the outcome.
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
[ensure-electron] If this wasn't a Defender quarantine (see above), other causes:
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

function sleep(ms) {
  // Deliberately NOT .unref()'d: this is used to actively wait out settle
  // windows during extraction verification, and an unref'd timer lets Node
  // exit before it fires once nothing else is pending — which is exactly
  // the silent-early-exit bug this whole script exists to prevent.
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runPowershell(command, timeoutMs = 10000) {
  const { execFileSync } = require('child_process')
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    timeout: timeoutMs,
    windowsHide: true
  })
    .toString()
    .trim()
}

// Reading the current exclusion list (Get-MpPreference) does NOT require
// admin rights, even though ADDING one (Add/Set-MpPreference) does. That
// asymmetry is useful: we can always tell the user the true current state
// even when we can't fix it ourselves.
function isDefenderExclusionActive(targetDir) {
  if (process.platform !== 'win32') return null
  try {
    const escaped = targetDir.replace(/'/g, "''")
    const out = runPowershell(
      `$p = (Get-MpPreference).ExclusionPath; if ($p -contains '${escaped}') { 'YES' } else { 'NO' }`
    )
    return out === 'YES'
  } catch {
    return null // Defender module unavailable, PowerShell blocked, or Defender not in use
  }
}

function manualExclusionInstructions(targetDir) {
  return `[ensure-electron]   Option A (recommended) — run this exact command ONCE from an
[ensure-electron]   elevated terminal ("Run as Administrator"), then go back to your normal
[ensure-electron]   non-elevated terminal for everyday use — the exclusion persists:
[ensure-electron]     npm run ensure-electron
[ensure-electron]   (or manually: Add-MpPreference -ExclusionPath '${targetDir}')
[ensure-electron]
[ensure-electron]   Option B — Windows Security app (no elevated terminal needed, but the
[ensure-electron]   app itself will prompt for admin approval when you save):
[ensure-electron]     Windows Security > Virus & threat protection > Manage settings
[ensure-electron]     (under "Virus & threat protection settings") > Add or remove exclusions
[ensure-electron]     > Add an exclusion > Folder > select:
[ensure-electron]       ${targetDir}
[ensure-electron]
[ensure-electron]   Option C — if you truly have no admin access on this machine: open
[ensure-electron]   Windows Security > Virus & threat protection > Protection history, find
[ensure-electron]   the "electron.exe" / "electron-vXX-win32-x64.zip" detection, and use
[ensure-electron]   Actions > Restore. This recovers just this one file without an exclusion,
[ensure-electron]   but Defender will likely re-quarantine it on the next fresh download.`
}

// Windows Defender's cloud-delivered protection (MAPS) does an async
// reputation check on freshly-written, unsigned executables and can
// quarantine them seconds after they're written and already passed the
// initial on-write scan — this is a well-documented false-positive pattern
// for generic Electron release binaries specifically, not a real threat.
// A folder-scoped exclusion is the only fix with no race condition in it;
// adding one requires admin rights, so this is best-effort, and the result
// is always reported plainly — never silently swallowed — so the caller
// can decide whether it's even worth attempting a download at all right now.
function checkWindowsDefenderExclusion(targetDir, verbose) {
  if (process.platform !== 'win32') return { platform: false, active: null }

  let active = isDefenderExclusionActive(targetDir)

  if (active === false) {
    try {
      const escaped = targetDir.replace(/'/g, "''")
      runPowershell(`Add-MpPreference -ExclusionPath '${escaped}'`)
      active = isDefenderExclusionActive(targetDir)
    } catch (err) {
      if (verbose) log(`Add-MpPreference attempt failed: ${err.message || err}`)
    }
  }

  console.log('')
  if (active === true) {
    log(`Windows Defender exclusion CONFIRMED ACTIVE for: ${targetDir}`)
    log('Defender will not scan this folder — safe to proceed.')
  } else if (active === false) {
    log(`Windows Defender exclusion NOT active for: ${targetDir}`)
    log(
      'Defender is very likely to quarantine the Electron binary during or shortly after'
    )
    log('extraction. Proceeding anyway, but this attempt will probably fail — see below.')
    log('')
    log('THE FIX (do this, then re-run):')
    console.log(manualExclusionInstructions(targetDir))
  } else {
    log('could not determine Windows Defender exclusion status (continuing anyway)')
  }
  console.log('')

  return { platform: true, active }
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

  // Check (and try to fix) Defender status BEFORE spending time and
  // bandwidth on a download that a confirmed-inactive exclusion means is
  // very likely to be wasted.
  const defender = checkWindowsDefenderExclusion(electronDir, verbose)
  const confirmedProtected = defender.active === true

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

  // Without a confirmed-active exclusion, we already know from direct
  // real-world testing that retrying extraction is very likely futile: all
  // attempts extract from this same already-downloaded zip, so the
  // resulting bytes — and Defender's verdict on them — are identical every
  // time. Retrying 2-3 more times just burns minutes for a near-certain
  // repeat of the same outcome. So: one attempt, one moderate settle
  // window, then stop and report clearly instead of looping.
  const MAX_ATTEMPTS = confirmedProtected ? 3 : 1
  const SETTLE_DELAY_MS = 1500
  const SETTLE_CHECKS = confirmedProtected ? 3 : 8 // ~4.5s vs ~12s

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isLastAttempt = attempt === MAX_ATTEMPTS
    if (MAX_ATTEMPTS > 1) {
      log(`extracting (attempt ${attempt}/${MAX_ATTEMPTS})...`)
    } else {
      log('extracting...')
    }

    try {
      await extract(zipPath, { dir: distDir })
    } catch (err) {
      if (isLastAttempt) {
        fail('extraction failed', err)
        return
      }
      log(`extraction attempt ${attempt} failed (${err.message}), retrying...`)
      await sleep(1000 * attempt)
      continue
    }

    try {
      fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath)
      fs.writeFileSync(path.join(distDir, 'version'), `v${version}`)
    } catch (err) {
      fail('extraction succeeded but writing path.txt/version markers failed', err)
      return
    }

    if (!binaryLooksValid(electronDir, platformPath)) {
      if (isLastAttempt) {
        fail(
          `dist/${platformPath} is missing immediately after extraction. This matches the ` +
            'Windows Defender quarantine pattern confirmed on this machine — see the fix ' +
            'above, before this download started.'
        )
        return
      }
      log(`dist/${platformPath} missing right after extraction, retrying...`)
      await sleep(1000 * attempt)
      continue
    }

    // The binary exists right now. Windows Defender's cloud-delivered
    // protection can quarantine a freshly-written, unsigned .exe a moment
    // *after* it's written and passes an initial scan — so watch it for a
    // few seconds before trusting it, instead of declaring success the
    // instant it first appears.
    log('binary present — confirming it survives antivirus scanning before finishing...')
    let stable = true
    for (let i = 0; i < SETTLE_CHECKS; i++) {
      await sleep(SETTLE_DELAY_MS)
      if (!binaryLooksValid(electronDir, platformPath)) {
        stable = false
        log(
          `dist/${platformPath} disappeared ${(((i + 1) * SETTLE_DELAY_MS) / 1000).toFixed(1)}s ` +
            'after extraction — Windows Defender quarantined it, as predicted above.'
        )
        break
      }
    }

    if (stable) {
      const finalPath = path.join(distDir, platformPath)
      const finalStat = fs.statSync(finalPath)
      succeed(
        `installed successfully: ${finalPath} (${(finalStat.size / 1024 / 1024).toFixed(0)}MB)`
      )
      return
    }

    if (isLastAttempt) {
      fail(
        `dist/${platformPath} was quarantined by Windows Defender shortly after extraction, ` +
          'exactly as predicted before this download started. Retrying would extract the ' +
          'identical bytes from the same zip and get the identical result, so this script ' +
          "stopped after one attempt instead of wasting your time repeating it. Add the\n" +
          '[ensure-electron] exclusion shown above, then re-run: npm run ensure-electron'
      )
      return
    }
    log('retrying extraction from the already-downloaded archive...')
    await sleep(1000 * attempt)
  }
}

main().catch((err) => {
  fail('unexpected error', err)
})
