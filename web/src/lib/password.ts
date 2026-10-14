// No look-alike characters (0 O o 1 l I) so a generated password can be read aloud or retyped.
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%^&*-_+=?'
const ALL = LOWER + UPPER + DIGITS + SYMBOLS

/** Unbiased random integer in [0, max) using rejection sampling over crypto.getRandomValues. */
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % max
}

const pick = (set: string) => set[randomInt(set.length)]

/** A random password (default 16 characters) containing at least one lowercase, uppercase, digit and symbol. */
export function generatePassword(length = 16): string {
  const n = Math.max(length, 8)
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < n) chars.push(pick(ALL))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
