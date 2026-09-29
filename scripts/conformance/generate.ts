import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const PINS = {
  data: '538b2b167248c648b2198f2c0d56eced10dfc0cf',
  registries: '2240df2376509bfaf12becbb36e156e29f8ecb4d',
  assetsJson: '4ea7e5424848e1bed4e8c059986950bdd0acfb22',
  summary: 'd96c75fec200c4580dd75e033a76341521165461',
} as const

type Source = { readonly branch: string; readonly file: string }
const SOURCES: Readonly<Record<string, Source>> = {
  block: { branch: '26.3-summary', file: 'blocks/data.json' },
  item: { branch: '26.3-registries', file: 'item/data.json' },
  biome: { branch: '26.3-registries', file: 'worldgen/biome/data.json' },
  enchantment: { branch: '26.3-summary', file: 'data/enchantment/data.json' },
  recipe: { branch: '26.3-summary', file: 'data/recipe/data.json' },
  'loot-table': { branch: '26.3-summary', file: 'data/loot_table/data.json' },
  tag: { branch: '26.3-summary', file: 'data/tag/item/data.json' },
  'damage-type': { branch: '26.3-registries', file: 'damage_type/data.json' },
  'mob-effect': { branch: '26.3-registries', file: 'mob_effect/data.json' },
  'sound-event': { branch: '26.3-registries', file: 'sound_event/data.json' },
  'block-state': { branch: '26.3-assets-json', file: 'assets/minecraft/blockstates/air.json' },
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return Object.fromEntries(entries.map(([key, entry]) => [key, stable(entry)]))
  }
  return value
}

export const canonicalJson = (value: unknown): string => `${JSON.stringify(stable(value), null, 2)}\n`

export const decodeJson = (text: string): unknown => {
  try { return JSON.parse(text) } catch (cause) { throw new Error('mcmeta response was not JSON', { cause }) }
}

const fetchSource = async (source: Source): Promise<unknown> => {
  const response = await fetch(`https://raw.githubusercontent.com/misode/mcmeta/${source.branch}/${source.file}`)
  if (!response.ok) throw new Error(`mcmeta fetch failed: ${String(response.status)} ${source.branch}/${source.file}`)
  return decodeJson(await response.text())
}

export const generate = async (outDirectory: string, fetcher: (source: Source) => Promise<unknown> = fetchSource): Promise<void> => {
  await mkdir(outDirectory, { recursive: true })
  for (const [name, source] of Object.entries(SOURCES)) {
    const value = await fetcher(source)
    await writeFile(path.join(outDirectory, `vanilla-${name}.json`), canonicalJson(value), 'utf8')
  }
}

const outArgument = process.argv.findIndex((argument) => argument === '--out')
const out = outArgument >= 0 ? process.argv[outArgument + 1] : undefined
if (out !== undefined) generate(out).catch((cause: unknown) => { process.stderr.write(`${String(cause)}\n`); process.exitCode = 1 })
