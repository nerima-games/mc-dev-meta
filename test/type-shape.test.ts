/**
 * Tests for `domain/type-shape.ts`.
 *
 * Every fixture here is a string. Nothing in this file reads `repos/`, for the
 * same reason `test/sync-plan.test.ts` verifies every git action without
 * invoking git: a test that needs fifteen clones is a test that does not run.
 *
 * The two fixtures that matter most are the TWO SPELLINGS OF A UNION. tsc's
 * declaration emit writes `} | {` inline; a human writes a leading `|` on its
 * own line. Both appear in this workspace, on opposite sides of the same
 * comparison, and a parser that reads only one of them would silently compare
 * three variants against one.
 */
import { describe, expect, it } from 'vitest'
import {
  blankCommentsAndStrings,
  declaredTypes,
  describeShapeError,
  parseApiLock,
  publishedNames,
  typesInApiLock,
  type TypeShape,
} from '../src/domain/type-shape'

const shapeOf = (text: string, name: string): TypeShape => {
  const parsed = declaredTypes(text)
  if (!parsed.ok) {
    throw new Error(`fixture did not parse: ${parsed.error.name}`)
  }
  const shape = parsed.value.get(name)
  if (shape === undefined) {
    throw new Error(`fixture declares no type named ${name}`)
  }
  return shape
}

const memberNames = (shape: TypeShape, arm = 0): ReadonlyArray<string> =>
  (shape.variants[arm]?.members ?? []).map((member) => member.name)

describe('blanking comments and strings', () => {
  it('preserves length, so an index into the blanked text means the same thing in the original', () => {
    const text = "const a = 'hello' // trailing\n/* block */ const b = `x${1}y`\n"

    expect(blankCommentsAndStrings(text)).toHaveLength(text.length)
  })

  it('preserves newlines, because a member declaration is anchored to a line start', () => {
    const text = '/**\n * one\n * two\n */\ntype A = { a: 1 }\n'
    const blanked = blankCommentsAndStrings(text)

    expect(blanked.split('\n')).toHaveLength(text.split('\n').length)
  })

  // REGRESSION — every declaration in these repositories carries an essay above
  // it, and those essays contain braces and quotes. A parser that counted them
  // would find its members inside a doc comment.
  it('removes braces that live inside comments', () => {
    const text = '/** looks like { a: 1 } but is prose */\ntype A = { real: 1 }\n'

    expect(memberNames(shapeOf(text, 'A'))).toStrictEqual(['real'])
  })

  it('removes braces that live inside template literals', () => {
    const text = 'const message = `must be in [0, ${max}]`\ntype A = { real: 1 }\n'

    expect(memberNames(shapeOf(text, 'A'))).toStrictEqual(['real'])
  })

  // REGRESSION: an escaped quote does not end the string. Without this, a
  // string like 'it\'s fine' would be read as closing after `it`, and
  // everything from the `s` onward — including any brace in the rest of the
  // file — would be read as ordinary code instead of blanked.
  it('does not end a string literal early on an escaped quote', () => {
    const text = "const s = 'it\\'s fine'\ntype A = { real: 1 }\n"

    expect(memberNames(shapeOf(text, 'A'))).toStrictEqual(['real'])
  })

  // The escape-and-newline case: a backslash line continuation inside a
  // string. Length must still be preserved across it (both blanked
  // characters emitted), and the newline itself must survive so a member
  // anchored to a line start later in the same string's line does not shift.
  it('preserves length and the newline across a backslash line-continuation inside a string', () => {
    const text = "const s = 'a\\\nb'\ntype A = { real: 1 }\n"
    const blanked = blankCommentsAndStrings(text)

    expect(blanked).toHaveLength(text.length)
    expect(memberNames(shapeOf(text, 'A'))).toStrictEqual(['real'])
  })

  // A template literal can legitimately span several lines with no escape at
  // all — the newline is a real character inside the string, not a
  // continuation — and it must be preserved the same way.
  it('preserves a newline that appears literally inside a template literal', () => {
    const text = 'const s = `a\nb`\ntype A = { real: 1 }\n'
    const blanked = blankCommentsAndStrings(text)

    expect(blanked.split('\n')).toHaveLength(text.split('\n').length)
    expect(memberNames(shapeOf(text, 'A'))).toStrictEqual(['real'])
  })
})

