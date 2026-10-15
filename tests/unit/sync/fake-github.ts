import { toBase64, utf8Size } from '../../../src/integrations/github/client'

/** Artificial private repo, with Contents API response shape and CAS. No network server. */
export class FakeGitHub {
  text: string | null = null
  version = 0
  requests: { url: string; method: string; body?: Record<string, unknown>; headers: Headers }[] = []
  status = 0
  responseHeaders: Record<string, string> = {}
  message = ''
  dropResponse = false
  beforePut?: () => Promise<void>
  beforeGet?: () => Promise<void>
  privateRepo = true
  get sha(): string { return this.version.toString(16).padStart(40, '0') }
  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    const headers = new Headers(init?.headers)
    this.requests.push({ url, method, body, headers })
    if (this.status) return Response.json({ message: this.message }, { status: this.status, headers: this.responseHeaders })
    if (!headers.get('authorization')) return Response.json({ message: 'Bad credentials' }, { status: 401 })
    if (url.endsWith('/repos/example/private-data')) return Response.json({ private: this.privateRepo, full_name: 'example/private-data', default_branch: 'main' })
    if (url.includes('/branches/')) return Response.json({ name: 'main' })
    if (url.includes('/contents?')) return Response.json([])
    if (method === 'GET') {
      await this.beforeGet?.()
      if (this.text === null) return Response.json({ message: 'Not Found' }, { status: 404 })
      if (headers.get('if-none-match') === `"${this.sha}"`) return new Response(null, { status: 304 })
      return Response.json({ type: 'file', encoding: 'base64', path: 'data/state.json', size: utf8Size(this.text), content: toBase64(this.text), sha: this.sha }, { headers: { etag: `"${this.sha}"` } })
    }
    await this.beforePut?.()
    if ((body?.sha ?? null) !== (this.text === null ? null : this.sha)) return Response.json({ message: 'sha does not match' }, { status: 409 })
    this.text = new TextDecoder().decode(Uint8Array.from(atob(String(body?.content)), (c) => c.charCodeAt(0))); this.version++
    if (this.dropResponse) { this.dropResponse = false; throw new TypeError('Simulated response lost') }
    return Response.json({ content: { sha: this.sha, path: 'data/state.json', type: 'file' } }, { status: body?.sha ? 200 : 201 })
  }
}
