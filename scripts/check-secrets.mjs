import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// A deterministic public-tree guard, not a substitute for reviewing unknown private data.
const skip = new Set(['.git', '.cache', 'artifacts', 'node_modules', 'coverage', 'test-results', 'playwright-report'])
const textExtensions = /\.(?:[cm]?[jt]sx?|json|md|html|css|ya?ml|toml|env|txt|csv)$/
const tokenPatterns = [/github_pat_[A-Za-z0-9_]{20,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
const violations = []
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(item.name)) continue
    const path = join(directory, item.name)
    if (item.isDirectory()) {
      if (['data', 'captures', 'backups'].includes(item.name)) violations.push(`${path}: private-data directory`)
      await inspect(path)
    } else if (textExtensions.test(item.name) || item.name.startsWith('.env')) {
      const content = await readFile(path, 'utf8')
      if (tokenPatterns.some((pattern) => pattern.test(content))) violations.push(`${path}: credential pattern (value redacted)`)
      if (item.name.startsWith('.env') && item.name !== '.env.example') violations.push(`${path}: local environment file must never be published`)
    }
  }
}
await inspect('.')
if (violations.length) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else console.log('PASS: public source/build tree has no recognized credential or private-data directory')