describe('reading a plain object type', () => {
  const source = [
    'export type ClockService = {',
    '  /** Monotonic reading. */',
    '  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>',
    '  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>',
    '}',
    '',
  ].join('\n')

  it('reads member names', () => {
    expect(memberNames(shapeOf(source, 'ClockService'))).toStrictEqual([
      'monotonicSecs',
      'wallClockEpochMillis',
    ])
  })

  it('records that the declaration was exported', () => {
    expect(shapeOf(source, 'ClockService').exported).toBe(true)
    expect(shapeOf('type Private = { a: 1 }\n', 'Private').exported).toBe(false)
  })

  it('sorts members, because their order in an object type is not semantic', () => {
    const reordered = [
      'export type ClockService = {',
      '  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>',
      '  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>',
      '}',
    ].join('\n')

    expect(memberNames(shapeOf(reordered, 'ClockService'))).toStrictEqual(
      memberNames(shapeOf(source, 'ClockService')),
    )
  })

  // Defensive: the sort comparator's tie-break (equal names) has nothing real
  // to exercise it — TypeScript itself would reject two members of the same
  // name — but this parser is text-based and does not know that, so a
  // duplicate key must still sort stably rather than the comparator
  // mis-signalling on the equal case.
  it('does not crash or reorder unstably when two members share a name', () => {
    const text = ['export type Dup = {', '  readonly a: 1', '  readonly a: 2', '}'].join('\n')

    expect(memberNames(shapeOf(text, 'Dup'))).toStrictEqual(['a', 'a'])
  })

  it('reads optionality, which is semantic', () => {
    const text = [
      'export type ChunkNeighbours = {',
      '  readonly xPos?: Chunk',
      '  readonly xNeg: Chunk',
      '}',
    ].join('\n')
    const members = shapeOf(text, 'ChunkNeighbours').variants[0]?.members ?? []

    expect(members).toStrictEqual([
      { name: 'xNeg', optional: false },
      { name: 'xPos', optional: true },
    ])
  })

  // A generic argument list contains commas and a `>`; a parser that split on
  // separators rather than anchoring to line starts would tear it apart.
  it('is not confused by commas inside a generic argument list', () => {
    const text = [
      'export interface StageRegistration {',
      '  readonly id: StageId',
      '  readonly after?: ReadonlyArray<StageId>',
      '  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>',
      '}',
    ].join('\n')

    expect(memberNames(shapeOf(text, 'StageRegistration'))).toStrictEqual(['after', 'id', 'run'])
  })

  it('does not read the members of a nested object type as its own', () => {
    const text = [
      'export type Outer = {',
      '  readonly inner: {',
      '    readonly hidden: number',
      '  }',
      '}',
    ].join('\n')

    expect(memberNames(shapeOf(text, 'Outer'))).toStrictEqual(['inner'])
  })

  it('reads an interface with generic parameters that have defaults', () => {
    const text = [
      'export interface GameModule<ROut, E, RIn, RRegister = never> {',
      '  readonly layers: Layer.Layer<ROut, E, RIn>',
      '  readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>',
      '}',
    ].join('\n')

    expect(memberNames(shapeOf(text, 'GameModule'))).toStrictEqual(['frameStages', 'layers'])
  })

  it('skips nested generic parameter lists before reading the declaration body', () => {
    const text = [
      'export interface Registry<T extends Map<string, Array<number>>> {',
      '  readonly value: T',
      '}',
    ].join('\n')

    expect(memberNames(shapeOf(text, 'Registry'))).toStrictEqual(['value'])
  })

  // REGRESSION: a generic parameter's default can itself be a function type,
  // whose `=>` must not be read as closing the parameter list on its `>`.
  it('is not confused by an arrow function type inside a generic default', () => {
    const text = [
      'export type Middleware<T = (input: string) => number> = {',
      '  readonly run: T',
      '}',
    ].join('\n')

    expect(memberNames(shapeOf(text, 'Middleware'))).toStrictEqual(['run'])
  })
})

