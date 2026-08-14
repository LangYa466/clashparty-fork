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

// release 資產由 build.yml 的 windows job 非同步上傳（需等 3 個 arch 都打包完），
// 發布剛建立時可能還沒就緒，重試等待最多約 30 分鐘。
async function fetchRelease(attempts = 120, delayMs = 15000) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/v${version}`
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers })
    if (res.ok) {
      return await res.json()
    }
    console.log(
      `Release v${version} not ready yet (${res.status}), retrying in ${delayMs / 1000}s...`
    )
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error(`Release v${version} not found after ${attempts} attempts`)
}

function sha256FromAsset(release, assetName) {
  const asset = release.assets?.find((item) => item.name === assetName)
  return asset?.digest?.match(/^sha256:([a-f\d]{64})$/i)?.[1]?.toLowerCase()
}

async function sha256FromShaFile(assetName) {
  const shaUrl = `https://github.com/${repo}/releases/download/v${version}/${assetName}.sha256`
  const res = await fetch(shaUrl)
  if (!res.ok) throw new Error(`Failed to fetch ${shaUrl}: ${res.status}`)
  return (await res.text()).trim().split(/\s+/)[0].toLowerCase()
}

const release = await fetchRelease()

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const archSuffix = { '64bit': 'x64', '32bit': 'ia32', arm64: 'arm64' }

for (const [arch, suffix] of Object.entries(archSuffix)) {
  const assetName = `clash-party-windows-${version}-${suffix}-portable.7z`
  const digest = sha256FromAsset(release, assetName)
  manifest.architecture[arch].hash = digest ?? (await sha256FromShaFile(assetName))
  if (!manifest.architecture[arch].hash) {
    throw new Error(`Missing sha256 for ${assetName}`)
  }
  console.log(`${arch} ${assetName} -> ${manifest.architecture[arch].hash}`)
}

manifest.version = version
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Updated ${manifestPath} to v${version}`)
