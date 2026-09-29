import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'

export const PINS = {
  data: '538b2b167248c648b2198f2c0d56eced10dfc0cf',
  registries: '2240df2376509bfaf12becbb36e156e29f8ecb4d',
  assetsJson: '4ea7e5424848e1bed4e8c059986950bdd0acfb22',
  summary: 'd96c75fec200c4580dd75e033a76341521165461',
} as const

type PinName = keyof typeof PINS
type SourceKind = 'array' | 'record' | 'tree-record' | 'blockstates'
type Source = {
  readonly pin: PinName
  readonly tag: string
  readonly file: string
  readonly kind: SourceKind
}

const jsonArray = Schema.Array(Schema.Unknown)
const jsonRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const tree = Schema.Struct({
  tree: Schema.Array(Schema.Struct({ path: Schema.String, type: Schema.String })),
})

const SOURCES: Readonly<Record<string, Source>> = {
  block: { pin: 'summary', tag: '26.3-summary', file: 'blocks/data.json', kind: 'record' },
  item: { pin: 'registries', tag: '26.3-registries', file: 'item/data.json', kind: 'array' },
  biome: { pin: 'data', tag: '26.3-data', file: 'data/minecraft/worldgen/biome/', kind: 'tree-record' },
  enchantment: { pin: 'summary', tag: '26.3-summary', file: 'data/enchantment/data.json', kind: 'record' },
  recipe: { pin: 'summary', tag: '26.3-summary', file: 'data/recipe/data.json', kind: 'record' },
  'loot-table': { pin: 'summary', tag: '26.3-summary', file: 'data/loot_table/data.json', kind: 'record' },
  tag: { pin: 'summary', tag: '26.3-summary', file: 'data/tag/item/data.json', kind: 'record' },
  'damage-type': { pin: 'registries', tag: '26.3-registries', file: 'damage_type/data.json', kind: 'array' },
  'mob-effect': { pin: 'registries', tag: '26.3-registries', file: 'mob_effect/data.json', kind: 'array' },
  'sound-event': { pin: 'registries', tag: '26.3-registries', file: 'sound_event/data.json', kind: 'array' },
  'block-state': { pin: 'assetsJson', tag: '26.3-assets-json', file: 'assets/minecraft/blockstates/', kind: 'blockstates' },
}

const schemaFor = (source: Source): Schema.Schema.AnyNoContext => source.kind === 'array' ? jsonArray : jsonRecord

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return Object.fromEntries(entries.map(([key, entry]) => [key, stable(entry)]))
  }
  return value
}

export const canonicalJson = (value: unknown): string => `${JSON.stringify(stable(value), null, 2)}\n`

const decodeSchema = (schema: Schema.Schema.AnyNoContext, value: unknown, label: string): unknown => {
  const result = Schema.decodeUnknownEither(schema)(value)
  if (Either.isLeft(result)) throw new Error(`mcmeta ${label} failed schema validation: ${String(result.left)}`)
  return result.right
}

const decode = (source: Source, value: unknown): unknown => decodeSchema(schemaFor(source), value, source.file)

export const decodeJson = (text: string): unknown => {
  try { return JSON.parse(text) } catch (cause) { throw new Error('mcmeta response was not JSON', { cause }) }
}

const fetchRaw = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`mcmeta fetch failed: ${String(response.status)} ${url}`)
  return decodeJson(await response.text())
}

const fetchJson = async (url: string, source: Source): Promise<unknown> => decode(source, await fetchRaw(url))

const fetchTreeRecords = async (source: Source): Promise<unknown> => {
  const treeResponse = await fetchRaw(`https://api.github.com/repos/misode/mcmeta/git/trees/${PINS[source.pin]}?recursive=1`)
  const treeResult = Schema.decodeUnknownEither(tree)(treeResponse)
  if (Either.isLeft(treeResult)) throw new Error(`mcmeta ${source.file} tree failed schema validation: ${String(treeResult.left)}`)
  const files = treeResult.right.tree
    .filter((entry) => entry.type === 'blob' && entry.path.startsWith(source.file) && entry.path.endsWith('.json'))
    .sort((left, right) => left.path.localeCompare(right.path))
  const values = await Promise.all(files.map(async (entry) => [entry.path, decodeSchema(jsonRecord, await fetchRaw(`https://raw.githubusercontent.com/misode/mcmeta/${PINS[source.pin]}/${entry.path}`), entry.path)] as const))
  return Object.fromEntries(values)
}

const fetchSource = async (source: Source): Promise<unknown> => source.kind === 'blockstates' || source.kind === 'tree-record'
  ? fetchTreeRecords(source)
  : fetchJson(`https://raw.githubusercontent.com/misode/mcmeta/${PINS[source.pin]}/${source.file}`, source)

export const generate = async (outDirectory: string, fetcher: (source: Source) => Promise<unknown> = fetchSource): Promise<void> => {
  await mkdir(outDirectory, { recursive: true })
  await Promise.all(Object.entries(SOURCES).map(async ([name, source]) => {
    const value = decode(source, await fetcher(source))
    await writeFile(path.join(outDirectory, `vanilla-${name}.json`), canonicalJson(value), 'utf8')
  }))
}

const outArgument = process.argv.findIndex((argument) => argument === '--out')
const out = outArgument >= 0 ? process.argv[outArgument + 1] : undefined
if (out !== undefined) generate(out).catch((cause: unknown) => { process.stderr.write(`${String(cause)}\n`); process.exitCode = 1 })
