import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as Schema from 'effect/Schema'

export const PINS = {
  data: '538b2b167248c648b2198f2c0d56eced10dfc0cf',
  registries: '2240df2376509bfaf12becbb36e156e29f8ecb4d',
  assetsJson: '4ea7e5424848e1bed4e8c059986950bdd0acfb22',
  summary: 'd96c75fec200c4580dd75e033a76341521165461',
} as const

// SHA-256 of each `vanilla-<name>.json` generated from PINS. The golden files are
// vanilla-derived data and are not committed, so this table is what pins their
// content. When PINS change, the mismatch error reports the new actual hashes.
export const EXPECTED_SHA256: Readonly<Record<string, string>> = {
  biome: '3aa23765748208a535c4dbc681d39fca2a559332933de379f3a0d6339d0c3371',
  'block-state': '5957fe8c956c5b01a6795c1304b27c7c3a9279b00393b1e36af4823bf9fbca4f',
  block: '8eda5632c5af023acbaa286e55b3e43627974deedfba716cac3020132cb0948d',
  'damage-type': 'f628aa52d8203ee32e4bfb44e7445b74e930d447c014cff3383b2ac3c8adbd31',
  enchantment: 'a158492b8677a88f02b599540129bba588a2dead84f42c14d7936a7fb8a96dd7',
  item: '9c564cecf0358caaaa03e5b6501174a2879331e86d2820e2c475a24465f2f9cc',
  'loot-table': 'e13064b2b52a52d5505e181676d7df0cc1be7478f97b5b521dae32835515407d',
  'mob-effect': 'cca53935b2e8ab143e8d76242408e2eed6aac40347edc1f4fcbeb887f5ca38a7',
  recipe: 'f1d2e3c21e30ff0187e7ba4b45b7165536e5b303bd7ef4858dcc5c04b661d701',
  'sound-event': 'a7bb03c745e8fa3928f7a14886b1759008e9b0f52c2f583005829189ffac7808',
  tag: 'cd6b463583aa7379b340636ffa3ae62b97b2dc723fabb54bfec36a2b9d27e446',
}

// The two tree sources expand to about 1350 raw blobs; this bounds how many
// requests are in flight at once across all sources.
const MAX_CONCURRENT_REQUESTS = 12

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
  truncated: Schema.Boolean,
  tree: Schema.Array(Schema.Struct({ path: Schema.String, type: Schema.String })),
})

export const SOURCES: Readonly<Record<string, Source>> = {
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
  if (result._tag === 'Left') throw new Error(`mcmeta ${label} failed schema validation: ${String(result.left)}`)
  return result.right
}

const decode = (source: Source, value: unknown): unknown => decodeSchema(schemaFor(source), value, source.file)

export const decodeJson = (text: string): unknown => {
  try { return JSON.parse(text) } catch (cause) { throw new Error('mcmeta response was not JSON', { cause }) }
}

let activeRequests = 0
const waitingRequests: Array<() => void> = []

// A released slot is handed directly to the next waiter, so a caller arriving
// between the release and the waiter's resumption cannot exceed the bound.
const withRequestSlot = async <A>(task: () => Promise<A>): Promise<A> => {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) await new Promise<void>((resolve) => { waitingRequests.push(resolve) })
  else activeRequests += 1
  try {
    return await task()
  } finally {
    const next = waitingRequests.shift()
    if (next === undefined) activeRequests -= 1
    else next()
  }
}

// GITHUB_TOKEN only raises the api.github.com rate limit; it is never sent to
// raw.githubusercontent.com.
const headersFor = (url: string): Record<string, string> => {
  const token = process.env['GITHUB_TOKEN']
  return new URL(url).hostname === 'api.github.com' && token !== undefined && token !== ''
    ? { Authorization: `Bearer ${token}` }
    : {}
}

const fetchRaw = (url: string): Promise<unknown> => withRequestSlot(async () => {
  const response = await fetch(url, { headers: headersFor(url) })
  if (!response.ok) throw new Error(`mcmeta fetch failed: ${String(response.status)} ${url}`)
  return decodeJson(await response.text())
})

