/**
 * Cross-repository mirror verification: the decision half. PURE — no
 * filesystem, no dynamic import, no dependencies.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * The defect this exists to catch
 * ---------------------------------------------------------------------------
 *
 * Nothing is published yet (plan.md §6 Step 3 publishes bottom-up), so several
 * repositories carry HAND-WRITTEN MIRRORS of declarations they will eventually
 * import:
 *
 *   domain/kernel-vocabulary.ts   mc-sim, mc-render, mc-playground-kit,
 *                                 mc-compose, mc-worldgen   <- mc-kernel
 *   domain/frame-contract.ts      mx-gameplay, mx-redstone, mx-ui  <- mc-kernel
 *   domain/block-vocabulary.ts    mx-gameplay               <- mc-kernel
 *   domain/chunk-store-port.ts    mx-gameplay               <- mc-worldgen
 *
 * Each mirroring repository has a `*-mirror.test.ts` that pins its mirror's
 * shape in both directions and asserts the `Context.Tag` key literally. Those
 * tests are worth having and they are NOT this. THEY PIN THE TRANSCRIPTION, NOT
 * THE SOURCE. They cannot see the original, because the original lives in
 * another repository that is not a dependency and cannot be one until it is
 * published. So a mirror and its source can drift apart while every repository
 * in the organisation stays green.
 *
 * mc-dev-meta is the only place where both packages exist in one build. That is
 * the entire reason this check belongs here and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * Why this class of defect is invisible to every compiler involved
 * ---------------------------------------------------------------------------
 *
 * Effect keys `Context.Tag` and `Brand.Brand` by a STRING. Two declarations
 * sharing a key are ONE SERVICE AT RUNTIME and TWO UNRELATED NOMINAL TYPES to
 * `tsc`. Neither half of that sentence produces a diagnostic anywhere. This
 * project has already shipped four defects from it:
 *
 *   - a `ClockService` with one field in one repository and two in another;
 *   - `DeltaTimeSecs` refined to `[0.001, 0.05]` in one repository and `>= 0`
 *     in another, under the same brand key;
 *   - `mc-compose` dropping the R channel of a module type entirely;
 *   - api-extractor rendering a tag class as an empty shell, so the API lock
 *     could not see a tag rename either (see scripts/api-lock.ts).
 *
 * ---------------------------------------------------------------------------
 * Three different problems, three different mechanisms
 * ---------------------------------------------------------------------------
 *
 * 1. TRANSCRIBED CONSTANTS AND PREDICATES. Compared by IMPORTING BOTH MODULES
 *    AND RUNNING THEM. A number is compared to a number. A `Brand.refined`
 *    constructor is a real function at runtime, so it is probed over a fixed
 *    grid of samples and the accept/reject/throw vectors are compared — which
 *    is how a `[0.001, 0.05]` refinement is caught against a `>= 0` one without
 *    reading a line of source. This is the strongest evidence available and it
 *    is used wherever it can be.
 *
 * 2. TAG KEYS. Also compared by importing: an Effect tag class exposes its key
 *    as `.key`. No parsing, no string extraction, no chance of reading the key
 *    out of a doc comment by accident.
 *
 * 3. TYPE SHAPE. Types do not exist at runtime, so this half reads text — the
 *    mirror's own source, and the SOURCE repository's committed `api-lock.md`.
 *    `domain/type-shape.ts` argues at length for `api-lock.md` over re-deriving
 *    with a `ts.Program`. Member NAMES and OPTIONALITY are compared; member
 *    TYPES deliberately are not, because the mirrors diverge there ON PURPOSE
 *    and a report full of known-good noise is a report nobody reads.
 *
 * ---------------------------------------------------------------------------
 * What is NOT compared, deliberately
 * ---------------------------------------------------------------------------
 *
 * - MEMBER TYPES. See above and domain/type-shape.ts.
 * - SYMBOLS THE MIRROR DOES NOT MIRROR. Every mirror header says it is
 *   deliberately minimal. A source export absent from the mirror is correct,
 *   not a finding. The comparison is therefore driven by what the MIRROR
 *   declares, and asks the source about each of those.
 * - BEHAVIOUR. `fixedClock` returning the wrong thing is not visible here, only
 *   that both sides have it. That is what each repository's own tests are for.
 * - DOC COMMENTS. Two mirrors of one declaration may explain themselves
 *   differently and both be right.
 *
 * ---------------------------------------------------------------------------
 * Why an absent repository is a skip and not a failure
 * ---------------------------------------------------------------------------
 *
 * `repos/` is gitignored and is EMPTY in a fresh clone. `domain/workspace.ts`
 * settled the precedent and the argument is unchanged: if `pnpm verify` here
 * required fifteen other repositories to exist, the tool that fetches them
 * would be the last thing in the organisation to become trustworthy. So a
 * missing mirror repository, a missing source repository, and a workspace with
 * no `node_modules` installed are all SKIPS. Only a mirror that can actually be
 * compared against its source, and disagrees, fails.
 *
 * The hole that opens up is "everything skipped, exit 0, nobody notices". It is
 * closed in two places: `describeMirrorRun` always prints the skip count and
 * its reasons, and `compareSurfaces` treats an EMPTY OBSERVATION AS A FAILURE
 * rather than as agreement — a mirror that was loaded but yielded nothing to
 * compare is a broken checker, and a broken checker that reports success is
 * worse than no checker.
 */

import type { TypeShape, TypeVariant } from './type-shape'

// ---------------------------------------------------------------------------
// The registry: which file mirrors which repository
// ---------------------------------------------------------------------------

/**
 * A capability lookup that a mirror restates as its own predicate.
 *
 * `mx-gameplay/domain/block-vocabulary.ts` hand-transcribes the block ids that
 * fall when unsupported and the ids that are replaceable, straight out of
 * mc-kernel's `BLOCK_REGISTRY`, as local `Set`s. Nothing in mx-gameplay can
 * check them: mc-kernel is not a dependency, and its own mirror test asserts
 * the sets it was written with. A wrong id there means gameplay asks the right
 * question of the wrong byte, and every test in the organisation agrees with
 * itself.
 *
 * The probe names the mirror's exported predicate and the flag in the owning
 * repository's table. `scripts/check-mirrors.ts` evaluates both over every
 * representable block id and compares the accepted sets.
 *
 * A ROW IS ALSO AN OWNERSHIP CLAIM, and it exempts the named symbol from the
 * "is it on the source's barrel?" comparison. Read the note under
 * `MIRROR_SPECS` before adding one: `owner` may differ from the spec's `source`,
 * and when it does, the spec had better be pointed at the mirror whose barrel
 * really does replace that symbol.
 */
export type CapabilityProbe = {
  /** The predicate the mirror exports, e.g. `isReplaceable`. */
  readonly mirrorExport: string
  /** The repository that owns the capability table. */
  readonly owner: string
  /** The flag name in that table, e.g. `replaceable`. */
  readonly capability: string
}

/**
 * A PROPERTY column that a mirror restates as its own total lookup.
 *
 * The sibling of `CapabilityProbe`, and it exists because mc-kernel splits its
 * block model in two AT DESIGN TIME. `domain/block-capabilities.ts` holds the
 * boolean half, read through `capabilityOfBlockId`;
 * `domain/block-properties.ts` holds the typed half — `opacity` is a three-value
 * enum, `lightEmission` is `0..15`, `supportRule` is a struct — read through
 * `propertyOfBlockId`. A probe array with capability rows and no property rows
 * therefore compares one half of kernel's block model and reports on both.
 *
 * THAT IS NOT A HYPOTHETICAL AND IT COST A REAL DEFECT. mc-worldgen's
 * `domain/kernel-vocabulary.ts` transcribed SIX non-opaque rows while kernel's
 * registry carried twenty-four; the missing eighteen — a ladder, a cobweb,
 * eleven plants, two rails, a cactus, a pressure plate and a slab — all fell
 * through to the `'opaque'` default. That is the DARK direction, which
 * mc-worldgen's DN-7 names as the NON-conservative one: a cell read darker than
 * it is lets a hostile mob spawn where `hostile-spawn.ts` would have refused.
 * Nothing caught it, because generated terrain only ever writes ids 0-10 — the
 * defect was reachable only through a PLACED block, so no golden fixture moved.
 *
 * kernel's audit §4.9.1(d) already states the rule this violated:
 * 「ミラーが転記している能力の数より probe が少なければ、そのチェックは検査して
 * いない成功を報告する」. A probe array with zero property entries is that
 * sentence's limiting case.
 *
 * UNLIKE A CAPABILITY ROW, THIS IS NOT AN OWNERSHIP CLAIM AND DOES NOT EXEMPT
 * ANYTHING. Read the note under `MIRROR_SPECS`: a capability row has to skip the
 * "is it on the source's barrel?" comparison, because a probed predicate belongs
 * to a third repository and would otherwise be reported on every run — and that
 * skip is what hid four broken repoint promises for as long as they existed.
 * The property probes have no such need. Kernel publishes `opacityOfBlockId`,
 * `lightEmissionOfBlockId` and `supportRuleOfBlockId` on its own barrel
 * precisely so that a mirror can restate them under kernel's names, so every
 * probed symbol here also faces the plain comparison and must survive it. A
 * probe that ALSO silenced the barrel check would be trading a stronger
 * guarantee for a weaker one.
 */
export type PropertyProbe = {
  /** The total lookup the mirror exports, e.g. `opacityOfBlockId`. */
  readonly mirrorExport: string
  /** The repository that owns the property table. */
  readonly owner: string
  /** The column name in that table, e.g. `opacity`. */
  readonly property: string
}

