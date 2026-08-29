const UINT32_MODULUS = 0x1_0000_0000
const LCG_MULTIPLIER = 1_664_525
const LCG_INCREMENT = 1_013_904_223

const unsigned32 = (value: number): number => {
  const remainder = Math.trunc(value) % UINT32_MODULUS
  return remainder < 0 ? remainder + UINT32_MODULUS : remainder
}

const multiply32 = (left: number, right: number): number => {
  const product = Math.imul(unsigned32(left), unsigned32(right))
  return product < 0 ? product + UINT32_MODULUS : product
}

const nextState = (state: number, input: number): number =>
  unsigned32(multiply32(state + unsigned32(input), LCG_MULTIPLIER) + LCG_INCREMENT)

export const unitHash = (seed: number, ...coordinates: ReadonlyArray<number>): number => {
  let state = unsigned32(seed)
  for (const coordinate of coordinates) {
    state = nextState(state, coordinate)
  }
  state = nextState(state, 0x9e37_79b9)
  state = nextState(state, 0x85eb_ca6b)
  return state / UINT32_MODULUS
}

export const integerInRange = (
  seed: number,
  min: number,
  max: number,
  ...coordinates: ReadonlyArray<number>
): number => min + Math.floor(unitHash(seed, ...coordinates) * (max - min + 1))
