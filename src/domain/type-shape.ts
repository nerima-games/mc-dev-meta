/**
 * Reading the SHAPE of a declared object type out of TypeScript text, and out
 * of a committed `api-lock.md`. PURE — no filesystem, no compiler, no
 * dependencies.
 *
 * ---------------------------------------------------------------------------
 * Why `api-lock.md` is the source of truth for the type half
 * ---------------------------------------------------------------------------
 *
 * `domain/mirror-comparison.ts` compares a hand-written mirror against the
 * repository it mirrors. Values can be compared by importing both and looking
 * at them. Types cannot: they are gone at runtime, and mc-dev-meta has no
 * business type-checking fifteen repositories it did not build.
 *
 * There are two candidate sources of truth for a source repository's types:
 *
 *   A. RE-DERIVE from its TypeScript. That means a `ts.Program` per repository,
 *      which needs each clone's `node_modules` installed (`effect`'s own
 *      declarations resolve from there), takes seconds per repository, and
 *      produces a SECOND opinion about what the public surface is.
 *
 *   B. READ THE COMMITTED `api-lock.md`. Each repository already generates one
 *      with `scripts/api-lock.ts`: tsc's own declaration emit, doc comments
 *      stripped, entries sorted by name, `pnpm api:check` failing the build
 *      when it is stale. It is a file, it is committed, and it is already the
 *      artefact a human reviews when the surface moves.
 *
 * B, for four reasons that are not about speed:
 *
 *   1. IT IS ALREADY GUARANTEED FRESH BY SOMEONE ELSE. `pnpm api:check` runs in
 *      the source repository's own `verify`. mc-dev-meta inherits that guarantee
 *      instead of re-establishing it, and cannot disagree with it.
 *   2. IT IS THE PUBLISHED SURFACE, AND THAT IS EXACTLY WHAT THE MIRROR IS
 *      STANDING IN FOR. Every mirror header says the same thing: when the source
 *      is published, delete this file and repoint the import at the package.
 *      What the import will then resolve to is the barrel — i.e. `api-lock.md`.
 *      A symbol mirrored from a source module that the barrel does not re-export
 *      is a mirror of something that will never be importable, and reading
 *      `api-lock.md` makes that a finding rather than a surprise on the day of
 *      the swap.
 *   3. ONE RENDERING, BOTH SIDES. `api-lock.md` holds ordinary TypeScript inside
 *      a fenced block, so the same parser below reads the source side and the
 *      mirror side. Two parsers would be two chances to disagree for reasons
 *      that have nothing to do with drift.
 *   4. NO INSTALL REQUIRED. A freshly cloned `repos/` can be checked before
 *      `pnpm install` has ever run in it. (The VALUE half does need the install;
 *      see `scripts/check-mirrors.ts` on why that half degrades to a skip.)
 *
 * ---------------------------------------------------------------------------
 * What this parser reads, and what it deliberately does not
 * ---------------------------------------------------------------------------
 *
 * It reads MEMBER NAMES and whether each member is OPTIONAL. It does not read
 * member TYPES, and that is a decision rather than a shortcut.
 *
 * Mirrors in this organisation diverge from their sources on purpose, and
 * always in the member-type position: `mx-gameplay`'s `WorldgenChunk.biomes` is
 * `ReadonlyArray<string>` where mc-worldgen's `Chunk.biomes` is
 * `ReadonlyArray<BiomeType>`, because mx-gameplay must not invent a second
 * biome vocabulary; the same file's `BlockId` is deliberately unbranded. Each
 * widening is documented in the mirror and is in the safe direction. A checker
 * that compared type text would report all of them, every run, forever — and a
 * report that is mostly known-good noise is a report nobody reads, which is the
 * failure mode this whole exercise exists to avoid.
 *
 * Member NAMES have no such problem. They are the half that carries the defect
 * this project has actually produced: a `ClockService` mirrored with one field
 * where the source has two. Effect resolves a `Context.Tag` by its textual key,
 * so a `Layer` built against the one-field mirror satisfies the two-field tag
 * and the missing field reads `undefined` in a repository that never saw the
 * mirror. Nothing in any single repository's compiler can see that. A missing
 * name can.
 *
 * ---------------------------------------------------------------------------
 * Known limits, none of which can produce a SILENT pass
 * ---------------------------------------------------------------------------
 *
 * The governing rule for every limit below is the one api-extractor was
 * rejected for in `scripts/api-lock.ts`: a report that certifies that nothing
 * happened is worse than no report. So a declaration this parser cannot read as
 * an object type is recorded WITH ZERO ARMS rather than dropped, and
 * `domain/mirror-comparison.ts` turns "the mirror has no comparable shape where
 * the source has one" into a finding.
 *
 * - Only a plain object type, a union of them, and an intersection containing
 *   one are read. `Readonly<{ ... }>`, mapped types and conditional types are
 *   not — they appear as zero arms, which is visible rather than silent.
 * - Regular-expression literals are not distinguished from division. A `/` in a
 *   type declaration would confuse the comment scanner. No mirror contains one;
 *   if one appears, the result is a garbled parse that produces findings, not
 *   silence.
 * - A member declared across several lines whose continuation line begins with
 *   `identifier:` at brace depth 0 would be read as a second member. Again: a
 *   spurious finding, not a silent pass.
 */