export type MirrorSpec = {
  /** The repository holding the mirror. */
  readonly repository: string
  /** Path to the mirror file, relative to that repository's root. */
  readonly file: string
  /**
   * The repository whose PUBLISHED SURFACE the mirror stands in for.
   *
   * Values are read from its `index.ts` and types from its `api-lock.md`,
   * because the barrel is precisely what the mirror will be replaced by: every
   * mirror header says "delete this file and repoint the import at the
   * package".
   */
  readonly source: string
  /** Types the mirror renamed. Mirror name on the left. */
  readonly renamedTypes: ReadonlyArray<{ readonly mirror: string; readonly source: string }>
  /** Predicates restated from a capability table, possibly in a third repository. */
  readonly capabilities: ReadonlyArray<CapabilityProbe>
  /**
   * Total lookups restated from a property table.
   *
   * Required rather than optional, and on every spec, for the same reason
   * `MirrorObservation.properties` is: an absent array and an empty one read
   * identically at the call site, so a spec that simply forgot the field would
   * probe nothing and be reported as agreement.
   */
  readonly properties: ReadonlyArray<PropertyProbe>
}

/**
 * Every mirror in the workspace.
 *
 * Hand-maintained, and that is a real cost — this list is itself a
 * transcription and can go stale. It is small, every entry is a file whose own
 * header announces that it is provisional, and `scripts/check-mirrors.ts`
 * reports any spec whose file has vanished (which is what DELETING a mirror
 * looks like, and is the signal to delete its row here too).
 */
