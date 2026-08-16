import { readFileSync, writeFileSync } from 'fs'

const version = process.argv[2]
if (!version) {
  console.error('Usage: node scripts/scoop-update-manifest.mjs <version>')
  process.exit(1)
}

const repo = process.env.GITHUB_REPOSITORY || 'LangYa466/clashparty-fork'
const token = process.env.GITHUB_TOKEN || ''
const manifestPath = 'scoop/clash-party.json'

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'clash-party-release'
}
if (token) {
  headers.Authorization = `Bearer ${token}`
}

const archSuffix = { '64bit': 'x64', '32bit': 'ia32', arm64: 'arm64' }

function assetNameFor(version, suffix) {
  return `clash-party-windows-${version}-${suffix}-portable.7z`
}

function urlLineFor(version, suffix) {
  return `      "url": "https://github.com/${repo}/releases/download/v${version}/clash-party-windows-${version}-${suffix}-portable.7z",`
}

// build.yml 各平台 job 非同步上傳資產：macos 先發佈建立 release，
// windows 的 portable.7z 會晚到。必須等三個 arch 的資產都上傳完、
// digest 都齊了才寫入 manifest，只等 release 存在會抓不到 404。
async function waitForAssets(attempts = 120, delayMs = 15000) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/v${version}`
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers })
    if (res.ok) {
      const release = await res.json()
      const digests = {}
      for (const [arch, suffix] of Object.entries(archSuffix)) {
        const match = release.assets
          ?.find((item) => item.name === assetNameFor(version, suffix))
          ?.digest?.match(/^sha256:([a-f\d]{64})$/i)
        if (match) digests[arch] = match[1].toLowerCase()
      }
      if (Object.keys(digests).length === Object.keys(archSuffix).length) {
        return digests
      }
      console.log('Windows portable assets not fully uploaded yet, retrying...')
    } else {
      console.log(
        `Release v${version} not ready yet (${res.status}), retrying in ${delayMs / 1000}s...`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error(`Windows portable assets for v${version} not ready after ${attempts} attempts`)
}

const digests = await waitForAssets()

// 逐行替換保留原本排版，避免 JSON.stringify 重排造成無謂 diff。
const lines = readFileSync(manifestPath, 'utf8').split('\n')

const autoupdateIdx = lines.findIndex((line) => line.startsWith('  "autoupdate"'))
if (autoupdateIdx === -1) throw new Error('Cannot locate autoupdate section')
const mainSection = lines.slice(0, autoupdateIdx)

for (const [arch, suffix] of Object.entries(archSuffix)) {
  const urlIdx = mainSection.findIndex(
    (line) => line.includes('clash-party-windows-') && line.includes(`-${suffix}-portable.7z`)
  )
  if (urlIdx === -1 || !lines[urlIdx + 1]?.includes('"hash":')) {
    throw new Error(`Cannot locate hash line for ${arch}`)
  }
  lines[urlIdx] = urlLineFor(version, suffix)
  lines[urlIdx + 1] = lines[urlIdx + 1].replace(/[a-f0-9]{64}/, digests[arch])
  console.log(`${arch} ${assetNameFor(version, suffix)} -> ${digests[arch]}`)
}

const versionIdx = lines.findIndex((line) => line.startsWith('  "version":'))
if (versionIdx === -1) throw new Error('Cannot locate version field')
lines[versionIdx] = `  "version": "${version}",`

writeFileSync(manifestPath, lines.join('\n'))
console.log(`Updated ${manifestPath} to v${version}`)
