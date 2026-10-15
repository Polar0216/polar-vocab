import { describe, expect, it } from 'vitest'
import { ApiError, GitHubClient, fromBase64, toBase64, MAX_REMOTE_BYTES } from '../../../src/integrations/github/client'
import { FakeGitHub } from './fake-github'
const target = { owner: 'example', repository: 'private-data', branch: 'main', path: 'data/state.json' as const }
describe('GitHub REST adapter', () => {
  it('verifies private access, creates without SHA, updates with SHA and validates cached ETag', async () => {
    const fake = new FakeGitHub(), client = new GitHubClient('artificial-session-value', fake.fetch)
    await client.verify(target); expect(await client.get(target)).toBeNull()
    const created = await client.put(target, '中文 Grüße', null)
    expect(fake.requests.at(-1)?.body).not.toHaveProperty('sha')
    await client.get(target); await client.get(target)
    expect(fake.requests.at(-1)?.headers.get('if-none-match')).toBe(`"${created.sha}"`)
    await client.put(target, 'next', created.sha)
    expect(fake.requests.at(-1)?.body?.sha).toBe(created.sha)
    expect(fake.requests.every((request) => !request.url.includes('artificial-session-value'))).toBe(true)
    expect(fromBase64(toBase64('Grüße 中文'))).toBe('Grüße 中文')
    client.clear(); await expect(client.get(target)).rejects.toMatchObject({ code: 'unauthorized' })
  })
  it.each([[401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [409, 'sha-conflict'], [422, 'validation'], [429, 'rate-limited'], [500, 'server'], [503, 'server']])('classifies %s without exposing response secrets', async (status, code) => {
    const fake = new FakeGitHub(); fake.status = Number(status); fake.message = 'private sensitive body'; const client = new GitHubClient('artificial-session-value', fake.fetch)
    await expect(client.verify(target)).rejects.toMatchObject({ code }); try { await client.verify(target) } catch (error) { expect(String(error)).not.toContain(fake.message) }
    expect(fake.requests.length).toBeLessThanOrEqual(2)
  })
  it('distinguishes secondary and primary limits with Retry-After and reset', async () => {
    for (const headers of [{ 'retry-after': '120' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 180) }]) {
      const fake = new FakeGitHub(); fake.status = 403; fake.message = 'secondary rate limit'; fake.responseHeaders = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) as Record<string, string>
      try { await new GitHubClient('artificial', fake.fetch).verify(target); throw new Error('expected limit') } catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).retryAt).toBeGreaterThan(Date.now() + 110_000) }
    }
  })
  it('rejects public repository, oversize files and unverified writes', async () => {
    const fake = new FakeGitHub(); fake.privateRepo = false; const client = new GitHubClient('artificial', fake.fetch)
    await expect(client.verify(target)).rejects.toMatchObject({ code: 'forbidden' }); await expect(client.put(target, '{}', null)).rejects.toMatchObject({ code: 'forbidden' })
    fake.privateRepo = true; await client.verify(target); await expect(client.put(target, 'x'.repeat(MAX_REMOTE_BYTES + 1), null)).rejects.toMatchObject({ code: 'capacity' })
  })
  it('classifies aborted timeout, network failure and ambiguous PUT response', async () => {
    const client = new GitHubClient('artificial', async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('internal')))), 5)
    await expect(client.verify(target)).rejects.toMatchObject({ code: 'timeout' })
    const broken = new GitHubClient('artificial', async () => { throw new TypeError('contains credential') })
    await expect(broken.verify(target)).rejects.toMatchObject({ code: 'network' })
    const fake = new FakeGitHub(), writer = new GitHubClient('artificial', fake.fetch); await writer.verify(target); fake.dropResponse = true
    await expect(writer.put(target, '{}', null)).rejects.toMatchObject({ code: 'network', uncertain: true }); expect(fake.text).toBe('{}')
  })
  it('bounds response bodies and times out a stalled body after successful headers', async () => {
    const stalled = new GitHubClient('artificial', async () => new Response(new ReadableStream()), 5)
    await expect(stalled.verify(target)).rejects.toMatchObject({ code: 'timeout' })
    const oversized = new GitHubClient('artificial', async () => new Response('x'.repeat(2_000_001)))
    await expect(oversized.verify(target)).rejects.toMatchObject({ code: 'capacity' })
  })
})
