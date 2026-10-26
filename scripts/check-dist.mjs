import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const base = process.argv[2] ?? '/polar-vocab/'
assert.match(base, /^\/(?:[A-Za-z0-9_-]+\/)*$/)
const root = resolve('dist')
const html = await readFile(resolve(root, 'index.html'), 'utf8')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'))
for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], base, key)
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.lang, 'zh-CN')
for (const icon of manifest.icons) {
  assert.ok(icon.src.startsWith(base), icon.src)
  const file = await readFile(resolve(root, icon.src.slice(base.length)))
  assert.equal(file.readUInt32BE(16), Number(icon.sizes.split('x')[0]))
  assert.equal(file.readUInt32BE(20), Number(icon.sizes.split('x')[1]))
}
assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'))
for (const [, asset] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(asset.startsWith(base), `Incorrect HTML asset path: ${asset}`)
  await readFile(resolve(root, asset.slice(base.length)))
}
const sw = await readFile(resolve(root, 'sw.js'), 'utf8')
const release = JSON.parse(await readFile(resolve(root, 'release.json'), 'utf8'))
assert.equal(release.format, 'polar-vocab-web-release')
assert.deepEqual(release.captureProtocols, [1, 2])
assert.deepEqual(release.stateProtocols, [1, 2])
assert.ok(release.features.includes('context-morphology'), 'Missing integrated receiver capability')
assert.ok(!sw.includes('release.json'), 'Compatibility check must use the current network release metadata')
assert.ok(sw.includes('index.html'), 'Missing offline shell')
assert.ok(sw.includes('SKIP_WAITING'), 'Missing explicit update handshake')
assert.ok(!sw.includes('api.github.com'), 'SW must not cache GitHub API')
const scripts = (await readdir(resolve(root, 'assets'))).filter((name) => name.endsWith('.js'))
assert.ok((await Promise.all(scripts.map((name) => readFile(resolve(root, 'assets', name), 'utf8')))).some((content) => content.includes(`${base}sw.js`)), 'Incorrect SW registration path')
console.log(`PASS: ${base} HTML assets, manifest, PNG sizes, SW registration and offline shell`)
