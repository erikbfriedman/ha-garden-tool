/**
 * SVG path data for plant icons, water icons, and yard object icons.
 * All paths use viewBox="0 0 32 32".
 */

export const PICONS = [
  { id: 'leaf',     label: 'Leaf',     path: 'M16 4 C8 8 6 16 10 26 C14 20 20 16 26 14 C20 10 16 4 16 4Z' },
  { id: 'tomato',   label: 'Tomato',   path: 'M16 8a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0-4v4m-3-3l2 3m4-3l-2 3' },
  { id: 'pepper',   label: 'Pepper',   path: 'M16 4v5m0 0c0 0-8 2-8 10a8 8 0 0 0 16 0c0-8-8-10-8-10z' },
  { id: 'herb',     label: 'Herb',     path: 'M16 28 C16 28 8 20 8 14 S12 6 16 6 S24 10 24 14 S16 28 16 28Z M16 6 L16 28' },
  { id: 'carrot',   label: 'Carrot',   path: 'M16 6 C14 6 12 8 12 12 L14 28 L16 26 L18 28 L20 12 C20 8 18 6 16 6Z M13 7 C11 5 9 4 8 6 M19 7 C21 5 23 4 24 6' },
  { id: 'lettuce',  label: 'Lettuce',  path: 'M16 26 C10 26 6 22 6 16 C6 10 10 8 16 8 C22 8 26 10 26 16 C26 22 22 26 16 26Z M10 12 C12 14 14 16 16 16 M22 12 C20 14 18 16 16 16' },
  { id: 'zucchini', label: 'Zucchini', path: 'M8 8 C6 10 6 20 8 24 L12 26 L20 26 L24 24 C26 20 26 10 24 8 L20 6 L12 6 Z M16 6 L16 10 M10 8 L14 14 M22 8 L18 14' },
  { id: 'cucumber', label: 'Cucumber', path: 'M11 6 C9 8 9 24 11 26 L21 26 C23 24 23 8 21 6 Z M11 14 L21 14 M16 6 L16 8 M16 24 L16 26' },
  { id: 'sunflower',label: 'Sunflower',path: 'M16 16m-5 0a5 5 0 1 0 10 0 5 5 0 1 0-10 0 M16 5 L16 8 M16 24 L16 27 M5 16 L8 16 M24 16 L27 16 M8 8 L10 10 M22 22 L24 24 M24 8 L22 10 M10 22 L8 24' },
  { id: 'flower',   label: 'Flower',   path: 'M16 16m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M16 6 C14 8 14 12 16 13 C18 12 18 8 16 6Z M16 26 C14 24 14 20 16 19 C18 20 18 24 16 26Z M6 16 C8 14 12 14 13 16 C12 18 8 18 6 16Z M26 16 C24 14 20 14 19 16 C20 18 24 18 26 16Z' },
  { id: 'vine',     label: 'Vine',     path: 'M6 26 C8 20 12 18 16 16 C20 14 22 12 24 8 M10 22 C10 18 12 16 16 16 M20 10 C18 12 16 14 16 16' },
  { id: 'berry',    label: 'Berry',    path: 'M10 20a6 6 0 1 0 12 0 6 6 0 0 0-12 0 M10 20 C8 16 10 12 16 10 M22 20 C24 16 22 12 16 10 M16 10 L16 6' },
];

export const WICONS = [
  { id: 'full',  label: 'Full circle', path: 'M16 16m-6 0a6 6 0 1 0 12 0 6 6 0 1 0-12 0 M16 4 L16 8 M16 24 L16 28 M4 16 L8 16 M24 16 L28 16' },
  { id: 'arc90', label: 'Arc 90°',    path: 'M16 16 L24 16 A8 8 0 0 0 16 8 Z M16 10 L16 14 M22 10 L18 14' },
  { id: 'rotor', label: 'Rotary',     path: 'M16 16m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0 M16 16 L22 10 M16 16 L10 22 M16 16 L20 22 M16 16 L12 10' },
  { id: 'drip',  label: 'Drip',       path: 'M6 16 L26 16 M10 12 L10 20 M16 12 L16 20 M22 12 L22 20' },
  { id: 'micro', label: 'Micro',      path: 'M16 10 L16 22 M10 14 L16 10 L22 14' },
];

// Faucet icon (inline SVG for canvas use)
export const FAUCET_PATH = 'M8 20 L8 14 L12 14 L12 10 L20 10 L20 14 L24 14 L24 16 L28 16 L28 20 Z M12 20 L12 24 L16 28 M16 14 L16 20';

// Pipe icon
export const PIPE_PATH = 'M4 16 L28 16 M8 12 L8 20 M24 12 L24 20';
