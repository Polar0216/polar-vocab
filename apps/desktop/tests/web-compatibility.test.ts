import { expect, it } from 'vitest'
import { WebCompatibility } from '../src/web-compatibility'

it('gates uploads on the actual public site capability; no credential/header or localhost override', async () => {
  const urls: string[] = [], gate = new WebCompatibility(async (url, options) => { urls.push(String(url)); expect(options?.credentials).toBe('omit'); expect(options?.headers).toBeUndefined(); return Response.json({ format: 'polar-vocab-web-release', version: '0.6.0', captureProtocols: [1, 2], stateProtocols: [1, 2], features: ['context-morphology'] }) })
  await gate.require(); expect(gate.status().verified).toBe(true)
  expect(urls).toEqual(['https://polar0216.github.io/polar-vocab/release.json'])
  const old = new WebCompatibility(async () => Response.json({ format: 'polar-vocab-web-release', version: '0.4.0', captureProtocols: [1], stateProtocols: [1], features: [] }))
  await expect(old.require()).rejects.toThrow('上传暂停')
  const offline = new WebCompatibility(async () => { throw new Error('offline') })
  await expect(offline.require()).rejects.toThrow('队列保留')
})
