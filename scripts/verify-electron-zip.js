#!/usr/bin/env node
/**
 * Optional companion to the manual Windows setup path in ensure-electron.js.
 *
 * Verifies a manually-downloaded Electron release zip against the official
 * checksum bundled with the electron npm package, BEFORE you extract it —
 * confirms you downloaded the genuine, unmodified file without needing this
 * script to touch the network or spawn anything. Pure local file hashing via
 * Node's built-in crypto module.
 *
 * Usage: npm run verify-electron-zip -- "C:\path\to\electron-vX-win32-x64.zip"
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { zipFileName, expectedZipChecksum } = require('./ensure-electron')

function log(msg) {
  console.log(`[verify-electron-zip] ${msg}`)
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function main() {
  const zipPath = process.argv[2]
  if (!zipPath) {
    console.error('[verify-electron-zip] Usage: npm run verify-electron-zip -- "<path-to-zip>"')
    process.exit(1)
  }

  let stat
  try {
    stat = fs.statSync(zipPath)
  } catch (err) {
    console.error(`[verify-electron-zip] Cannot read ${zipPath}: ${err.message}`)
    process.exit(1)
  }

  const electronDir = path.dirname(require.resolve('electron/package.json'))
  const { version } = require('electron/package.json')
  const os = require('os')
  const platform = process.env.npm_config_platform || os.platform()
  const arch = process.env.npm_config_arch || os.arch()

  const expectedName = zipFileName(version, platform, arch)
  const actualName = path.basename(zipPath)
  if (actualName !== expectedName) {
    log(`WARNING: filename is "${actualName}", expected "${expectedName}" for this project's`)
    log(`electron ${version} on ${platform}-${arch}. Checking the hash anyway.`)
  }

  const expected = expectedZipChecksum(electronDir, version, platform, arch)
  if (!expected) {
    console.error(
      `[verify-electron-zip] No known checksum for ${expectedName} in this project's ` +
        'checksums.json — cannot verify.'
    )
    process.exit(1)
  }

  log(`hashing ${zipPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)...`)
  const actual = await sha256File(zipPath)

  if (actual.toLowerCase() === expected.toLowerCase()) {
    log('MATCH — this is the genuine, unmodified official Electron release zip.')
    log('Safe to extract into node_modules\\electron\\dist, then run: npm run dev')
    process.exit(0)
  } else {
    console.error('[verify-electron-zip] MISMATCH — do not extract this file.')
    console.error(`[verify-electron-zip]   expected: ${expected}`)
    console.error(`[verify-electron-zip]   actual:   ${actual}`)
    console.error('[verify-electron-zip] Re-download from the official URL and try again.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[verify-electron-zip] unexpected error:', err.stack || err.message || err)
  process.exit(1)
})