const fetchJson = async (url: string, source: Source): Promise<unknown> => decode(source, await fetchRaw(url))

const fetchTreeRecords = async (source: Source): Promise<unknown> => {
  const treeResponse = await fetchRaw(`https://api.github.com/repos/misode/mcmeta/git/trees/${PINS[source.pin]}?recursive=1`)
  const treeResult = Schema.decodeUnknownEither(tree)(treeResponse)
  if (treeResult._tag === 'Left') throw new Error(`mcmeta ${source.file} tree failed schema validation: ${String(treeResult.left)}`)
  if (treeResult.right.truncated) throw new Error(`mcmeta ${source.file} tree listing was truncated by the GitHub API`)
  const files = treeResult.right.tree
    .filter((entry) => entry.type === 'blob' && entry.path.startsWith(source.file) && entry.path.endsWith('.json'))
    .sort((left, right) => left.path.localeCompare(right.path))
  const values = await Promise.all(files.map(async (entry) => [entry.path, decodeSchema(jsonRecord, await fetchRaw(`https://raw.githubusercontent.com/misode/mcmeta/${PINS[source.pin]}/${entry.path}`), entry.path)] as const))
  return Object.fromEntries(values)
}

export const fetchSource = async (source: Source): Promise<unknown> => source.kind === 'blockstates' || source.kind === 'tree-record'
  ? fetchTreeRecords(source)
  : fetchJson(`https://raw.githubusercontent.com/misode/mcmeta/${PINS[source.pin]}/${source.file}`, source)

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

const existingSha256 = async (file: string): Promise<string | undefined> => {
  try {
    return sha256(await readFile(file))
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
    throw cause
  }
}

type GoldenStatus = 'fetched' | 'reused'

// A destination file is either already verified (reused) or replaced only by
// output whose hash matched, written to a temporary file and renamed into place.
const generateOne = async (
  outDirectory: string,
  name: string,
  source: Source,
  fetcher: (source: Source) => Promise<unknown>,
  expected: Readonly<Record<string, string>>,
): Promise<GoldenStatus> => {
  const file = path.join(outDirectory, `vanilla-${name}.json`)
  const expectedHash = expected[name]
  if (expectedHash === undefined) throw new Error(`${file}: no expected SHA-256`)
  if (await existingSha256(file) === expectedHash) return 'reused'
  const text = canonicalJson(decode(source, await fetcher(source)))
  const actualHash = sha256(text)
  if (actualHash !== expectedHash) throw new Error(`${file}: SHA-256 mismatch, expected ${expectedHash}, actual ${actualHash}`)
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, file)
  } catch (cause) {
    await rm(temporary, { force: true })
    throw cause
  }
  return 'fetched'
}

export const generate = async (
  outDirectory: string,
  fetcher: (source: Source) => Promise<unknown> = fetchSource,
  expected: Readonly<Record<string, string>> = EXPECTED_SHA256,
): Promise<Readonly<Record<string, GoldenStatus>>> => {
  await mkdir(outDirectory, { recursive: true })
  const results = await Promise.allSettled(Object.entries(SOURCES).map(async ([name, source]) => [name, await generateOne(outDirectory, name, source, fetcher, expected)] as const))
  const failures = results.flatMap((result) => result.status === 'rejected' ? [String(result.reason)] : [])
  if (failures.length > 0) throw new Error(`golden generation failed for ${String(failures.length)} file(s):\n${failures.join('\n')}`)
  return Object.fromEntries(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
}

const outArgument = process.argv.findIndex((argument) => argument === '--out')
const out = outArgument >= 0 ? process.argv[outArgument + 1] : undefined
if (outArgument >= 0 && out === undefined) {
  process.stderr.write('--out requires a directory\n')
  process.exitCode = 1
}
if (out !== undefined) {
  generate(out)
    .then((statuses) => { for (const [name, status] of Object.entries(statuses)) process.stdout.write(`vanilla-${name}.json: ${status}\n`) })
    .catch((cause: unknown) => { process.stderr.write(`${String(cause)}\n`); process.exitCode = 1 })
}