describe('reading a discriminated union in both of the spellings this workspace produces', () => {
  const handWritten = [
    'export type BlockReading =',
    "  | { readonly _tag: 'Block'; readonly block: BlockId }",
    "  | { readonly _tag: 'ChunkNotLoaded' }",
    "  | { readonly _tag: 'OutOfWorld' }",
    '',
  ].join('\n')

  const emitted = [
    'type BlockReading = {',
    "    readonly _tag: 'Block';",
    '    readonly block: BlockId;',
    '} | {',
    "    readonly _tag: 'ChunkNotLoaded';",
    '} | {',
    "    readonly _tag: 'OutOfWorld';",
    '};',
  ].join('\n')

  // REGRESSION — the whole point. The mirror is written by hand with a leading
  // `|`; the source's api-lock.md is written by tsc with `} | {`. Reading only
  // the first arm of either would compare three variants against one and call
  // it agreement.
  it('reads every arm of the hand-written spelling', () => {
    const shape = shapeOf(handWritten, 'BlockReading')

    expect(shape.variants.map((variant) => variant.tag)).toStrictEqual([
      'Block',
      'ChunkNotLoaded',
      'OutOfWorld',
    ])
  })

  it('reads every arm of the tsc declaration-emit spelling', () => {
    const shape = shapeOf(emitted, 'BlockReading')

    expect(shape.variants.map((variant) => variant.tag)).toStrictEqual([
      'Block',
      'ChunkNotLoaded',
      'OutOfWorld',
    ])
  })

  it('reads the same members from both spellings, which is what makes them comparable', () => {
    const byTag = (shape: TypeShape, tag: string): ReadonlyArray<string> =>
      (shape.variants.find((variant) => variant.tag === tag)?.members ?? []).map(
        (member) => member.name,
      )

    expect(byTag(shapeOf(handWritten, 'BlockReading'), 'Block')).toStrictEqual(['_tag', 'block'])
    expect(byTag(shapeOf(emitted, 'BlockReading'), 'Block')).toStrictEqual(['_tag', 'block'])
  })
})

describe('declarations that are not object types', () => {
  // REGRESSION — the silent-pass hole. A brand, an alias or `never` has no
  // members, and DROPPING it from the result would mean a mirror that declared
  // `type Foo = SomeAlias` where the source declares an object type was
  // compared against nothing and reported as agreeing. It is kept, with no
  // arms, so that domain/mirror-contract.ts can say so.
  it('keeps a brand, with no arms', () => {
    const shape = shapeOf("export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>\n", 'DeltaTimeSecs')

    expect(shape.variants).toStrictEqual([])
  })

  it('keeps a bare alias, with no arms', () => {
    expect(shapeOf('export type FrameServices = never\n', 'FrameServices').variants).toStrictEqual([])
  })

  it('does not let a non-object declaration swallow the declaration that follows it', () => {
    const text = ['export type FrameServices = never', '', 'export type Position = { x: 1 }'].join('\n')

    expect(shapeOf(text, 'FrameServices').variants).toStrictEqual([])
    expect(memberNames(shapeOf(text, 'Position'))).toStrictEqual(['x'])
  })

  it('reads the object half of a branded primitive', () => {
    const shape = shapeOf("type ChunkKey = string & {\n    readonly _tag: 'ChunkKey';\n};\n", 'ChunkKey')

    expect(memberNames(shape)).toStrictEqual(['_tag'])
  })

  it('reports an unbalanced body rather than guessing', () => {
    const parsed = declaredTypes('export type Broken = {\n  readonly a: 1\n')

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : describeShapeError(parsed.error)).toContain('"Broken" is never closed')
  })

  // REGRESSION: a non-object operand can itself contain parens or brackets —
  // a function type, a tuple — before the union's next `|`. Those must be
  // stepped over as a unit rather than mistaken for the separator search
  // finding nothing, or for the `{` of an object arm.
  it('steps over a parenthesised function type and a tuple before the next union arm', () => {
    const text = [
      'export type Handler =',
      '  | ((input: [string, number]) => void)',
      "  | { readonly _tag: 'Noop' }",
      '',
    ].join('\n')

    const shape = shapeOf(text, 'Handler')
    expect(shape.variants.map((variant) => variant.tag)).toStrictEqual(['Noop'])
  })

  // REGRESSION: a bare alias with no trailing newline at all — the last line
  // of a file that does not end in one — must still be read as a
  // zero-operand declaration rather than running off the end of the text.
  it('reads a bare alias that ends the file with no trailing newline', () => {
    const shape = shapeOf('export type FrameServices = never', 'FrameServices')
    expect(shape.variants).toStrictEqual([])
  })

  // REGRESSION: only TOP-LEVEL declarations are part of the surface this tool
  // compares. A `type` nested inside a function body is scratch, not a
  // published shape, and reading it would let an unrelated local alias
  // collide with a real top-level type of the same name.
  it('ignores a type declared inside a function body', () => {
    const text = [
      'export type Position = { x: 1 }',
      '',
      'function helper() {',
      '  type Position = { y: 2 }',
      '  return null',
      '}',
    ].join('\n')

    expect(memberNames(shapeOf(text, 'Position'))).toStrictEqual(['x'])
  })

  // REGRESSION: a `type` keyword with no `=` after it (truncated source, or a
  // generic parameter list that never closes) must be skipped rather than
  // read as declaring an alias to whatever text happens to follow.
  it('ignores a type declaration with no generic list ever closed', () => {
    const text = ['export type Broken<T', '', 'export type Position = { x: 1 }'].join('\n')

    const parsed = declaredTypes(text)
    if (!parsed.ok) {
      throw new Error('fixture did not parse')
    }
    expect(parsed.value.has('Broken')).toBe(false)
    expect(memberNames(shapeOf(text, 'Position'))).toStrictEqual(['x'])
  })

  // REGRESSION: an `interface` heading with no body brace anywhere in the
  // REST of the file (truncated source) must be skipped, the same way a
  // `type` with no `=` is. `Position` is placed BEFORE `Broken` here on
  // purpose: the search for `{` scans forward from the heading, so a brace
  // earlier in the file must not be mistaken for this declaration's body.
  it('ignores a trailing interface declaration with no opening brace anywhere after it', () => {
    const text = ['export type Position = { x: 1 }', '', 'export interface Broken extends Bar'].join(
      '\n',
    )

    const parsed = declaredTypes(text)
    if (!parsed.ok) {
      throw new Error('fixture did not parse')
    }
    expect(parsed.value.has('Broken')).toBe(false)
    expect(memberNames(shapeOf(text, 'Position'))).toStrictEqual(['x'])
  })
})

