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
      calls.push(`${source.branch}/${source.file}`)
      return { source: source.file, values: ['fixture'] }
    })
    expect(calls).toHaveLength(11)
    const generated = await readFile(path.join(output, 'vanilla-block.json'), 'utf8')
    expect(generated).toBe(canonicalJson(decodeJson(generated)))
    expect(generated).toContain('blocks/data.json')
    await rm(output, { recursive: true, force: true })
  })
})