export const MIRROR_SPECS: ReadonlyArray<MirrorSpec> = [
  {
    repository: 'mc-sim',
    file: 'domain/kernel-vocabulary.ts',
    source: 'mc-kernel',
    renamedTypes: [],
    // EMPTY AND CORRECT, for the reason mc-worldgen's row is not: this mirror
    // transcribes no capability FLAG and no property COLUMN. Its header states
    // the boundary — `block-item.ts` and `block-registry.ts`'s drop resolution
    // are deliberately not mirrored, because "what does breaking this block give
    // you" is mx-gameplay's verb. There is no block table here to probe, so a
    // probe row would be inventing data the file does not carry.
    capabilities: [],
    properties: [],
    // ---------------------------------------------------------------------
    // BUT THIS ROW HAS A BLIND SPOT OF THE SAME SHAPE, AND IT HAS ALREADY COST
    // SOMETHING. It is recorded here because the row above looks complete.
    // ---------------------------------------------------------------------
    //
    // What this mirror carries that neither probe kind covers is a ROSTER:
    // `ITEM_TYPES`, a closed literal union whose MEMBERSHIP IS THE TYPE.
    // `observeValue` in `scripts/check-mirrors.ts` reduces an array to
    // `Opaque{kind:'object'}`, so this gate compares "both sides export an
    // object called ITEM_TYPES" and nothing whatever about what is in it.
    //
    // That is not a hypothesis. This mirror sat at 23 literals while kernel's
    // roster was 97 — seventy-four missing — and `check:mirrors` reported
    //
    //   ok    mc-sim/domain/kernel-vocabulary.ts vs mc-kernel — 14 value(s) ...
    //
    // on every run of that period. It was `pnpm check:repoint` that found it, by
    // deleting a mirror and typechecking against the real module, and it showed
    // up as a TS2345 at the mx-gameplay seam rather than as anything mc-sim or
    // this gate could see.
    //
    // kernel's audit §4.9.1(d) is the rule already on the books —
    // 「ミラーが転記している能力の数より probe が少なければ、そのチェックは検査
    // していない成功を報告する」 — and a roster compared as `typeof === 'object'`
    // is that sentence with `capability` replaced by `member`. The fix is a third
    // probe kind (a roster probe: read both arrays, compare element-wise and in
    // order) and it is deliberately NOT attempted in the same change that fixed
    // the roster itself, because it alters `MirrorSpec` for all eleven specs.
    //
    // Until it exists, `mc-sim/test/kernel-mirror.test.ts` pins the roster from
    // inside mc-sim and `check:repoint` catches it from outside; neither is this
    // gate, and this gate should not be read as covering it.
  },
  { repository: 'mc-render', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [], properties: [] },
  { repository: 'mc-playground-kit', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [], properties: [] },
  { repository: 'mc-compose', file: 'domain/kernel-vocabulary.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [], properties: [] },
  {
    repository: 'mc-worldgen',
    file: 'domain/kernel-vocabulary.ts',
    source: 'mc-kernel',
    renamedTypes: [],
    // EMPTY AND CORRECT. This mirror's own header states the boundary it keeps:
    // it asks kernel the two questions a light grid requires and no others, so
    // it deliberately does not restate a single capability FLAG. Deciding that a
    // byte falls when unsupported is a rule, and rules are mx-gameplay's.
    capabilities: [],
    // THE FIRST PROPERTY PROBES IN THIS LIST, and this is the mirror that paid
    // for them. Its header names the gap in the first person — 「`lightEmission`
    // and `opacity` are PROPERTIES, and that probe has no property half」 — and
    // then records what the gap cost: the opacity table below it kept six rows
    // out of kernel's twenty-four for a full week, so `./light.ts` treated a
    // ladder, a rail, a flower, a cactus and a slab as fully light-blocking.
    //
    // The mirror's answer at the time was to make its OWN test exhaustive over
    // kernel's id range, and its header is honest about why that is not enough:
    // 「this file's correctness is checked by a test that this repository could
    // edit in the same commit that breaks it」. These two rows are the structural
    // fix it asked for. They read kernel's table at runtime, in the one build
    // where both packages exist, so no edit in mc-worldgen can make them agree.
    properties: [
      { mirrorExport: 'opacityOfBlockId', owner: 'mc-kernel', property: 'opacity' },
      { mirrorExport: 'lightEmissionOfBlockId', owner: 'mc-kernel', property: 'lightEmission' },
    ],
    // `transmitsLight` is NOT probed and its absence is a decision rather than an
    // oversight. Both sides define it as `opacityOfBlockId(id) !== 'opaque'`, so
    // it is a projection of a column already compared here id for id: it cannot
    // disagree unless `opacity` does, and if `opacity` does then this probe
    // already names the id. A row for it would add a second failure line per
    // defect and no reachable defect of its own.
  },
  { repository: 'mx-gameplay', file: 'domain/frame-contract.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [], properties: [] },
  { repository: 'mx-redstone', file: 'domain/frame-contract.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [], properties: [] },
  { repository: 'mx-ui', file: 'domain/frame-contract.ts', source: 'mc-kernel', renamedTypes: [], capabilities: [], properties: [] },
  {
    repository: 'mx-gameplay',
    file: 'domain/chunk-store-port.ts',
    source: 'mc-worldgen',
    // The mirror calls mc-worldgen's `Chunk` "WorldgenChunk", because
    // mx-gameplay has its own notion of a chunk-shaped thing and did not want
    // to shadow it. A rename is not drift; an unrecorded rename would be.
    renamedTypes: [{ mirror: 'WorldgenChunk', source: 'Chunk' }],
    // EMPTY, AND THAT IS THE FIX. This file used to carry three capability
    // probes and its repository used to export four capability predicates —
    // mc-KERNEL's flags, in a mirror of MC-WORLDGEN. See the note below
    // `MIRROR_SPECS` on what that combination hid. The predicates are in
    // `domain/block-vocabulary.ts` now and so are their probes.
    capabilities: [],
    // Empty for the same reason, and checked rather than assumed: this file
    // mirrors mc-worldgen, and mc-worldgen owns no block table at all. A
    // property row here would be the same misplacement the note below records.
    properties: [],
  },
  {
    // The FIRST mc-sim mirror this list has ever carried, and the reason it is
    // worth saying so: `mx-gameplay/domain/entity-manager-port.ts` has mirrored
    // mc-sim since the mob wiring landed and is not in this list, so until now
    // every spec here pointed at mc-kernel or mc-worldgen. A mirror outside
    // this list is a mirror nobody compares — which is exactly the state the
    // `ChunkStore` capability predicates were in for as long as they existed.
    //
    // This one carries the whole of `InventoryServiceApi` plus the crafting
    // vocabulary the api names (`Inventory`, `RecipeTable`, `CraftGrid`,
    // `RecipeMatch`, `CraftResult` and everything under them), so it is the
    // widest single mirror in the workspace and the one with the most surface
    // to drift. It is also the one whose drift is quietest: nothing in
    // mx-gameplay READS a recipe, so a member that fell out of `ShapedRecipe`
    // would break no test in either repository.
    repository: 'mx-gameplay',
    file: 'domain/inventory-port.ts',
    source: 'mc-sim',
    // NOTHING is renamed, deliberately, and that is a claim this gate checks
    // rather than a note. `mx-gameplay/domain/inventory-port.ts`'s header
    // records the rule it is following: a mirror that renames a symbol
    // typechecks, passes every local test, and yields a name that does not
    // exist on repoint day.
    renamedTypes: [],
    // EMPTY, AND IT MUST STAY EMPTY. A probe row exempts its symbol from the
    // "is it on the source's barrel?" check, and the two symbols this mirror
    // is most likely to grow — `ItemType` and `StackCount` — are precisely the
    // two that mc-sim's barrel does NOT hand back, because mc-sim deliberately
    // does not re-export its own kernel mirror. They live in mx-gameplay's
    // kernel mirrors instead. A probe row here would hide that.
    capabilities: [],
    // Empty, and unlike the capability array above this one carries no risk of
    // hiding anything — a property row does not exempt its symbol from the
    // barrel check. It is empty because an inventory port holds no block table:
    // there is no column here to compare.
    properties: [],
  },
  {
    // THE FIRST MIRROR IN THIS LIST WITH NO CALLER, and the row matters more for
    // that rather than less.
    //
    // Every other spec here names a file some stage or rule imports, so a drift
    // in it eventually breaks a test in its own repository — `check:mirrors` is
    // the second line of defence. `mx-gameplay/domain/player-port.ts` is
    // imported by nothing but its own mirror test: it was written because
    // `docs/testing.md` §3-1's last ⬜ turned out to be waiting on a MIRROR
    // rather than on 「mc-sim の名簿」, and the half of that row it does not close
    // is blocked on a noun no repository owns (there is no `Dimension` in
    // mc-kernel or mc-sim, measured). So nothing calls `moveTo` yet, and this
    // row plus that test are the whole of what holds the transcription.
    //
    // That is exactly the state the `ChunkStore` capability predicates were in —
    // 「a mirror outside this list is a mirror nobody compares」 — with the
    // aggravating factor that here there is no stage to break either.
    repository: 'mx-gameplay',
    file: 'domain/player-port.ts',
    source: 'mc-sim',
    // NOTHING is renamed, and this gate is what checks it rather than a note.
    // `PlayerPose.feetPosition` is the field most likely to be "tidied" into
    // `position`, and it must not be: plan.md §3.4 records that every "things
    // are floating" defect in the reference was a feet-origin/AABB-centre
    // mismatch, so the field name carries the convention.
    renamedTypes: [],
    // EMPTY, AND IT MUST STAY EMPTY, for `domain/inventory-port.ts`'s reason
    // above with different symbols. A probe row exempts its symbol from the "is
    // it on the source's barrel?" check, and the symbols this mirror is most
    // likely to grow — `ClockPort` and `CameraPoseSnapshot` — are precisely the
    // two mc-sim's barrel does NOT hand back, because mc-sim deliberately does
    // not re-export its own kernel mirror. They live in mx-gameplay's
    // `domain/frame-contract.ts` instead, which is a spec in this same list and
    // is repointed at mc-kernel. A probe row here would hide that.
    capabilities: [],
    // Empty: a player port holds no block table, so there is no column here to
    // compare.
    properties: [],
    // -----------------------------------------------------------------------
    // THIS ROW'S BLIND SPOT, recorded because the row above looks complete.
    // -----------------------------------------------------------------------
    //
    // `domain/type-shape.ts` compares member NAMES and OPTIONALITY, not member
    // TYPES — `domain/repoint-plan.ts` states it plainly, 「because the mirrors
    // diverge in their types on purpose」. This mirror has one member where that
    // is not a tolerable divergence but a compile error waiting for repoint day:
    //
    //     cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>
    //
    // The `R` channel is the only place in mx-gameplay where a mirrored
    // signature names a service, and a mirror that narrowed it to
    // `Effect<CameraPoseSnapshot>` would pass this gate with the member present
    // and correctly spelled. mc-compose has already paid for exactly this shape
    // once — 「The previous local `StageRegistration` dropped the R channel
    // entirely (`Effect<void>`); R does not erase itself」.
    //
    // Same sentence as the `ITEM_TYPES` and `SaveEnvelopeSchema` blind spots
    // above (kernel's audit §4.9.1(d)) with `capability` replaced by
    // `requirement`. Until a probe kind can reach it,
    // `mx-gameplay/test/player-mirror.test.ts` pins it with a two-direction
    // assignment off the real member type, and `check:repoint` would catch it
    // from outside; neither is this gate.
  },
  {
    repository: 'mx-gameplay',
    file: 'domain/block-vocabulary.ts',
    source: 'mc-kernel',
    renamedTypes: [],
    capabilities: [
      { mirrorExport: 'fallsWhenUnsupported', owner: 'mc-kernel', capability: 'fallsWhenUnsupported' },
      { mirrorExport: 'isReplaceable', owner: 'mc-kernel', capability: 'replaceable' },
      // Added after a drift the list could not see. The mirror restates kernel's
      // capabilities and only two were probed, so `NON_SPAWN_SURFACE_IDS` was
      // free to disagree with kernel — and did, on `oak_log`, in both
      // repositories at once.
      //
      // The lesson is about the shape of this array rather than about one id: a
      // probe list shorter than the set of capabilities a mirror restates
      // reports success it has not checked, which is the failure mode this
      // file's own header calls "worse than no checker".
      //
      // Note this one is a NEGATIVE set on both sides (kernel defaults it to
      // `true`); the probe compares the accepted sets over every representable
      // id, so the polarity is handled by evaluation rather than by convention.
      { mirrorExport: 'validSpawnSurface', owner: 'mc-kernel', capability: 'validSpawnSurface' },
      // The fourth, and the one whose ABSENCE from this array is what exposed
      // the structural defect. See the note below.
      { mirrorExport: 'canSupportAttachments', owner: 'mc-kernel', capability: 'canSupportAttachments' },
    ],
    // The SECOND mirror to carry property data, and it was not obvious from the
    // outside: this file's four capability probes make it look like the flag
    // mirror, but `SUPPORT_RULE_OVERRIDES` is twenty hand-written rows of
    // kernel's `supportRule` COLUMN — a property, in the same table as `opacity`
    // and read through the same `propertyOfBlockId`.
    //
    // It is the highest-consequence property in the table for this repository,
    // because `canBlockStaySupported` joins it against `canSupportAttachments`
    // and the file's own header records that THE PRECEDENCE IS THE PART THAT
    // GOES WRONG — the per-block rule wins over the negative set, so a stale row
    // here does not merely misplace one block, it silently reorders the two
    // rules for it. That is why the row exists even though the column happens to
    // agree today: a probe added while a table is correct is the only kind that
    // was never written to match a table already known to be wrong.
    //
    // A struct-valued column, so the readings are compared as rendered JSON.
    // `isSupportSensitiveBlockId` is left unprobed on the `transmitsLight`
    // reasoning above: it is `isSupportSensitive(supportRuleOfBlockId(id))` on
    // both sides and cannot disagree on its own.
    properties: [
      { mirrorExport: 'supportRuleOfBlockId', owner: 'mc-kernel', property: 'supportRule' },
    ],
  },
  {
    // The FOURTH source repository this list has ever pointed at — mc-kernel,
    // mc-worldgen and mc-sim were the other three — and the first mirror of
    // mc-save anywhere in the organisation.
    //
    // It is worth saying why it did not exist until now, because the reason was
    // not technical. mc-worldgen's `docs/responsibility.md` §1-5 recorded the
    // chunk format as 「⬜ publish 待ち」 and justified it with 「import できない
    // 理由は `domain/kernel-vocabulary.ts` と同じ」 — a sentence that is true and
    // refutes its own conclusion, since `kernel-vocabulary.ts` is not a file
    // that waited for a publish, it is the file that made waiting unnecessary.
    // The blocker was a missing mirror, and the row below is what makes the
    // replacement mirror checkable rather than merely present.
    repository: 'mc-worldgen',
    file: 'domain/save-format-port.ts',
    source: 'mc-save',
    // NOTHING is renamed, and this gate is what checks that rather than a note.
    // The mirror's header records the rule the organisation paid for: a mirror
    // that renames a symbol typechecks, passes every local test, and yields a
    // name that does not exist on repoint day.
    renamedTypes: [],
    // EMPTY AND CORRECT. mc-save owns no block table and no capability flags —
    // it is deliberately ignorant of what is being saved (`mc-save/index.ts`:
    // 「no opinion about what is being saved」). A probe row here would be the
    // misplacement the note under this list records, and it would additionally
    // exempt its symbol from the "is it on the source's barrel?" check, which is
    // the strongest thing this row has.
    capabilities: [],
    // Empty for the same reason: no property column exists to compare.
    properties: [],
    // -----------------------------------------------------------------------
    // THIS ROW'S BLIND SPOT, recorded because the row above looks complete.
    // -----------------------------------------------------------------------
    //
    // The mirror exports `SaveEnvelopeSchema`, and a `Schema` is neither a
    // scalar, a tag, nor a `Brand.refined` constructor — so `observeValue` in
    // `scripts/check-mirrors.ts` reduces it to `Opaque{kind:'object'}`. This
    // gate therefore compares "both sides export an object called
    // SaveEnvelopeSchema" and NOTHING about the refinements inside it. mc-save
    // constrains the format name with `minLength(1)` and the version with
    // `int()` and `greaterThanOrEqualTo(FIRST_VERSION)`; a mirror that kept the
    // three field names and dropped all three refinements would be reported as
    // agreement here.
    //
    // That is the same shape as the `ITEM_TYPES` roster blind spot recorded on
    // mc-sim's row — kernel's audit §4.9.1(d), 「ミラーが転記している能力の数より
    // probe が少なければ、そのチェックは検査していない成功を報告する」 — with
    // `capability` replaced by `refinement`. A `Schema` is not a `Brand.refined`
    // constructor, so the existing `Refinement` observation cannot reach it; the
    // fix would be a fourth probe kind (decode a fixed sample grid through both
    // schemas and compare the accept/reject vectors, exactly as
    // `REFINEMENT_SAMPLES` does for brands), and it is deliberately NOT
    // attempted in the change that adds this mirror, because it alters
    // `MirrorSpec` for all twelve specs.
    //
    // Until it exists, `mc-worldgen/test/save-format-mirror.test.ts` SF-3 pins
    // the three refinements from inside mc-worldgen. That is the weaker
    // guarantee — a test the mirroring repository could edit in the same commit
    // that breaks it — and this row should not be read as covering it.
    //
    // The `FIRST_VERSION = 1` scalar IS compared for real, and it is the one
    // value on this mirror that a drift cannot survive.
  },
]

/**
 * WHY A PROBE ROW IS ALSO AN OWNERSHIP CLAIM, AND WHAT THAT ONCE HID
 * ---------------------------------------------------------------------------
 *
 * `compareValues` skips every name in a spec's `capabilities` before it can ask
 * `SymbolNotPublished`. It has to: a probed predicate is deliberately NOT on the
 * source's barrel — it belongs to a third repository — so the barrel check would
 * report a finding on every probe row. The skip is correct in isolation.
 *
 * Combined with a spec pointed at the wrong source it is a blindfold. Four
 * capability predicates lived in `mx-gameplay/domain/chunk-store-port.ts`, whose
 * source is mc-worldgen and whose header promises that deleting it and
 * repointing every import at `@nerima-games/mc-worldgen` will typecheck.
 * mc-worldgen exports none of the four. Three had probe rows here and were
 * therefore exempt from the check that would have said so; they reported
 * agreement for as long as they existed. The fourth, `canSupportAttachments`,
 * had no row, fell through to the plain comparison, and failed with exactly the
 * right message — and only once `repos.json` advanced far enough for this gate
 * to be reading current code at all.
 *
 * So the two rules that follow from it, both applied above:
 *
 *   - A probe row is a claim that the predicate is a THIRD repository's. If the
 *     mirror it sits in is not the mirror that repository's barrel replaces, the
 *     row is hiding a broken repoint promise rather than checking a set.
 *   - A mirror that restates a capability must carry a row for EVERY capability
 *     it restates, in the spec for the file that actually holds them. A short
 *     list reports success it has not checked; a misplaced list reports success
 *     about the wrong package.
 *
 * This is NOT `DECLARED_DIVERGENCES` material and was considered for it. A
 * divergence is intended and permanent. A mirror of mc-worldgen that mc-worldgen
 * cannot replace is neither — it is a defect with a fix, and the fix landed.
 */

/** Where in the workspace a mirror lives, for messages. */
export const mirrorPath = (spec: MirrorSpec): string => `${spec.repository}/${spec.file}`

// ---------------------------------------------------------------------------
// Declared divergences
// ---------------------------------------------------------------------------

/**
 * Differences that are INTENDED, each with the reason it is intended.
 *
 * This list is the point of the exercise as much as the findings are. A mirror
 * that diverges for a good reason and says so in a doc comment is invisible to
 * a tool; the same divergence written down here is a committed, reviewed fact
 * that a human approved in a diff. Adding a row is deliberately as annoying as
 * it should be.
 *
 * `subject` is an exported symbol name, or `Type.member` for a single member.
 */
export type DeclaredDivergence = {
  readonly repository: string
  readonly file: string
  readonly subject: string
  readonly reason: string
}

export const DECLARED_DIVERGENCES: ReadonlyArray<DeclaredDivergence> = [
  // Both rows arrived with `mx-gameplay/domain/block-vocabulary.ts`, which
  // became a spec above when the capability probes moved to it. Neither is new
  // drift — the file has looked like this all along; it had simply never been
  // compared against anything, which is the more interesting half of the story.
  {
    repository: 'mx-gameplay',
    file: 'domain/block-vocabulary.ts',
    subject: 'BLOCK_DROP_REGISTRY',
    reason:
      'A PROJECTION of kernel\'s BLOCK_REGISTRY, not a mirror of it, and the different name ' +
      'is load-bearing. Kernel\'s rows are { id, definition: BlockDefinition } — the whole block. ' +
      'This table is { id, type, harvestTool, drops }: the two struct-valued DROP columns and ' +
      'nothing else, which is the subset the mirror\'s header says it transcribes. Naming it ' +
      'BLOCK_REGISTRY would claim a mirror of a shape it does not have and trade this row for ' +
      'member-level findings that mean less. It is also never imported: it exists to build the ' +
      'two lookup maps behind dropOfBlockId, and dropOfBlockId, blockTypeOfId, blockIdOf, ' +
      'resolveDrop and resolveDropItem ARE all on kernel\'s barrel. On the day mc-kernel is ' +
      'published this table is deleted with its file and no call site follows it.',
  },
  {
    repository: 'mx-gameplay',
    file: 'domain/block-vocabulary.ts',
    subject: 'BlockDropRegistryEntry',
    reason:
      'The row type of BLOCK_DROP_REGISTRY above, and it diverges for the same reason and to ' +
      'the same extent. Kernel\'s BlockRegistryEntry nests a BlockDefinition; this one flattens ' +
      'the two drop columns beside the id and the type name. Recorded separately because a ' +
      'divergence covering a value must not silently cover a type as well.',
  },
]

// ---------------------------------------------------------------------------
// Known outstanding findings
// ---------------------------------------------------------------------------

/**
 * A finding that is REAL, is a BUG, and lives in a repository this one does not
 * own.
 *
 * This is NOT `DECLARED_DIVERGENCES`, and conflating the two would destroy both.
 * A divergence is intended and will never be fixed. A known finding is a defect
 * with an owner and a fix, recorded here only because mc-dev-meta cannot land
 * the fix itself — the mirror lives in another repository with its own pull
 * request, its own review and its own `pnpm verify`.
 *
 * Recording it has to be strictly better than the two alternatives, and it is:
 *
 *   - Not running the check until the fix lands means the check lands last, by
 *     which time nobody remembers what it was for.
 *   - Failing `pnpm verify` here for a defect in another repository makes this
 *     repository unverifiable for reasons its own contributors cannot act on,
 *     and a gate people cannot clear is a gate people disable.
 *
 * The entry is matched by an EXACT FINGERPRINT of the finding, so it suppresses
 * that one disagreement and nothing else: if the wrong block id changes, or a
 * second id joins it, the fingerprint stops matching and the run fails.
 *
 * And a known finding that has been FIXED fails the run too, with a message
 * saying to delete the entry. That is deliberately the same discipline
 * `api-lock.md` enforces — a snapshot that no longer describes reality is a
 * snapshot that has stopped meaning anything — and it is what stops this list
 * from quietly becoming a list of checks that are switched off.
 */
export type KnownFinding = {
  /**
   * `fingerprintFinding`'s output. Opaque on purpose: it is produced by running
   * the check, not written by hand, so an entry cannot be widened by accident.
   */
  readonly fingerprint: string
  /** What it is, in a sentence, for whoever reads this list. Not matched on. */
  readonly summary: string
  /** The repository that must land the fix. */
  readonly owner: string
  /** What the fix is. */
  readonly fix: string
}

/**
 * Two entries, both mc-worldgen's, both found by the FIRST run of the property
 * probes — which is the same way this register got its first entry ever.
 *
 * That first one was mx-gameplay's `isReplaceable` omitting lava (block id 11),
 * which mc-kernel's registry marks `replaceable: true`. Falling sand and gravel
 * did not displace lava and placement treated a lava cell as occupied, while
 * mx-gameplay's own `chunk-store-mirror.test.ts` stayed green — because it pins
 * the transcription, not the source. It was removed when the fix landed, which
 * is what the register requires: a known finding fails the run once it is fixed,
 * so this list cannot quietly become a set of switched-off checks.
 *
 * The two below are the property half's version of the same morning's work. Both
 * are stale transcriptions of a kernel column that grew, both are in the DARK
 * direction, and neither is fixable from here — the file that carries them is
 * mc-worldgen's, with its own pull request, its own review and its own
 * `pnpm verify`. Recording them is what lets the probe that FINDS them land
 * today instead of landing after the fix, which is the trade the header above
 * argues for at length.
 *
 * A NOTE ON HOW THESE TWO WILL EXPIRE, because it is sharper than it was for the
 * lava entry. A property fingerprint carries every disagreeing id, so ANY change
 * to either side re-fails the run: mc-worldgen adding one of the missing rows,
 * and equally mc-kernel adding one more non-opaque block. The second case will
 * look like an unrelated failure and is not one — it is this register doing
 * exactly what it promises, refusing to keep suppressing a finding that has
 * changed shape. Re-run with `MIRROR_FINGERPRINTS=1` and replace the entry, or
 * better, delete it because mc-worldgen fixed the table.
 */
export const KNOWN_FINDINGS: ReadonlyArray<KnownFinding> = [
  {
    fingerprint:
      'mc-worldgen/domain/kernel-vocabulary.ts|{"_tag":"PropertyDiffers","symbol":"opacityOfBlockId","owner":"mc-kernel","property":"opacity","disagreements":[{"id":"48 (ice)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"71 (wheat_crop)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"72 (potato_crop)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"73 (nether_wart_crop)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"74 (redstone_wire)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"75 (redstone_torch)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"76 (lever)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"77 (stone_button)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"78 (repeater)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"89 (end_portal)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"90 (chorus_flower)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"91 (chorus_plant)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"92 (dragon_egg)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"93 (end_crystal)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"94 (end_gateway)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"95 (end_rod)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"100 (purpur_slab)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"101 (purpur_stairs)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"106 (door)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"107 (door_open)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"108 (oak_stairs)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"112 (bed)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"114 (brewing_stand)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"118 (nether_portal)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""},{"id":"119 (fire)","mirror":"\\"opaque\\"","owner":"\\"transparentSolid\\""}]}',
    summary:
      "mc-worldgen's opacity transcription is stale on 25 ids. Kernel's roster grew past the " +
      'block-35 boundary the table was last re-derived at, and ice, the three crops, the redstone ' +
      'wiring, the End blocks, the slabs and stairs, both doors, the bed, the brewing stand, the ' +
      'nether portal and fire are all transparentSolid in kernel and read as opaque here.',
    owner: 'mc-worldgen',
    fix:
      'Add the 25 rows to NON_OPAQUE_BLOCK_OPACITIES in domain/kernel-vocabulary.ts and extend ' +
      "test/kernel-mirror.test.ts's exhaustive pin to kernel's current range. The direction is " +
      'the DARK one, which DN-7 names as non-conservative: every one of these cells is read as ' +
      'blocking light that kernel says passes, so the light grid is too dark around them and ' +
      'hostile-spawn.ts will permit a spawn it should refuse. Reachable only through ' +
      'ChunkStore.setBlock, since generated terrain writes ids 0-10 — which is why no golden ' +
      'fixture moved.',
  },
  {
    fingerprint:
      'mc-worldgen/domain/kernel-vocabulary.ts|{"_tag":"PropertyDiffers","symbol":"lightEmissionOfBlockId","owner":"mc-kernel","property":"lightEmission","disagreements":[{"id":"44 (amethyst_cluster)","mirror":"0","owner":"15"},{"id":"54 (redstone_ore)","mirror":"0","owner":"9"},{"id":"61 (deepslate_redstone_ore)","mirror":"0","owner":"9"},{"id":"68 (redstone_block)","mirror":"0","owner":"15"},{"id":"75 (redstone_torch)","mirror":"0","owner":"7"},{"id":"80 (redstone_lamp_lit)","mirror":"0","owner":"15"},{"id":"87 (end_portal_frame)","mirror":"0","owner":"1"},{"id":"88 (end_portal_frame_filled)","mirror":"0","owner":"3"},{"id":"89 (end_portal)","mirror":"0","owner":"15"},{"id":"94 (end_gateway)","mirror":"0","owner":"15"},{"id":"95 (end_rod)","mirror":"0","owner":"15"},{"id":"97 (ender_chest)","mirror":"0","owner":"15"},{"id":"118 (nether_portal)","mirror":"0","owner":"11"},{"id":"119 (fire)","mirror":"0","owner":"15"}]}',
    summary:
      "mc-worldgen's lightEmission transcription is stale on 14 ids. It carries the three " +
      'emitters it was written with (lava, torch, glowstone) while kernel now has seventeen: the ' +
      'redstone family, the amethyst cluster, the End blocks, the ender chest, the nether portal ' +
      'and fire all emit in kernel and read as 0 here.',
    owner: 'mc-worldgen',
    fix:
      'Add the 14 rows to BLOCK_LIGHT_EMISSION in domain/kernel-vocabulary.ts, with the levels ' +
      "kernel gives (they are not uniform: 9 for redstone ore, 7 for a redstone torch, 1 and 3 " +
      'for the two end_portal_frame states, 11 for the nether portal, 15 for the rest). Same ' +
      'DARK direction as the opacity entry above, and the same reason nothing caught it. The ' +
      "file's own comment calls the three-row table 'luck rather than design'; the luck ran out.",
  },
]

/**
 * A finding's identity, for matching against `KNOWN_FINDINGS`.
 *
 * Every discriminating field is in it, so an entry cannot silently widen: a
 * second wrong block id, or a different one, produces a different fingerprint
 * and therefore a new failure. Deterministic because every finding in this
 * module is built with a fixed key order.
 */
export const fingerprintFinding = (spec: MirrorSpec, finding: MirrorFinding): string =>
  `${mirrorPath(spec)}|${JSON.stringify(finding)}`

const divergenceFor = (
  spec: MirrorSpec,
  subject: string,
): DeclaredDivergence | undefined =>
  DECLARED_DIVERGENCES.find(
    (entry) =>
      entry.repository === spec.repository && entry.file === spec.file && entry.subject === subject,
  )

// ---------------------------------------------------------------------------
// Observations — what the impure shell hands back
// ---------------------------------------------------------------------------

/** One sample fed to a `Brand.refined` constructor, and what came back. */
export type SampleVerdict = {
  /** A stable label, e.g. `0.0005` or `""`. Labels, not values, so this stays plain data. */
  readonly sample: string
  readonly verdict: 'accepted' | 'rejected' | 'threw'
}

/**
 * The samples every refinement is probed with.
 *
 * One grid for every brand rather than a per-brand grid, because a per-brand
 * grid is a transcription of the refinement and would have to be kept honest by
 * something. A sample of the wrong primitive type makes the refinement throw,
 * and `threw` is a perfectly good third verdict: two agreeing refinements throw
 * on exactly the same samples.
 *
 * The values are chosen around the boundaries this project has actually got
 * wrong: `0.001` and `0.05` are the ends of the frame-budget window that was
 * once baked into `DeltaTimeSecs`; `64` and `65` bracket `MAX_STACK_COUNT`;
 * `MAX_SAFE_INTEGER + 1` separates `Number.isSafeInteger` from
 * `Number.isInteger`; the blank strings separate a trimmed non-blank check from
 * a bare length check.
 */
export const REFINEMENT_SAMPLES: ReadonlyArray<{ readonly label: string; readonly value: unknown }> = [
  { label: '-1', value: -1 },
  { label: '-0.0001', value: -0.0001 },
  { label: '0', value: 0 },
  { label: '0.0005', value: 0.0005 },
  { label: '0.001', value: 0.001 },
  { label: '0.008', value: 0.008 },
  { label: '0.016', value: 0.016 },
  { label: '0.05', value: 0.05 },
  { label: '0.0501', value: 0.0501 },
  { label: '0.5', value: 0.5 },
  { label: '1', value: 1 },
  { label: '63', value: 63 },
  { label: '64', value: 64 },
  { label: '65', value: 65 },
  { label: '255', value: 255 },
  { label: '256', value: 256 },
  { label: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
  { label: 'MAX_SAFE_INTEGER+1', value: Number.MAX_SAFE_INTEGER + 1 },
  { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
  { label: 'NaN', value: Number.NaN },
  { label: '""', value: '' },
  { label: '"   "', value: '   ' },
  { label: '"a"', value: 'a' },
  { label: '"sim:physics"', value: 'sim:physics' },
]

/**
 * One exported value, reduced to plain comparable data by the impure shell.
 *
 * `Opaque` is the honest answer for everything that is neither a scalar, a tag,
 * nor a refinement — a `Layer` factory, an `Effect`, a plain helper. Its
 * `kind` is still compared, because a mirror exporting a function where the
 * source exports an object is drift even when neither can be inspected further.
 */
export type ValueObservation =
  | { readonly _tag: 'Scalar'; readonly name: string; readonly rendered: string }
  | { readonly _tag: 'TagKey'; readonly name: string; readonly key: string }
  | { readonly _tag: 'Refinement'; readonly name: string; readonly verdicts: ReadonlyArray<SampleVerdict> }
  | { readonly _tag: 'Opaque'; readonly name: string; readonly kind: string }

export const observationKind = (observation: ValueObservation): string => {
  switch (observation._tag) {
    case 'Scalar':
      return 'a scalar'
    case 'TagKey':
      return 'a Context.Tag'
    case 'Refinement':
      return 'a Brand refinement'
    case 'Opaque':
      return `a ${observation.kind}`
  }
}

/** One capability predicate evaluated on both sides over the same id domain. */
export type CapabilityObservation = {
  readonly mirrorExport: string
  readonly owner: string
  readonly capability: string
  /** Block ids the mirror's predicate accepts, rendered ascending, e.g. `5 (sand)`. */
  readonly mirrorAccepts: ReadonlyArray<string>
  /** Block ids the owning table accepts for the same flag. */
  readonly ownerAccepts: ReadonlyArray<string>
}

/** One block id, and what each side's property lookup returned for it. */
export type PropertyReading = {
  /** The id as the capability half renders one, e.g. `31 (rail)`. */
  readonly id: string
  /** The mirror's answer, rendered. JSON, so a struct column compares too. */
  readonly mirror: string
  /** The owning table's answer for the same id, rendered the same way. */
  readonly owner: string
}

/**
 * One property column read on both sides over the same id domain.
 *
 * Carries EVERY id rather than only the disagreements, which is the same
 * division of labour `CapabilityObservation` keeps: the shell reports what it
 * saw and the pure half decides what that means. It is also what makes the
 * comparison CLOSED — a reading list that stops where the mirror's table stops
 * would agree with a mirror that is missing rows, which is precisely how
 * mc-worldgen's six-of-twenty-four opacity table survived a week of green runs.
 */
export type PropertyObservation = {
  readonly mirrorExport: string
  readonly owner: string
  readonly property: string
  /** Every id in the owning table's range, ascending. */
  readonly readings: ReadonlyArray<PropertyReading>
}

/** What the shell observed about the mirror file. */
export type MirrorObservation = {
  readonly values: ReadonlyArray<ValueObservation>
  readonly types: ReadonlyArray<TypeShape>
  readonly capabilities: ReadonlyArray<CapabilityObservation>
  readonly properties: ReadonlyArray<PropertyObservation>
}

/** What the shell observed about the source repository's PUBLISHED surface. */
export type SourceObservation = {
  readonly values: ReadonlyArray<ValueObservation>
  readonly types: ReadonlyArray<TypeShape>
  /** Every name in the source's `api-lock.md`, whatever its kind. */
  readonly published: ReadonlySet<string>
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type MirrorFinding =
  | { readonly _tag: 'ScalarDiffers'; readonly symbol: string; readonly mirror: string; readonly source: string }
  | { readonly _tag: 'TagKeyDiffers'; readonly symbol: string; readonly mirror: string; readonly source: string }
  | {
      readonly _tag: 'RefinementDiffers'
      readonly symbol: string
      readonly disagreements: ReadonlyArray<{
        readonly sample: string
        readonly mirror: string
        readonly source: string
      }>
    }
  | { readonly _tag: 'KindDiffers'; readonly symbol: string; readonly mirror: string; readonly source: string }
  | { readonly _tag: 'SymbolNotPublished'; readonly symbol: string }
  | { readonly _tag: 'TypeNotPublished'; readonly type: string; readonly lookedFor: string }
  | { readonly _tag: 'ShapeNotComparable'; readonly type: string; readonly objectInMirror: boolean }
  | { readonly _tag: 'VariantMissingFromMirror'; readonly type: string; readonly variant: string }
  | { readonly _tag: 'VariantNotInSource'; readonly type: string; readonly variant: string }
  | { readonly _tag: 'MemberMissingFromMirror'; readonly type: string; readonly member: string }
  | { readonly _tag: 'MemberNotInSource'; readonly type: string; readonly member: string }
  | {
      readonly _tag: 'OptionalityDiffers'
      readonly type: string
      readonly member: string
      readonly mirrorOptional: boolean
    }
  | {
      readonly _tag: 'CapabilityDiffers'
      readonly symbol: string
      readonly owner: string
      readonly capability: string
      readonly onlyInMirror: ReadonlyArray<string>
      readonly onlyInSource: ReadonlyArray<string>
    }
  | {
      readonly _tag: 'PropertyDiffers'
      readonly symbol: string
      readonly owner: string
      readonly property: string
      readonly disagreements: ReadonlyArray<PropertyReading>
    }
  | {
      readonly _tag: 'PropertyProbeEmpty'
      readonly symbol: string
      readonly owner: string
      readonly property: string
    }
  | { readonly _tag: 'NothingObserved'; readonly detail: string }

const verdictOf = (
  verdicts: ReadonlyArray<SampleVerdict>,
  sample: string,
): string => verdicts.find((entry) => entry.sample === sample)?.verdict ?? 'not probed'

const compareValues = (
  spec: MirrorSpec,
  mirror: ReadonlyArray<ValueObservation>,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  const bySourceName = new Map(source.values.map((value) => [value.name, value]))
  const probed = new Set(spec.capabilities.map((probe) => probe.mirrorExport))
  const findings: Array<MirrorFinding> = []

  for (const observed of mirror) {
    if (divergenceFor(spec, observed.name) !== undefined || probed.has(observed.name)) {
      continue
    }

    const counterpart = bySourceName.get(observed.name)
    if (counterpart === undefined) {
      // Not on the source's published surface at all. That is a finding rather
      // than a skip: the mirror header promises the file can be deleted and the
      // import repointed at the package, and a symbol the package does not
      // export makes that promise false.
      if (!source.published.has(observed.name)) {
        findings.push({ _tag: 'SymbolNotPublished', symbol: observed.name })
      }
      continue
    }

    if (observed._tag !== counterpart._tag) {
      findings.push({
        _tag: 'KindDiffers',
        symbol: observed.name,
        mirror: observationKind(observed),
        source: observationKind(counterpart),
      })
      continue
    }

    if (observed._tag === 'Scalar' && counterpart._tag === 'Scalar') {
      if (observed.rendered !== counterpart.rendered) {
        findings.push({
          _tag: 'ScalarDiffers',
          symbol: observed.name,
          mirror: observed.rendered,
          source: counterpart.rendered,
        })
      }
      continue
    }

    if (observed._tag === 'TagKey' && counterpart._tag === 'TagKey') {
      if (observed.key !== counterpart.key) {
        findings.push({
          _tag: 'TagKeyDiffers',
          symbol: observed.name,
          mirror: observed.key,
          source: counterpart.key,
        })
      }
      continue
    }

    if (observed._tag === 'Refinement' && counterpart._tag === 'Refinement') {
      const disagreements = REFINEMENT_SAMPLES.map((sample) => ({
        sample: sample.label,
        mirror: verdictOf(observed.verdicts, sample.label),
        source: verdictOf(counterpart.verdicts, sample.label),
      })).filter((entry) => entry.mirror !== entry.source)

      if (disagreements.length > 0) {
        findings.push({ _tag: 'RefinementDiffers', symbol: observed.name, disagreements })
      }
      continue
    }

    if (observed._tag === 'Opaque' && counterpart._tag === 'Opaque' && observed.kind !== counterpart.kind) {
      findings.push({
        _tag: 'KindDiffers',
        symbol: observed.name,
        mirror: observationKind(observed),
        source: observationKind(counterpart),
      })
    }
  }

  return findings
}

/**
 * Index a declaration's arms so the two sides can be matched up.
 *
 * A discriminated union is matched BY ITS `_tag`, never by position, because
 * the two sides write their arms in whatever order suited the author and a
 * reordering is not a change. An untagged arm falls back to its position, which
 * is all that is available; every union in this workspace is tagged, and a plain
 * object type is one untagged arm at position 0, so the fallback is exercised by
 * the common case rather than being untested contingency code.
 */
const armsByLabel = (shape: TypeShape): ReadonlyMap<string, TypeVariant> =>
  new Map(
    shape.variants.map((variant, index) => [variant.tag ?? `arm #${String(index)}`, variant]),
  )

/** `ChunkStoreApi`, or `BlockReading (_tag: "OutOfWorld")` for one arm of a union. */
const displayOf = (shape: TypeShape, name: string, label: string): string =>
  shape.variants.length === 1 && shape.variants[0]?.tag === undefined
    ? name
    : `${name} (_tag: ${JSON.stringify(label)})`

const compareTypes = (
  spec: MirrorSpec,
  mirror: ReadonlyArray<TypeShape>,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  const bySourceName = new Map(source.types.map((shape) => [shape.name, shape]))
  const renamed = new Map(spec.renamedTypes.map((entry) => [entry.mirror, entry.source]))
  const findings: Array<MirrorFinding> = []

  for (const shape of mirror) {
    if (divergenceFor(spec, shape.name) !== undefined) {
      continue
    }

    const lookedFor = renamed.get(shape.name) ?? shape.name
    const counterpart = bySourceName.get(lookedFor)
    if (counterpart === undefined) {
      if (!source.published.has(lookedFor)) {
        findings.push({ _tag: 'TypeNotPublished', type: shape.name, lookedFor })
      }
      continue
    }

    // Both sides unreadable as object types — a brand, an alias, `never`. There
    // is nothing here for a text comparison to say, and the value half says it
    // better. Both sides readable, or neither: anything else is a finding.
    if (shape.variants.length === 0 && counterpart.variants.length === 0) {
      continue
    }
    if (shape.variants.length === 0 || counterpart.variants.length === 0) {
      findings.push({
        _tag: 'ShapeNotComparable',
        type: shape.name,
        objectInMirror: shape.variants.length > 0,
      })
      continue
    }

    const mirrorArms = armsByLabel(shape)
    const sourceArms = armsByLabel(counterpart)

    for (const label of sourceArms.keys()) {
      if (!mirrorArms.has(label)) {
        findings.push({ _tag: 'VariantMissingFromMirror', type: shape.name, variant: label })
      }
    }
    for (const label of mirrorArms.keys()) {
      if (!sourceArms.has(label)) {
        findings.push({ _tag: 'VariantNotInSource', type: shape.name, variant: label })
      }
    }

    for (const [label, arm] of mirrorArms) {
      const counterpartArm = sourceArms.get(label)
      if (counterpartArm === undefined) {
        continue
      }
      const where = displayOf(shape, shape.name, label)
      const mirrorMembers = new Map(arm.members.map((member) => [member.name, member]))
      const sourceMembers = new Map(counterpartArm.members.map((member) => [member.name, member]))

      for (const member of counterpartArm.members) {
        if (divergenceFor(spec, `${shape.name}.${member.name}`) !== undefined) {
          continue
        }
        if (!mirrorMembers.has(member.name)) {
          findings.push({ _tag: 'MemberMissingFromMirror', type: where, member: member.name })
        }
      }

      for (const member of arm.members) {
        if (divergenceFor(spec, `${shape.name}.${member.name}`) !== undefined) {
          continue
        }
        const counterpartMember = sourceMembers.get(member.name)
        if (counterpartMember === undefined) {
          findings.push({ _tag: 'MemberNotInSource', type: where, member: member.name })
          continue
        }
        if (counterpartMember.optional !== member.optional) {
          findings.push({
            _tag: 'OptionalityDiffers',
            type: where,
            member: member.name,
            mirrorOptional: member.optional,
          })
        }
      }
    }
  }

  return findings
}

const compareCapabilities = (
  spec: MirrorSpec,
  observed: ReadonlyArray<CapabilityObservation>,
): ReadonlyArray<MirrorFinding> => {
  const findings: Array<MirrorFinding> = []

  for (const capability of observed) {
    if (divergenceFor(spec, capability.mirrorExport) !== undefined) {
      continue
    }
    const mirrorSet = new Set(capability.mirrorAccepts)
    const sourceSet = new Set(capability.ownerAccepts)
    const onlyInMirror = capability.mirrorAccepts.filter((id) => !sourceSet.has(id))
    const onlyInSource = capability.ownerAccepts.filter((id) => !mirrorSet.has(id))

    if (onlyInMirror.length > 0 || onlyInSource.length > 0) {
      findings.push({
        _tag: 'CapabilityDiffers',
        symbol: capability.mirrorExport,
        owner: capability.owner,
        capability: capability.capability,
        onlyInMirror,
        onlyInSource,
      })
    }
  }

  return findings
}

/**
 * Diff one property column, id by id, over the owning table's whole range.
 *
 * The empty-readings guard is the per-probe restatement of `compareSurfaces`'s
 * empty-observation guard, and it is here for the same reason: a probe that read
 * no ids compares nothing, and `disagreements.length > 0` is false for a column
 * nobody looked at. That is the shape of failure kernel's audit §4.9.1(d)
 * describes — 検査していない成功 — and it must be a finding, not a pass.
 */
const compareProperties = (
  spec: MirrorSpec,
  observed: ReadonlyArray<PropertyObservation>,
): ReadonlyArray<MirrorFinding> => {
  const findings: Array<MirrorFinding> = []

  for (const property of observed) {
    if (divergenceFor(spec, property.mirrorExport) !== undefined) {
      continue
    }

    if (property.readings.length === 0) {
      findings.push({
        _tag: 'PropertyProbeEmpty',
        symbol: property.mirrorExport,
        owner: property.owner,
        property: property.property,
      })
      continue
    }

    const disagreements = property.readings.filter((reading) => reading.mirror !== reading.owner)
    if (disagreements.length > 0) {
      findings.push({
        _tag: 'PropertyDiffers',
        symbol: property.mirrorExport,
        owner: property.owner,
        property: property.property,
        disagreements,
      })
    }
  }

  return findings
}

/**
 * Compare one mirror against its source.
 *
 * The empty-observation guard comes FIRST and is not negotiable. Every other
 * branch here compares two things; if there is nothing to compare, every
 * comparison trivially succeeds and the run reports agreement it never
 * established. A checker that certifies that nothing happened is the exact
 * failure api-extractor was rejected for (scripts/api-lock.ts), and it must not
 * be rebuilt here.
 */
export const compareSurfaces = (
  spec: MirrorSpec,
  mirror: MirrorObservation,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  if (mirror.values.length === 0 && mirror.types.length === 0) {
    return [
      {
        _tag: 'NothingObserved',
        detail:
          `${mirrorPath(spec)} was loaded but yielded no exported values and no object types. ` +
          'Either the file is empty, or the extractor is broken. Both are failures: with nothing ' +
          'to compare, every comparison below would pass.',
      },
    ]
  }

  if (source.published.size === 0) {
    return [
      {
        _tag: 'NothingObserved',
        detail:
          `${spec.source}/api-lock.md yielded no entries, so there is no published surface to ` +
          `compare ${mirrorPath(spec)} against. Run \`pnpm api:update\` in ${spec.source}, or fix ` +
          'domain/type-shape.ts.',
      },
    ]
  }

  return [
    ...compareValues(spec, mirror.values, source),
    ...compareTypes(spec, mirror.types, source),
    ...compareCapabilities(spec, mirror.capabilities),
    ...compareProperties(spec, mirror.properties),
  ]
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const list = (values: ReadonlyArray<string>): string => values.join(', ')

/**
 * A finding, as a sentence that names the repository, the symbol, what the
 * mirror says and what the source says.
 *
 * "Mirrors differ" would be useless. The reader of this line is looking at
 * fifteen repositories they may not have open, and has to be able to go
 * straight to one file and one identifier.
 */
export const describeMirrorFinding = (spec: MirrorSpec, finding: MirrorFinding): string => {
  const at = mirrorPath(spec)

  switch (finding._tag) {
    case 'ScalarDiffers':
      return (
        `${at}: ${finding.symbol} is ${finding.mirror}, but ${spec.source} publishes ` +
        `${finding.source}. The mirror is a transcription and this one is wrong.`
      )
    case 'TagKeyDiffers':
      return (
        `${at}: ${finding.symbol} is built from the tag key "${finding.mirror}", but ` +
        `${spec.source} uses "${finding.source}". Effect resolves tags by this string, so the ` +
        'two are different services at runtime while both repositories typecheck.'
      )
    case 'RefinementDiffers': {
      const rows = finding.disagreements.map(
        (entry) => `      ${entry.sample}: mirror ${entry.mirror}, ${spec.source} ${entry.source}`,
      )
      return [
        `${at}: the Brand refinement ${finding.symbol} disagrees with ${spec.source}'s on ` +
          `${String(finding.disagreements.length)} sample(s). Both brands carry the same key, so ` +
          'a value one repository accepts is a value the other believes it has already validated.',
        ...rows,
      ].join('\n')
    }
    case 'KindDiffers':
      return (
        `${at}: ${finding.symbol} is ${finding.mirror} here and ${finding.source} in ` +
        `${spec.source}.`
      )
    case 'SymbolNotPublished':
      return (
        `${at}: ${finding.symbol} is mirrored, but ${spec.source} does not export it from its ` +
        'barrel. When the source is published, deleting this mirror and repointing the import ' +
        'will not compile.'
      )
    case 'TypeNotPublished':
      return (
        `${at}: the type ${finding.type}${finding.lookedFor === finding.type ? '' : ` (looked up as ${finding.lookedFor})`}` +
        ` is not on ${spec.source}'s published surface. Either it was renamed, or this mirror ` +
        'stands in for something that will never be importable.'
      )
    case 'ShapeNotComparable':
      return (
        `${at}: ${finding.type} is an object type ` +
        `${finding.objectInMirror ? 'here but not in' : 'in'} ${spec.source}` +
        `${finding.objectInMirror ? '' : ' but not here'}. One of the two is an alias, a brand or ` +
        'a type this checker cannot read as a shape, so its members were never compared. That is ' +
        'reported rather than skipped: a type compared against nothing agrees with everything.'
      )
    case 'VariantMissingFromMirror':
      return (
        `${at}: the union ${finding.type} is missing the arm ${JSON.stringify(finding.variant)}, ` +
        `which ${spec.source} declares. A dropped arm is not a narrower type — an exhaustive ` +
        'switch here will never see the case, and the value it never handles arrives anyway.'
      )
    case 'VariantNotInSource':
      return (
        `${at}: the union ${finding.type} declares the arm ${JSON.stringify(finding.variant)}, ` +
        `which ${spec.source} does not. Nothing will ever produce it.`
      )
    case 'MemberMissingFromMirror':
      return (
        `${at}: ${finding.type} is missing the member "${finding.member}", which ${spec.source} ` +
        'declares. A narrower mirror of a service type is not "less of the vocabulary": a Layer ' +
        'built against it satisfies the full tag and the missing member reads undefined.'
      )
    case 'MemberNotInSource':
      return (
        `${at}: ${finding.type} declares "${finding.member}", which ${spec.source} does not. ` +
        'The mirror has invented a member that will disappear on the day the import is repointed.'
      )
    case 'OptionalityDiffers':
      return (
        `${at}: ${finding.type}.${finding.member} is ` +
        `${finding.mirrorOptional ? 'optional here and required' : 'required here and optional'} ` +
        `in ${spec.source}.`
      )
    case 'CapabilityDiffers': {
      const lines = [
        `${at}: ${finding.symbol} does not agree with ${finding.owner}'s ` +
          `"${finding.capability}" capability.`,
      ]
      if (finding.onlyInSource.length > 0) {
        lines.push(
          `      ${finding.owner} says TRUE for ids the mirror says FALSE for: ${list(finding.onlyInSource)}`,
        )
      }
      if (finding.onlyInMirror.length > 0) {
        lines.push(
          `      the mirror says TRUE for ids ${finding.owner} says FALSE for: ${list(finding.onlyInMirror)}`,
        )
      }
      lines.push(
        '      This is a hand-transcribed table. Adding a row to the source table should have ' +
          'been the whole change; here it is a second place that has to be edited and was not.',
      )
      return lines.join('\n')
    }
    case 'PropertyDiffers': {
      const rows = finding.disagreements.map(
        (entry) => `      ${entry.id}: mirror ${entry.mirror}, ${finding.owner} ${entry.owner}`,
      )
      return [
        `${at}: ${finding.symbol} does not agree with ${finding.owner}'s "${finding.property}" ` +
          `property on ${String(finding.disagreements.length)} id(s). Every id in ${finding.owner}'s ` +
          'range was read on both sides, so these are the only ones that differ:',
        ...rows,
        // The direction is the part that decides how bad it is, and neither the
        // ids nor the values say it on their own. A missing row does not read as
        // an error — it reads as the DEFAULT, which for `opacity` is `'opaque'`
        // and therefore darker than the truth. mc-worldgen's DN-7 names that as
        // the non-conservative direction: a cell read darker than it is lets a
        // hostile spawn where the rule would have refused.
        '      An id absent from a hand-written property table does not fail — it silently reads',
        `      as ${finding.owner}'s default. Check the DIRECTION of each row above before sizing`,
        '      this: for opacity the default is the DARK answer, and dark is the direction that',
        '      spawns mobs. Adding the row to the source table should have been the whole change.',
      ].join('\n')
    }
    case 'PropertyProbeEmpty':
      return (
        `${at}: the probe on ${finding.symbol} read ZERO ids of ${finding.owner}'s ` +
        `"${finding.property}" property, so it compared nothing and would have reported ` +
        'agreement. Either the owning table exposes an empty id range or the probe is broken. ' +
        'A column compared against nothing agrees with everything, which is the one result this ' +
        'checker must never produce.'
      )
    case 'NothingObserved':
      return `${at}: ${finding.detail}`
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type MirrorOutcome =
  | {
      readonly _tag: 'Compared'
      readonly spec: MirrorSpec
      /** Disagreements nobody has seen before. These fail the run. */
      readonly findings: ReadonlyArray<MirrorFinding>
      /** Disagreements already recorded in `KNOWN_FINDINGS`. Reported, not failed. */
      readonly known: ReadonlyArray<{
        readonly finding: MirrorFinding
        readonly entry: KnownFinding
      }>
      readonly valuesCompared: number
      readonly typesCompared: number
      readonly capabilitiesCompared: number
      readonly propertiesCompared: number
      /**
       * Ids read across every property probe on this mirror.
       *
       * Printed because "1 property probe" and "1 property probe that read one
       * id" look identical in a count of probes, and the difference between them
       * is a closed comparison and a spot-check.
       */
      readonly propertyIdsCompared: number
    }
  | { readonly _tag: 'Skipped'; readonly spec: MirrorSpec; readonly reason: string }

export const compareMirror = (
  spec: MirrorSpec,
  mirror: MirrorObservation,
  source: SourceObservation,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): MirrorOutcome => {
  const all = compareSurfaces(spec, mirror, source)
  const known: Array<{ readonly finding: MirrorFinding; readonly entry: KnownFinding }> = []
  const fresh: Array<MirrorFinding> = []

  for (const finding of all) {
    const fingerprint = fingerprintFinding(spec, finding)
    const entry = registry.find((candidate) => candidate.fingerprint === fingerprint)
    if (entry === undefined) {
      fresh.push(finding)
    } else {
      known.push({ finding, entry })
    }
  }

  return {
    _tag: 'Compared',
    spec,
    findings: fresh,
    known,
    valuesCompared: mirror.values.length,
    typesCompared: mirror.types.length,
    capabilitiesCompared: mirror.capabilities.length,
    propertiesCompared: mirror.properties.length,
    propertyIdsCompared: mirror.properties.reduce(
      (total, property) => total + property.readings.length,
      0,
    ),
  }
}

export const failingOutcomes = (
  outcomes: ReadonlyArray<MirrorOutcome>,
): ReadonlyArray<MirrorOutcome> =>
  outcomes.filter((outcome) => outcome._tag === 'Compared' && outcome.findings.length > 0)

/**
 * Entries in `KNOWN_FINDINGS` whose mirror WAS compared this run and whose
 * finding did not appear.
 *
 * Either the defect was fixed — in which case the entry must go, or it will sit
 * there suppressing the next occurrence — or it changed shape, in which case it
 * has already been reported as a new finding and the old entry is dead weight.
 * Only entries whose mirror was actually compared are reported: an entry for a
 * repository nobody cloned has not been shown to be stale.
 */
export const staleKnownFindings = (
  outcomes: ReadonlyArray<MirrorOutcome>,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): ReadonlyArray<KnownFinding> => {
  const comparedPaths = outcomes
    .filter((outcome) => outcome._tag === 'Compared')
    .map((outcome) => `${mirrorPath(outcome.spec)}|`)
  const matched = new Set(
    outcomes.flatMap((outcome) =>
      outcome._tag === 'Compared' ? outcome.known.map(({ entry }) => entry.fingerprint) : [],
    ),
  )

  return registry.filter(
    (entry) =>
      !matched.has(entry.fingerprint) &&
      comparedPaths.some((prefix) => entry.fingerprint.startsWith(prefix)),
  )
}

/**
 * 0 when nothing NEW disagreed and no recorded defect has quietly gone away.
 *
 * Skips never fail; see the header. Known findings never fail; see
 * `KNOWN_FINDINGS`. A stale known finding does fail, because a register of
 * suppressed checks that nobody prunes is a register of checks that are off.
 */
export const mirrorRunExitCode = (
  outcomes: ReadonlyArray<MirrorOutcome>,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): number =>
  failingOutcomes(outcomes).length > 0 || staleKnownFindings(outcomes, registry).length > 0 ? 1 : 0

// ---------------------------------------------------------------------------
// Which checkout was read
// ---------------------------------------------------------------------------

/**
 * The one sentence every report begins and ends with.
 *
 * There are TWO cross-repository gates in this organisation and they resolve
 * "the code" differently on purpose:
 *
 *   - this one reads `repos/`, the PINNED composite;
 *   - mc-compose's `pnpm check:roster` reads the sibling working copies.
 *
 * The split is defensible because the two gates ask different questions. This
 * gate asks whether TWO PINNED REVISIONS agree — a property of this commit of
 * mc-dev-meta, and of no other repository's commit, since no other repository
 * can see both. Reading working copies would make it a property of whatever
 * happened to be checked out, which is exactly the thing `repos.json` exists to
 * stop being the answer. `check:roster` asks whether a HAND-WRITTEN
 * TRANSCRIPTION, committed inside mc-compose, still matches the source it was
 * copied from, down to `file:line`; that transcription is edited while looking
 * at a working copy, so the working copy is what it must be checked against.
 *
 * What was NOT defensible was leaving it unsaid. A failure from this gate read
 * as real drift when the true cause was a pin that could not advance
 * (docs/manifest.md §5), and nothing in the message named the checkout it had
 * read. So it is named, every run, pass or fail.
 */
export const MIRROR_SOURCE_NOTE: ReadonlyArray<string> = [
  'Source: repos/ — the checkout this repository pins in repos.json, NOT the sibling working',
  "copies next to it. mc-compose's `pnpm check:roster` reads those instead, deliberately; the",
  'two gates answer different questions and docs/manifest.md §5.5 says which is which. If the two',
  'disagree, compare the revisions above before believing either.',
]

/** One repository as it actually sat on disk when this run read it. */
export type RepositoryProvenance = {
  readonly name: string
  /** Full SHA of `repos/<name>` HEAD, or `undefined` if it could not be read. */
  readonly head: string | undefined
  /** What `repos.json` names, or `undefined` for an unpinned entry. */
  readonly pinned: string | undefined
  readonly dirty: boolean
}

/** True when what was read is not what the manifest names. */
export const isOffPin = (row: RepositoryProvenance): boolean =>
  row.dirty || row.head === undefined || row.pinned === undefined || row.head !== row.pinned

const shortSha = (sha: string | undefined): string => (sha === undefined ? 'unreadable' : sha.slice(0, 12))

/**
 * Name the revisions this run compared, and flag every one that is not the pin.
 *
 * A repository that is off its pin does not FAIL this gate — it is a perfectly
 * ordinary state, and half of the point of `pnpm sync --latest` is to produce
 * it deliberately. It is reported because a finding read against a revision the
 * manifest does not name is a finding about something nobody has recorded, and
 * whoever reads it needs to know that before they go looking for the drift in
 * the mirror.
 */
export const describeProvenance = (
  rows: ReadonlyArray<RepositoryProvenance>,
): ReadonlyArray<string> => {
  if (rows.length === 0) {
    return [...MIRROR_SOURCE_NOTE, 'No repository under repos/ could be read.']
  }

  const off = rows.filter(isOffPin)
  const lines: Array<string> = [
    ...MIRROR_SOURCE_NOTE,
    `${String(rows.length - off.length)} of ${String(rows.length)} repositories are at the revision repos.json pins.`,
  ]

  if (off.length === 0) {
    return lines
  }

  lines.push(
    `${String(off.length)} are NOT, so this run compared revisions the manifest does not name:`,
  )
  for (const row of off) {
    lines.push(
      `    ${row.name}  disk ${shortSha(row.head)}  pinned ${row.pinned === undefined ? 'unpinned' : shortSha(row.pinned)}` +
        (row.dirty ? '  (uncommitted changes — disk is not any revision)' : ''),
    )
  }
  lines.push(
    '`pnpm sync` puts repos/ back on the pins; `pnpm update:manifest` records where it actually is.',
  )

  return lines
}

/**
 * The whole report, as lines.
 *
 * Returned rather than printed so the message itself is testable — the same
 * convention `domain/workspace.ts` uses.
 *
 * The skip count is ALWAYS printed, even when it is zero and even when
 * everything passed. A check that silently skipped fifteen of fifteen looks
 * exactly like a check that passed fifteen of fifteen, and the difference is
 * the whole value of the tool.
 */
export const describeMirrorRun = (
  outcomes: ReadonlyArray<MirrorOutcome>,
  registry: ReadonlyArray<KnownFinding> = KNOWN_FINDINGS,
): ReadonlyArray<string> => {
  const compared = outcomes.filter((outcome) => outcome._tag === 'Compared')
  const skipped = outcomes.filter((outcome) => outcome._tag === 'Skipped')
  const failing = failingOutcomes(outcomes)
  const lines: Array<string> = []

  if (compared.length === 0) {
    lines.push(
      `check:mirrors: nothing to compare — 0 of ${String(outcomes.length)} mirrors could be checked.`,
      'This is not a failure. repos/ is gitignored, so a fresh clone has nothing in it; run',
      '`pnpm sync` and then `pnpm install` to make this check do anything.',
    )
  } else {
    lines.push(
      `check:mirrors: compared ${String(compared.length)} of ${String(outcomes.length)} mirrors ` +
        `(${String(skipped.length)} skipped).`,
    )
  }

  for (const outcome of outcomes) {
    if (outcome._tag === 'Skipped') {
      lines.push(`  skip ${mirrorPath(outcome.spec)} — ${outcome.reason}`)
      continue
    }
    const counts =
      `${String(outcome.valuesCompared)} value(s), ${String(outcome.typesCompared)} type(s), ` +
      `${String(outcome.capabilitiesCompared)} capability probe(s), ` +
      `${String(outcome.propertiesCompared)} property probe(s)` +
      (outcome.propertiesCompared > 0
        ? ` over ${String(outcome.propertyIdsCompared)} id reading(s)`
        : '')
    const status =
      outcome.findings.length > 0 ? 'FAIL' : outcome.known.length > 0 ? 'KNOWN' : 'ok   '
    lines.push(
      `  ${status} ${mirrorPath(outcome.spec)} vs ${outcome.spec.source} — ${counts}` +
        (outcome.known.length > 0
          ? `, ${String(outcome.known.length)} known outstanding defect(s)`
          : ''),
    )
  }

  const known = outcomes.flatMap((outcome) =>
    outcome._tag === 'Compared' ? outcome.known.map((entry) => ({ spec: outcome.spec, ...entry })) : [],
  )

  if (known.length > 0) {
    lines.push('')
    lines.push(
      `${String(known.length)} known outstanding defect(s), recorded in KNOWN_FINDINGS in`,
      'domain/mirror-contract.ts. Each is REAL and each is a BUG; none of them can be fixed from',
      'this repository, because the file that carries it belongs to another one. They do not fail',
      'this run, so that mc-dev-meta stays verifiable by its own contributors — but they are',
      'printed every single time, and a new one, or a change to one of these, does fail.',
      '',
    )
    for (const item of known) {
      lines.push(describeMirrorFinding(item.spec, item.finding))
      lines.push(`      owner: ${item.entry.owner}`)
      lines.push(`      fix:   ${item.entry.fix}`)
      lines.push('')
    }
  }

  const stale = staleKnownFindings(outcomes, registry)
  if (stale.length > 0) {
    lines.push('')
    for (const entry of stale) {
      lines.push(
        `KNOWN_FINDINGS records a defect that this run did NOT find: ${entry.summary}`,
        'It has been fixed, or it has changed and been reported above as a new finding. Either',
        'way the entry is now suppressing nothing but the next occurrence. Delete it from',
        `domain/mirror-contract.ts. Its fingerprint is:\n      ${entry.fingerprint}`,
        '',
      )
    }
  }

  if (failing.length === 0) {
    return lines
  }

  lines.push('')
  for (const outcome of failing) {
    if (outcome._tag !== 'Compared') {
      continue
    }
    lines.push(`----- ${mirrorPath(outcome.spec)} vs ${outcome.spec.source} -----`)
    for (const finding of outcome.findings) {
      lines.push(describeMirrorFinding(outcome.spec, finding))
    }
    lines.push('')
  }

  lines.push(
    'A mirror and its source have drifted apart. Neither repository can see this on its own:',
    'the source is not a dependency of the mirror and cannot be until it is published, so both',
    "sides' tests pin their own copy and agree with themselves. Fix the mirror in its own",
    'repository — or, if the divergence is intended, record it in DECLARED_DIVERGENCES in',
    'domain/mirror-contract.ts with the reason, so that it becomes a reviewed line in a diff.',
    '',
    // Repeated here rather than only at the top, because this is the block a
    // failing run gets read from. The first time this gate failed, it named an
    // export the working copy plainly had, and nothing in the message said the
    // gate had not been looking at the working copy.
    ...MIRROR_SOURCE_NOTE,
  )

  return lines
}
