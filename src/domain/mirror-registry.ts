/**
 * The hand-maintained inventory of every provisional mirror in the workspace.
 *
 * Keeping this transcription separate from comparison logic makes changes to
 * the inventory reviewable without opening the implementation of the contract.
 */
import type { MirrorSpec } from './mirror-model'

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
  {
    repository: 'mc-render',
    file: 'domain/lod-vocabulary.ts',
    source: 'mc-meshing',
    // NOTHING IS RENAMED, and for this mirror that is load-bearing rather than
    // incidental. `LOD_LEVELS`, `LodLevel`, `LodLevelSchema`, `STEP_FOR_LOD` and
    // `CHUNK_SIZE` all keep mc-meshing's spelling. The rule the organisation
    // learned from `isSupportSensitiveRule`: a renamed mirror type-checks,
    // passes every test, matches on shape, and fails on the one day the import
    // is repointed — because the name it was renamed TO does not exist upstream.
    // When a mirror name collides with a local one, the local one moves.
    renamedTypes: [],
    // No capability table on either side: `STEP_FOR_LOD` is a table of NUMBERS
    // keyed by level, not of predicates keyed by block id, so neither probe kind
    // applies. It is compared by the ordinary value comparison, which is what
    // this gate does with any exported const — and that is sufficient here in a
    // way it was NOT for `opacityOfBlockId`, because the table is three entries
    // over a closed union rather than a lookup over 120 block ids.
    capabilities: [],
    properties: [],
  },
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
  {
    repository: 'mc-sim',
    file: 'domain/worldgen-vocabulary.ts',
    source: 'mc-worldgen',
    renamedTypes: [],
    capabilities: [],
    properties: [],
    // THE FIRST ROW IN THIS LIST WHOSE MIRROR IS A CLOSED UNION AND NOTHING
    // ELSE, and the blind spot recorded on mc-sim's `kernel-vocabulary` row
    // applies to it in full rather than in part.
    //
    // This mirror carries exactly one declaration — `Dimension`, a three-member
    // literal union — and MEMBERSHIP IS THE TYPE. Neither probe kind reads a
    // union's members: `observeValue` in `scripts/check-mirrors.ts` cannot see a
    // type at all, and a type-only module exports no runtime value for it to
    // compare. So this row asserts that the FILE EXISTS and that its source
    // repository is mc-worldgen, and it asserts nothing whatever about whether
    // the union still has three members or the same three.
    //
    // That is the roster blind spot mc-sim's other row paid seventy-four missing
    // literals for, and the row is added anyway for the reason that one gives:
    // a mirror ABSENT from this list is a mirror `scripts/check-mirrors.ts` will
    // not even report as vanished, and `check:repoint` — which is what actually
    // caught the `ITEM_TYPES` drift, by deleting the mirror and typechecking
    // against the real module — reads `REPOINT_SPECS` against this list and
    // rejects any repoint spec naming a mirror `MIRROR_SPECS` has never heard
    // of. Registering it is what makes the stronger gate able to see it.
    //
    // Until the roster probe exists, `mc-sim/test/worldgen-mirror.test.ts` pins
    // the three members from inside mc-sim. That is the weaker guarantee — a
    // test the mirroring repository could edit in the same commit that breaks it
    // — and this row should not be read as covering it.
  },
]
