import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { canonicalJson, decodeJson, EXPECTED_SHA256, fetchSource, generate, SOURCES } from '../scripts/conformance/generate'

type Source = (typeof SOURCES)[string]

const fixture = (source: Source): unknown => source.kind === 'array' ? ['fixture'] : { [source.file]: { fixture: true } }
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const fixtureHashes: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SOURCES).map(([name, source]) => [name, sha256(canonicalJson(fixture(source)))]),
)
const exists = (file: string): Promise<boolean> => access(file).then(() => true, () => false)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('conformance golden generator', () => {
  it('decodes and serialises fixture data deterministically', () => {
    const value = decodeJson('{"z":1,"a":[{"b":2,"a":true}]}')
    expect(canonicalJson(value)).toBe('{\n  "a": [\n    {\n      "a": true,\n      "b": 2\n    }\n  ],\n  "z": 1\n}\n')
  })

  it('round-trips all golden categories without network access', async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), 'mc-dev-meta-conformance-'))
    const calls: string[] = []
    await generate(output, async (source) => {
      calls.push(`${source.tag}/${source.file}`)
      return fixture(source)
    }, fixtureHashes)
    expect(calls).toHaveLength(11)
    const generated = await readFile(path.join(output, 'vanilla-block.json'), 'utf8')
    expect(generated).toBe(canonicalJson(decodeJson(generated)))
    expect(generated).toContain('blocks/data.json')
    await rm(output, { recursive: true, force: true })
  })

  it('rejects malformed JSON shapes before writing a golden', async () => {
    expect(() => decodeJson('{')).toThrow('not JSON')
    const output = await mkdtemp(path.join(os.tmpdir(), 'mc-dev-meta-conformance-invalid-'))
    await expect(generate(output, async () => 'malformed')).rejects.toThrow('schema validation')
    await rm(output, { recursive: true, force: true })
  })

  it('keeps the pinned category counts in the fetched golden set', async () => {
    const expected: Readonly<Record<string, number>> = {
      block: 1286,
      item: 1658,
      biome: 67,
      enchantment: 43,
      recipe: 2042,
      'loot-table': 1447,
      tag: 236,
      'damage-type': 51,
      'mob-effect': 40,
      'sound-event': 1991,
      'block-state': 1288,
    }
    const counts = await Promise.all(Object.entries(expected).map(async ([name, count]) => {
      const value = JSON.parse(await readFile(path.join(process.cwd(), 'test/golden', `vanilla-${name}.json`), 'utf8'))
      return [name, Object.keys(value).length, count] as const
    }))
    for (const [name, actual, count] of counts) expect(actual, name).toBe(count)
  })

  it('pins an expected SHA-256 for every source', () => {
    expect(Object.keys(EXPECTED_SHA256).sort()).toEqual(Object.keys(SOURCES).sort())
    for (const hash of Object.values(EXPECTED_SHA256)) expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a hash mismatch without leaving the destination file', async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), 'mc-dev-meta-conformance-mismatch-'))
    const wrong = { ...fixtureHashes, item: '0'.repeat(64) }
    const failure = generate(output, async (source) => fixture(source), wrong)
    await expect(failure).rejects.toThrow(`vanilla-item.json: SHA-256 mismatch, expected ${'0'.repeat(64)}, actual ${fixtureHashes['item'] ?? ''}`)
    expect(await exists(path.join(output, 'vanilla-item.json'))).toBe(false)
    expect(await exists(path.join(output, 'vanilla-block.json'))).toBe(true)
    expect((await readdir(output)).filter((file) => file.endsWith('.tmp'))).toEqual([])
    await rm(output, { recursive: true, force: true })
  })

  it('reuses a verified file and replaces a corrupted one', async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), 'mc-dev-meta-conformance-reuse-'))
    await generate(output, async (source) => fixture(source), fixtureHashes)
    const itemFile = path.join(output, 'vanilla-item.json')
    const verified = await readFile(itemFile, 'utf8')
    await writeFile(itemFile, `${verified} `, 'utf8')
    const calls: string[] = []
    const statuses = await generate(output, async (source) => {
      calls.push(source.file)
      return fixture(source)
    }, fixtureHashes)
    expect(calls).toEqual([SOURCES['item']?.file])
    expect(statuses['item']).toBe('fetched')
    expect(statuses['block']).toBe('reused')
    expect(await readFile(itemFile, 'utf8')).toBe(verified)
    await rm(output, { recursive: true, force: true })
  })

  it('rejects a truncated tree listing', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ truncated: true, tree: [] })))
    const biome = SOURCES['biome']
    if (biome === undefined) throw new Error('biome source missing')
    await expect(fetchSource(biome)).rejects.toThrow('tree listing was truncated')
  })

  it('bounds concurrent requests and sends GITHUB_TOKEN only to api.github.com', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
    const requests: Array<readonly [string, string | null]> = []
    let active = 0
    let peak = 0
    const blobs = Array.from({ length: 40 }, (_, index) => ({ path: `data/minecraft/worldgen/biome/b${String(index)}.json`, type: 'blob' }))
    vi.stubGlobal('fetch', async (url: string, init: { readonly headers: Record<string, string> }) => {
      requests.push([new URL(url).hostname, init.headers['Authorization'] ?? null])
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => { setTimeout(resolve, 1) })
      active -= 1
      return new Response(JSON.stringify(url.startsWith('https://api.github.com/') ? { truncated: false, tree: blobs } : { fixture: true }))
    })
    const biome = SOURCES['biome']
    if (biome === undefined) throw new Error('biome source missing')
    const value = await fetchSource(biome)
    expect(Object.keys(Object(value))).toHaveLength(40)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(12)
    expect(requests.filter(([host]) => host === 'api.github.com')).toEqual([['api.github.com', 'Bearer test-token']])
    expect(requests.filter(([host]) => host === 'raw.githubusercontent.com')).toEqual(Array.from({ length: 40 }, () => ['raw.githubusercontent.com', null]))
  })
})
