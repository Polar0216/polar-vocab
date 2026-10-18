import { fromBase64, toBase64 } from '../../src/integrations/github/client'

/** Artificial in-process GitHub shape; no network, credentials or existing fixtures. */
export class CaptureGitHubFake {
  files = new Map<string, { text: string; sha: string }>()
  writes: string[] = []
  loseNextResponse = false
  truncated = false
  publicRepository = false
  failStatus = 0
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? 'GET'
    const send = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (this.failStatus) return send({ message: 'Artificial failure' }, this.failStatus)
    if (path === '/repos/capture-test/data') return send({ private: !this.publicRepository, full_name: 'capture-test/data', default_branch: 'main' })
    if (path.endsWith('/branches/main')) return send({ commit: { commit: { tree: { sha: 'a'.repeat(40) } } } })
    if (path === '/repos/capture-test/data/contents') return send([])
    if (path.includes('/git/trees/')) return send({ truncated: this.truncated, tree: [...this.files].map(([file, value]) => ({ path: file, sha: value.sha, size: new TextEncoder().encode(value.text).length, type: 'blob' })) })
    const file = path.split('/contents/')[1]
    if (!file) return send({ message: 'not found' }, 404)
    if (method === 'PUT') {
      const body = JSON.parse(String(init!.body)) as { sha?: string; content: string }
      if (body.sha || this.files.has(file)) return send({ message: 'already exists' }, 409)
      this.writes.push(file)
      const value = { text: fromBase64(body.content), sha: (this.files.size + 1).toString(16).padStart(40, '0') }
      this.files.set(file, value)
      if (this.loseNextResponse) { this.loseNextResponse = false; throw new TypeError('Artificial lost response') }
      return send({ content: { sha: value.sha } }, 201)
    }
    const value = this.files.get(file)
    return value ? send({ type: 'file', path: file, size: new TextEncoder().encode(value.text).length, sha: value.sha, encoding: 'base64', content: toBase64(value.text) }) : send({ message: 'not found' }, 404)
  }
}
