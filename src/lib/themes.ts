// The agent's colors: eight schemes, one chosen at setup. Each defines only base colors; the dashboard and the
// public window derive every tint from them (color-mix against the surface), so a dark scheme gets dark tints.
// The accent tokens keep their first names (pink, lav, mint, butter): read them as accent 1 to 4.

export type Theme = {
  id: string; name: string; vibe: string; dark: boolean
  bg: string; surface: string; ink: string; soft: string; faint: string; onAccent: string
  pink: string; lav: string; mint: string; butter: string; red: string; green: string
  /** Logo and headings. One of the families the pages load. */
  display: string
}

export const THEMES: readonly Theme[] = [
  { id: 'sakura', name: 'Sakura', vibe: 'pastel, bubbly, kawaii', dark: false,
    bg: '#fff3f9', surface: '#ffffff', ink: '#4a3558', soft: '#8a7398', faint: '#bba9c6', onAccent: '#ffffff',
    pink: '#ff7eb6', lav: '#a98bff', mint: '#3dd6a3', butter: '#ffb547', red: '#ff5c7a', green: '#23c48e', display: "'Baloo 2'" },
  { id: 'solar', name: 'Solar', vibe: 'gold and ember on ash: solemn, mythic', dark: true,
    bg: '#14110f', surface: '#1f1a16', ink: '#f3e6d0', soft: '#c2ab8a', faint: '#7d6b55', onAccent: '#1a120b',
    pink: '#ff8a3d', lav: '#f5c249', mint: '#7cc6ff', butter: '#ffd27a', red: '#ff5a4e', green: '#8fd18a', display: "'Cinzel'" },
  { id: 'midnight', name: 'Midnight', vibe: 'deep navy, cyan and violet', dark: true,
    bg: '#0b1020', surface: '#141b31', ink: '#e4ebff', soft: '#9aa7cf', faint: '#5b668c', onAccent: '#0b1020',
    pink: '#5ee1ff', lav: '#9c8cff', mint: '#4ce0b3', butter: '#ffc65c', red: '#ff6b81', green: '#3fd69b', display: "'Space Grotesk'" },
  { id: 'terminal', name: 'Terminal', vibe: 'black glass, phosphor green', dark: true,
    bg: '#050806', surface: '#0c120e', ink: '#c8f7d4', soft: '#7fbf8f', faint: '#41634a', onAccent: '#031006',
    pink: '#39ff88', lav: '#2fd3c4', mint: '#9dff5c', butter: '#ffe066', red: '#ff5f56', green: '#39ff88', display: "'JetBrains Mono'" },
  { id: 'paper', name: 'Paper', vibe: 'warm paper, black ink, quiet', dark: false,
    bg: '#f6f1e7', surface: '#fffdf8', ink: '#22201c', soft: '#5f5a50', faint: '#a39b8b', onAccent: '#fffdf8',
    pink: '#2b2a27', lav: '#7a6a4f', mint: '#3f7d5c', butter: '#c08a2e', red: '#b3402e', green: '#3f7d5c', display: "'Fraunces'" },
  { id: 'ocean', name: 'Ocean', vibe: 'sea glass, teal and coral', dark: false,
    bg: '#eef9fb', surface: '#ffffff', ink: '#16404d', soft: '#4f7d8a', faint: '#9cbcc4', onAccent: '#ffffff',
    pink: '#14a3b8', lav: '#3f7cff', mint: '#2ec4a0', butter: '#ff9f6b', red: '#ef5a6f', green: '#1fb58f', display: "'Space Grotesk'" },
  { id: 'synthwave', name: 'Synthwave', vibe: 'neon magenta and cyan on purple night', dark: true,
    bg: '#160b26', surface: '#22123a', ink: '#f6e8ff', soft: '#c5a6e8', faint: '#7a5aa0', onAccent: '#160b26',
    pink: '#ff3fb4', lav: '#28e7ff', mint: '#b26bff', butter: '#ffd166', red: '#ff4d6d', green: '#3ef2b0', display: "'Baloo 2'" },
  { id: 'forest', name: 'Forest', vibe: 'moss, bark and amber', dark: true,
    bg: '#10150f', surface: '#1a2218', ink: '#e8efd9', soft: '#a9b98f', faint: '#5f6f50', onAccent: '#10150f',
    pink: '#9ccf5f', lav: '#e0a940', mint: '#5fbf9f', butter: '#f0c85a', red: '#e8664f', green: '#7fd46b', display: "'Fraunces'" },
]

export const DEFAULT_THEME = THEMES[0]!
export const themeById = (id: unknown): Theme | undefined => THEMES.find(t => t.id === id)
