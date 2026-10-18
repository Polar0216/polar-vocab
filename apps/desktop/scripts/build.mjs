import { build as bundle } from 'esbuild'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve('apps/desktop'), output = join(root, 'build')
await mkdir(join(output, 'native'), { recursive: true })
if (process.platform !== 'win32') throw new Error('原生选区助手必须在Windows上构建；Web构建不依赖此命令。')
const framework = join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319')
const assemblies = join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/assembly/GAC_MSIL')
const identity = 'v4.0_4.0.0.0__31bf3856ad364e35'
execFileSync(join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${join(output, 'native/SelectionHelper.exe')}`,
  `/reference:${join(assemblies, 'UIAutomationClient', identity, 'UIAutomationClient.dll')}`,
  `/reference:${join(assemblies, 'UIAutomationTypes', identity, 'UIAutomationTypes.dll')}`,
  `/reference:${join(framework, 'WPF/WindowsBase.dll')}`, '/reference:System.Web.Extensions.dll', join(root, 'native/SelectionHelper.cs')], { stdio: 'inherit', windowsHide: true })
const main = await bundle({ entryPoints: [join(root, 'src/main.ts')], outfile: join(output, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'node:sqlite'], sourcemap: false, logLevel: 'info', metafile: true })
await bundle({ entryPoints: [join(root, 'src/preload.ts')], outfile: join(output, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], logLevel: 'info' })
await viteBuild({ configFile: false, root: join(root, 'renderer'), base: './', plugins: [react()], build: { outDir: join(output, 'renderer'), emptyOutDir: true } })
// Keep the original 512px project icon; electron-builder generates Windows icon sizes.
await copyFile('public/pwa-512.png', join(output, 'icon.png'))
const names = new Set(['react', 'react-dom', 'scheduler'])
for (const input of Object.keys(main.metafile.inputs)) {
  const part = input.replaceAll('\\', '/').split('/node_modules/').at(-1)
  if (!input.replaceAll('\\', '/').includes('node_modules/')) continue
  const segments = part.replace(/^node_modules\//, '').split('/')
  names.add(segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0])
}
let notices = 'Polar Vocab Capture - bundled third-party notices\nElectron / Chromium notices are also distributed beside the executable.\n'
for (const name of [...names].sort()) {
  const directory = resolve('node_modules', name), metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  notices += `\n===== ${name} ${metadata.version} (${metadata.license}) =====\n`
  const files = (await readdir(directory)).filter(file => /^(licen[cs]e|notice)(\.|$)/i.test(file))
  if (!files.length) throw new Error('Missing bundled dependency license: ' + name)
  for (const file of files) notices += '\n' + await readFile(join(directory, file), 'utf8') + '\n'
}
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), notices)