/** One member of an object type. `optional` is the `?`, which is semantic. */
export type TypeMember = {
  readonly name: string
  readonly optional: boolean
}

/**
 * One arm of a declaration.
 *
 * A plain object type has exactly one, with no tag. A discriminated union —
 * `BlockReading`, `BlockWriteOutcome` — has one per arm, keyed by its `_tag`
 * string literal. Both spellings of a union have to be read, because the two
 * sides are written by different authors:
 *
 *   the mirror, by hand:      tsc declaration emit, in api-lock.md:
 *     type X =                  type X = {
 *       | { _tag: 'A'; ... }         readonly _tag: 'A';
 *       | { _tag: 'B' }              ...
 *                                } | {
 *                                    readonly _tag: 'B';
 *                                };
 *
 * Reading only the first arm would be the worst possible outcome: three
 * variants would compare equal to one, and a mirror that had silently dropped
 * `OutOfWorld` — the arm whose whole purpose is that it is NOT air — would pass.
 */
export type TypeVariant = {
  /** The `_tag` string literal, or `undefined` when the arm is not tagged. */
  readonly tag: string | undefined
  /** Sorted by name. Order in an object type is not semantic; a diff on it would be noise. */
  readonly members: ReadonlyArray<TypeMember>
}

/** One object type, reduced to the part that can be compared across repositories. */
export type TypeShape = {
  readonly name: string
  /** `type` or `interface`. Recorded but never compared — the two are the same shape. */
  readonly declaredAs: 'type' | 'interface'
  /**
   * Whether the declaration carried `export`.
   *
   * Recorded so that the MIRROR side can be narrowed to its exported types: a
   * mirror's private helper type is nobody else's business and would otherwise
   * be reported as absent from the source. `api-lock.md` renders declarations
   * WITHOUT the keyword — everything in it is exported by construction — so the
   * source side never filters on this.
   */
  readonly exported: boolean
  /** One entry for a plain object type; one per arm for a union. Never empty. */
  readonly variants: ReadonlyArray<TypeVariant>
}

export type ShapeError = { readonly _tag: 'UnterminatedBody'; readonly name: string }

export type ShapeResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: ShapeError }

const shapeOk = <A>(value: A): ShapeResult<A> => ({ ok: true, value })
const shapeFail = <A>(error: ShapeError): ShapeResult<A> => ({ ok: false, error })

/**
 * Blank out comments and string bodies, PRESERVING LENGTH AND NEWLINES.
 *
 * Length preservation is load-bearing: `declaredObjectTypes` computes brace
 * depth on the blanked text and then slices the ORIGINAL, so every index has to
 * mean the same thing in both. Newlines are preserved because a member
 * declaration is anchored to the start of a line.
 *
 * Comments must go because every file here carries a long essay above each
 * declaration, and those essays contain braces and quotes. String bodies must
 * go because `Brand.error(\`... ${value}\`)` puts braces inside a literal.
 */
export const blankCommentsAndStrings = (text: string): string => {
  const out: Array<string> = []
  let state: 'code' | 'line' | 'block' | 'string' = 'code'
  let quote = ''
  let index = 0

  while (index < text.length) {
    const character = text.charAt(index)
    const next = text.charAt(index + 1)

    if (state === 'code') {
      if (character === '/' && next === '/') {
        state = 'line'
        out.push(' ', ' ')
        index += 2
        continue
      }
      if (character === '/' && next === '*') {
        state = 'block'
        out.push(' ', ' ')
        index += 2
        continue
      }
      if (character === "'" || character === '"' || character === '`') {
        state = 'string'
        quote = character
        out.push(' ')
        index += 1
        continue
      }
      out.push(character)
      index += 1
      continue
    }

    if (state === 'line') {
      if (character === '\n') {
        state = 'code'
        out.push('\n')
        index += 1
        continue
      }
      out.push(' ')
      index += 1
      continue
    }

    if (state === 'block') {
      if (character === '*' && next === '/') {
        state = 'code'
        out.push(' ', ' ')
        index += 2
        continue
      }
      out.push(character === '\n' ? '\n' : ' ')
      index += 1
      continue
    }

    // Inside a string literal.
    if (character === '\\' && index + 1 < text.length) {
      out.push(' ', next === '\n' ? '\n' : ' ')
      index += 2
      continue
    }
    if (character === quote) {
      state = 'code'
      out.push(' ')
      index += 1
      continue
    }
    out.push(character === '\n' ? '\n' : ' ')
    index += 1
  }

  return out.join('')
}

