import { execFileSync } from 'node:child_process'

// Inspect Git's actual publication candidates, including clean-filtered report blobs.
// Diagnostics never print matched values or file contents.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
const entries = git('ls-files', '--stage', '-z').split('\0').filter(Boolean).map((line) => {
  const [metadata, path] = line.split('\t')
  const [mode, oid, stage] = metadata.split(' ')
  return { mode, oid, stage, path }
})
if (!entries.length) throw new Error('Stage the reviewed release files before running check:public-index.')
const batch = execFileSync('git', ['cat-file', '--batch'], { input: entries.map((entry) => entry.oid).join('\n') + '\n', maxBuffer: 20 * 1024 * 1024 })
const violations = [], groups = {}, files = []
let cursor = 0, totalBytes = 0
const credentialPatterns = [/github_pat_[A-Za-z0-9_]{20,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
for (const entry of entries) {
  const end = batch.indexOf(10, cursor)
  const [, type, sizeText] = batch.subarray(cursor, end).toString('utf8').split(' ')
  const size = Number(sizeText), content = batch.subarray(end + 1, end + 1 + size)
  cursor = end + 1 + size + 1
  const reject = (reason) => violations.push({ file: entry.path, reason })
  if (type !== 'blob' || entry.stage !== '0' || !['100644', '100755'].includes(entry.mode)) reject('non-regular or unmerged publication entry')
  if (/(?:^|\/)(?:node_modules|dist|coverage|data|captures|backups|test-results|playwright-report|browser-profiles|\.auth|\.cache|\.codex|\.agents)(?:\/|$)/i.test(entry.path)) reject('private or generated directory')
  if (/(?:^|\/)\.env(?:\..*)?$/.test(entry.path) && entry.path !== '.env.example') reject('local environment file')
  if (/\.(?:pem|key|p12|pfx|db|sqlite3?|log|tmp|bak)$/i.test(entry.path) || /(?:^|\/)(?:state|.*backup.*)\.json$/i.test(entry.path)) reject('credential, private snapshot or temporary file')
  if (size > 2 * 1024 * 1024) reject('unexpected large source file; review separately')
  if (!entry.path.endsWith('.png')) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    if (credentialPatterns.some((pattern) => pattern.test(text))) reject('credential pattern, value redacted')
    if (/[A-Za-z]:[\\/]Users[\\/][^\s/\\]+/i.test(text) || /\/Users\/[^\s/]+\//.test(text)) reject('local account path')
    if (/[A-Za-z0-9._%+-]+@(?:qq\.com|gmail\.com|outlook\.com|hotmail\.com)\b/i.test(text)) reject('personal email address')
  }
  const group = entry.path.includes('/') ? entry.path.split('/')[0] + '/' : '(root)'
  groups[group] = (groups[group] ?? 0) + 1
  totalBytes += size; files.push({ path: entry.path, bytes: size })
}
if (violations.length) { console.error(JSON.stringify({ status: 'failed', violations }, null, 2)); process.exitCode = 1 }
else console.log(JSON.stringify({ status: 'passed', files: entries.length, totalBytes, groups, largestFiles: files.sort((a, b) => b.bytes - a.bytes).slice(0, 5) }, null, 2))
