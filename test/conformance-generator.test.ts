import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { canonicalJson, decodeJson, generate } from '../scripts/conformance/generate'

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
      return source.kind === 'array' ? ['fixture'] : { [source.file]: { fixture: true } }
    })
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

  it('keeps the pinned category counts in the committed golden set', async () => {
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
})