/**
 * Nesting depth of `{`, `[` and `(` BEFORE each index, over blanked text.
 *
 * Angle brackets are deliberately not counted. `Effect.Effect<void, never, R>`
 * would need `=>` disambiguated from `>`, and nothing below needs it: members
 * are located by a line-start anchor, never by splitting on a separator that
 * could appear inside a generic argument list.
 */
const depthMap = (blanked: string): ReadonlyArray<number> => {
  const depths: Array<number> = Array.from({ length: blanked.length }, () => 0)
  let depth = 0
  for (let index = 0; index < blanked.length; index += 1) {
    depths[index] = depth
    const character = blanked.charAt(index)
    if (character === '{' || character === '[' || character === '(') {
      depth += 1
    } else if (character === '}' || character === ']' || character === ')') {
      depth -= 1
    }
  }
  return depths
}

/**
 * A member declaration: start of a line (or just after a `;`), an optional
 * `readonly`, a name, an optional `?`, a colon.
 *
 * The body handed to this is prefixed with a newline so that a member sharing
 * the opening brace's line is still anchored.
 */
const MEMBER_ANCHOR = /[\n;][ \t]*(?:readonly[ \t]+)?([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*(\??)[ \t]*:/gu

const membersOf = (body: string): ReadonlyArray<TypeMember> => {
  const anchored = `\n${body}`
  const blanked = blankCommentsAndStrings(anchored)
  const depths = depthMap(blanked)
  const found: Array<TypeMember> = []

  for (const match of blanked.matchAll(MEMBER_ANCHOR)) {
    const at = match.index
    if (depths[at] !== 0) {
      continue
    }
    const name = match[1]
    // Structurally unreachable: MEMBER_ANCHOR's name group is a mandatory
    // (non-optional) pattern, so a successful match has always captured it.
    // TypeScript's regex typing does not encode "this group is unconditional".
    /* v8 ignore next 3 -- @preserve */
    if (name === undefined) {
      continue
    }
    found.push({ name, optional: match[2] === '?' })
  }

  return [...found].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * The `_tag` discriminant of one union arm, read from the ORIGINAL text.
 *
 * Not from the blanked text, for the obvious reason: the discriminant IS a
 * string literal, and blanking is what removes string literals.
 */
const TAG_LITERAL = /(?:^|[\n;{])[ \t]*(?:readonly[ \t]+)?_tag[ \t]*:[ \t]*(['"])([^'"]*)\1/u

const tagOf = (body: string): string | undefined => TAG_LITERAL.exec(body)?.[2]

/** A declaration header: `export`?, `declare`?, keyword, name. */
const DECLARATION =
  /(?:^|\n)[ \t]*(export[ \t]+)?(?:declare[ \t]+)?(type|interface)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)/gu

/** Index of the `}` matching the `{` at `openIndex`, or `undefined`. */
const matchingBrace = (blanked: string, openIndex: number): number | undefined => {
  let depth = 0
  for (let index = openIndex; index < blanked.length; index += 1) {
    const character = blanked.charAt(index)
    if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }
  return undefined
}

/**
 * Step over a generic parameter list, if one starts at `index`.
 *
 * `=>` is skipped as a unit so that `<T = (a: A) => B>` does not close the list
 * on the arrow's `>`. This is the one place angle brackets have to be counted;
 * everywhere else the parser is anchored rather than balanced.
 */
const skipGenerics = (blanked: string, index: number): number => {
  if (blanked.charAt(index) !== '<') {
    return index
  }
  let depth = 0
  let cursor = index
  while (cursor < blanked.length) {
    const character = blanked.charAt(cursor)
    if (character === '=' && blanked.charAt(cursor + 1) === '>') {
      cursor += 2
      continue
    }
    if (character === '<') {
      depth += 1
    } else if (character === '>') {
      depth -= 1
      if (depth === 0) {
        return cursor + 1
      }
    }
    cursor += 1
  }
  return cursor
}

const skipBlank = (blanked: string, index: number): number => {
  let cursor = index
  while (cursor < blanked.length && /\s/u.test(blanked.charAt(cursor))) {
    cursor += 1
  }
  return cursor
}

/**
 * Advance past one non-brace operand of a type expression.
 *
 * Stops at a `|`, `&`, `;` or `{` at depth 0, and at a NEWLINE, which is what
 * bounds the declaration: `type FrameServices = never` must not run on into
 * whatever is declared next. Continuation across lines is still possible,
 * because the caller skips whitespace before looking for a separator, and no
 * declaration in TypeScript begins with `|` or `&`.
 */
const skipOperand = (blanked: string, index: number): number => {
  let depth = 0
  let cursor = index
  while (cursor < blanked.length) {
    const character = blanked.charAt(cursor)
    if (depth === 0 && (character === '|' || character === '&' || character === ';' || character === '{' || character === '\n')) {
      return cursor
    }
    if (character === '(' || character === '[' || character === '{') {
      depth += 1
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1
    }
    cursor += 1
  }
  return cursor
}

/**
 * Read the object-typed operands of a type expression starting at `index`.
 *
 * `|` and `&` are treated alike, and non-brace operands are stepped over, so
 * all four spellings this workspace produces are read by one function:
 *
 *   { ... }                                a plain object type
 *   { ... } | { ... }                      tsc declaration emit's union
 *   \n  | { ... }\n  | { ... }             the hand-written union
 *   string & { readonly _tag: 'ChunkKey' } a branded primitive
 *
 * and `never`, `number & Brand.Brand<'X'>` and every other non-object type
 * yield zero arms — which is recorded rather than discarded; see `declaredTypes`.
 */
const readVariantBodies = (
  blanked: string,
  index: number,
): { readonly bodies: ReadonlyArray<readonly [number, number]>; readonly unterminated: boolean } => {
  const bodies: Array<readonly [number, number]> = []
  let cursor = index
  // Alternating, so that an operand ending at a newline cannot slide into the
  // NEXT declaration: after an operand only a separator continues the type.
  let expecting: 'operand' | 'separator' = 'operand'

  for (;;) {
    cursor = skipBlank(blanked, cursor)
    const character = blanked.charAt(cursor)

    if (character === '|' || character === '&') {
      cursor += 1
      expecting = 'operand'
      continue
    }

    if (expecting === 'separator' || character === '' || character === ';') {
      return { bodies, unterminated: false }
    }

    if (character === '{') {
      const closeIndex = matchingBrace(blanked, cursor)
      if (closeIndex === undefined) {
        return { bodies, unterminated: true }
      }
      bodies.push([cursor + 1, closeIndex])
      cursor = closeIndex + 1
      expecting = 'separator'
      continue
    }

    const next = skipOperand(blanked, cursor)
    // Structurally unreachable: `cursor` reaches here only after `skipBlank`
    // has consumed all whitespace (including '\n') and the '|', '&', ';', '{'
    // and empty-string cases above have all been ruled out, so the character
    // `skipOperand` starts on can never be one of ITS OWN depth-0 stop
    // characters — it always advances by at least one position.
    /* v8 ignore next 3 -- @preserve */
    if (next <= cursor) {
      return { bodies, unterminated: false }
    }
    cursor = next
    expecting = 'separator'
  }
}

/**
 * Every top-level `type` and `interface` declared in a chunk of TypeScript, by
 * name.
 *
 * A declaration with no object-typed arm — `type FrameServices = never`,
 * `type BlockId = number & Brand.Brand<'BlockId'>` — IS INCLUDED, with an empty
 * `variants`. It would have been simpler to drop it, and that would have been
 * the silent-pass bug this whole module is written against: a mirror that
 * declared `type Foo = SomeAlias` where the source declares an object type
 * would then be compared against nothing and reported as agreeing. Keeping the
 * empty shape lets `domain/mirror-comparison.ts` say so out loud.
 *
 * Brands are the case where an empty `variants` is genuinely right, and they
 * lose nothing by it: the VALUE half of the mirror check runs their refinement
 * predicates, which is far more than any text comparison could establish.
 */
export const declaredTypes = (text: string): ShapeResult<ReadonlyMap<string, TypeShape>> => {
  const blanked = blankCommentsAndStrings(text)
  const depths = depthMap(blanked)
  const shapes = new Map<string, TypeShape>()

  for (const match of blanked.matchAll(DECLARATION)) {
    const exported = match[1] !== undefined
    const keyword = match[2]
    const name = match[3]
    // Structurally unreachable: DECLARATION's keyword and name groups are
    // both mandatory (non-optional) patterns, so a successful match has
    // always captured both. TypeScript's regex typing does not encode "this
    // group is unconditional".
    /* v8 ignore next 3 -- @preserve */
    if (keyword === undefined || name === undefined) {
      continue
    }
    // Only top-level declarations. A `type` inside a namespace or a function
    // body is not part of any surface this tool compares.
    /* v8 ignore next -- @preserve */
    if ((depths[match.index] ?? 0) !== 0) {
      continue
    }

    let cursor = skipGenerics(blanked, skipBlank(blanked, match.index + match[0].length))

    if (keyword === 'type') {
      cursor = skipBlank(blanked, cursor)
      if (blanked.charAt(cursor) !== '=') {
        continue
      }
      cursor += 1
    } else {
      // `interface X extends Y {` — everything up to the first brace is
      // heritage, which this tool does not compare.
      const brace = blanked.indexOf('{', cursor)
      if (brace === -1) {
        continue
      }
      cursor = brace
    }

    const { bodies, unterminated } = readVariantBodies(blanked, cursor)
    if (unterminated) {
      return shapeFail({ _tag: 'UnterminatedBody', name })
    }

    shapes.set(name, {
      name,
      declaredAs: keyword === 'interface' ? 'interface' : 'type',
      exported,
      variants: bodies.map(([from, to]) => {
        const body = text.slice(from, to)
        return { tag: tagOf(body), members: membersOf(body) }
      }),
    })
  }

  return shapeOk(shapes)
}

export const describeShapeError = (error: ShapeError): string =>
  `the body of "${error.name}" is never closed; the file is not balanced.`

// ---------------------------------------------------------------------------
// api-lock.md
// ---------------------------------------------------------------------------

/** One entry of a repository's committed API lock. */
export type ApiLockEntry = {
  readonly name: string
  /** `type`, `const`, `interface`, `class`, ... — as the lock renders it. */
  readonly kind: string
  /** The TypeScript inside the fenced block, verbatim. */
  readonly text: string
}

const ENTRY_HEADING = /^### ([^\s]+)[ \t]+`([^`]+)`[ \t]*$/u

/**
 * Read a committed `api-lock.md`.
 *
 * The format is fixed by `scripts/api-lock.ts` (`format: 1`): a `### Name
 * \`kind\`` heading followed by a ```` ```ts ```` fenced block. Nothing here
 * interprets the TypeScript — that is `declaredObjectTypes`' job — so this
 * stays a small, exact reader of a generated file.
 *
 * A name may appear twice with different kinds; `DeltaTimeSecs` is a `type` and
 * a `const` in every one of the fifteen. Both are returned, in file order.
 */
export const parseApiLock = (markdown: string): ReadonlyArray<ApiLockEntry> => {
  const lines = markdown.split('\n')
  const entries: Array<ApiLockEntry> = []

  let pending: { readonly name: string; readonly kind: string } | undefined
  let fence: Array<string> | undefined

  for (const line of lines) {
    if (fence !== undefined) {
      if (line.trimEnd() === '```') {
        /* v8 ignore next -- @preserve */
        if (pending !== undefined) {
          entries.push({ name: pending.name, kind: pending.kind, text: fence.join('\n') })
        }
        pending = undefined
        fence = undefined
        continue
      }
      fence.push(line)
      continue
    }

    const heading = ENTRY_HEADING.exec(line)
    if (heading !== null) {
      const name = heading[1]
      const kind = heading[2]
      // The `: undefined` fallback is structurally unreachable: both of
      // ENTRY_HEADING's groups are mandatory (non-optional) patterns, so a
      // successful match has always captured both.
      /* v8 ignore next -- @preserve */
      pending = name !== undefined && kind !== undefined ? { name, kind } : undefined
      continue
    }

    if (pending !== undefined && line.trimStart().startsWith('```')) {
      fence = []
    }
  }

  return entries
}

/**
 * Every type on a repository's published surface, by name.
 *
 * Built by running `declaredTypes` over each entry's rendered text, which is
 * why the source side and the mirror side cannot be read by two parsers that
 * disagree.
 */
export const typesInApiLock = (markdown: string): ShapeResult<ReadonlyMap<string, TypeShape>> => {
  const shapes = new Map<string, TypeShape>()

  for (const entry of parseApiLock(markdown)) {
    const parsed = declaredTypes(entry.text)
    if (!parsed.ok) {
      return parsed
    }
    const shape = parsed.value.get(entry.name)
    if (shape !== undefined) {
      shapes.set(entry.name, shape)
    }
  }

  return shapeOk(shapes)
}

/** Names on a repository's published surface, whatever their kind. */
export const publishedNames = (markdown: string): ReadonlySet<string> =>
  new Set(parseApiLock(markdown).map((entry) => entry.name))
