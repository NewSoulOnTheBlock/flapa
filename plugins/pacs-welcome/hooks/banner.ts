// A 5-row block font, so any persona's name can head the screen.
// '#' is ink; each glyph is 5 wide, with one column between letters.

const FONT: Record<string, readonly string[]> = {
  A: [' ### ', '#   #', '#####', '#   #', '#   #'],
  B: ['#### ', '#   #', '#### ', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#### ', '#    ', '#####'],
  F: ['#####', '#    ', '#### ', '#    ', '#    '],
  G: [' ####', '#    ', '#  ##', '#   #', ' ####'],
  H: ['#   #', '#   #', '#####', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '#####'],
  J: ['#####', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '###  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#### ', '#    ', '#    '],
  Q: [' ### ', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
  X: ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '   # ', '  #  ', ' #   ', '#####'],
  '0': [' ### ', '#  ##', '# # #', '##  #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '  ## ', ' #   ', '#####'],
  '3': ['#### ', '    #', ' ### ', '    #', '#### '],
  '4': ['#   #', '#   #', '#####', '    #', '    #'],
  '5': ['#####', '#    ', '#### ', '    #', '#### '],
  '6': [' ### ', '#    ', '#### ', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', '  #  '],
  '8': [' ### ', '#   #', ' ### ', '#   #', ' ### '],
  '9': [' ### ', '#   #', ' ####', '    #', ' ### '],
  '-': ['     ', '     ', '#####', '     ', '     '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
}

export const BANNER_ROWS = 5

/** The name in block letters: five rows of █ and spaces, up to 12 characters. */
export function banner(name: string): string[] {
  const glyphs = [...name.toUpperCase().slice(0, 12)].map(c => FONT[c]).filter(g => g !== undefined)
  const rows: string[] = []
  for (let r = 0; r < BANNER_ROWS; r++) {
    rows.push(glyphs.map(g => g[r]!).join(' ').replaceAll('#', '█').replace(/\s+$/, ''))
  }
  return rows
}

export function bannerWidth(name: string): number {
  return Math.max(0, ...banner(name).map(r => r.length))
}

/** Row colors, top to bottom: a soft gradient so the banner reads as one piece. */
export const GRADIENT = ['#ff9ad5', '#f58bd8', '#d98be6', '#b993f0', '#98a2f5'] as const

export const PACS_STEPS = [
  { command: '/forge', what: 'interview → a full persona: voice, backstory, example posts, starting stances' },
  { command: '/persona import <file.json>', what: 'or bring one you wrote yourself' },
  { command: 'say hi', what: 'then talk to them: their mood, opinions and memories build as you go' },
] as const