describe('reading a committed api-lock.md', () => {
  const lock = [
    '# API lock — @nerima-games/mc-kernel',
    '',
    'format: 1',
    '',
    '## Exported',
    '',
    '### AIR_BLOCK_ID  `const`',
    '',
    '```ts',
    'const AIR_BLOCK_ID: BlockId;',
    '```',
    '',
    '### ClockService  `type`',
    '',
    '```ts',
    'type ClockService = {',
    '    readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>;',
    '    readonly wallClockEpochMillis: Effect.Effect<EpochMillis>;',
    '};',
    '```',
    '',
    '### DeltaTimeSecs  `type`',
    '',
    '```ts',
    "type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>;",
    '```',
    '',
  ].join('\n')

  it('reads every entry with its kind and its rendered text', () => {
    const entries = parseApiLock(lock)

    expect(entries.map((entry) => `${entry.name}:${entry.kind}`)).toStrictEqual([
      'AIR_BLOCK_ID:const',
      'ClockService:type',
      'DeltaTimeSecs:type',
    ])
  })

  it('exposes every published name, whatever its kind', () => {
    expect([...publishedNames(lock)].sort()).toStrictEqual([
      'AIR_BLOCK_ID',
      'ClockService',
      'DeltaTimeSecs',
    ])
  })

  it('turns the type entries into shapes with the same parser the mirror side uses', () => {
    const parsed = typesInApiLock(lock)
    if (!parsed.ok) {
      throw new Error('fixture did not parse')
    }

    expect(memberNames(parsed.value.get('ClockService') as TypeShape)).toStrictEqual([
      'monotonicSecs',
      'wallClockEpochMillis',
    ])
    expect(parsed.value.get('DeltaTimeSecs')?.variants).toStrictEqual([])
    expect(parsed.value.has('AIR_BLOCK_ID')).toBe(false)
  })

  // REGRESSION: `typesInApiLock` runs `declaredTypes` per entry and must not
  // swallow a failure from one entry's fenced block — a generated file this
  // broken is itself the finding, not something to silently skip past.
  it('propagates a parse failure from a single entry rather than skipping it', () => {
    const broken = [
      '# API lock — @nerima-games/mc-kernel',
      '',
      'format: 1',
      '',
      '### Broken  `type`',
      '',
      '```ts',
      'type Broken = {',
      '  readonly a: 1',
      '```',
      '',
    ].join('\n')

    const parsed = typesInApiLock(broken)
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error.name).toBe('Broken')
  })
})
