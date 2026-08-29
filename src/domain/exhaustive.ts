/**
 * The `default` arm of an otherwise-exhaustive switch over a discriminated
 * union's tag.
 *
 * TypeScript already proves exhaustiveness at the call site — `value` only
 * typechecks as `never` when every other case has been handled — so this
 * never runs today. It exists for the day a union gains a new arm without
 * every switch over it being updated: `mirror-model.ts` calls that exact
 * defect "a dropped arm is not a narrower type" when it appears across a
 * repository boundary, and a missing `default` here is the same defect
 * appearing across a code-review boundary instead.
 */
export const assertUnreachable = (value: never): never => {
  throw new Error(`unreachable case: ${JSON.stringify(value)}`)
}
