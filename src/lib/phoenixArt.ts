/**
 * The Daily header's phoenix, traced from `public/img/phoenix.jpg`.
 *
 * Same job as the castle on Habits, and the same reason: that file is a
 * pixel chart with its grid lines baked into the pixels, so drawing it at
 * header size showed the lattice as clearly as the bird.
 *
 * The chart is a clean 90 x 23, so nothing was eyeballed — every cell centre
 * was sampled, snapped to the five colours the chart actually uses, and the
 * cells merged into rectangles by growing each one right and then down.
 * 2070 cells become 684 rectangles, and those become four paths, one per
 * colour: four DOM nodes for the whole bird.
 *
 * ~9KB of path data against the JPEG's 53KB, sharp at any size, and the
 * sheet the bird was stitched on is simply absent rather than painted black,
 * so the header's own gradient shows through behind it.
 *
 * This lives in its own module rather than next to the component that draws
 * it because a constant exported from a component file breaks React Fast
 * Refresh for that whole file — the bug that was making the Habits tab
 * throw away its open sheet mid-edit.
 */
export const PHOENIX_VIEWBOX = '0 0 90 23'

/** [fill, path] in painting order, darkest first. */
export const PHOENIX_PATHS: [fill: string, d: string][] = [
  [
    '#4a0c0a',
      'M4 0h1v3h-1zM45 0h1v1h-1zM80 0h1v1h-1zM86 0h1v1h-1zM89 0h1v1h-1zM1 1h1v2h-1zM10 1h2v1h-2' +
      'zM22 1h1v2h-1zM47 1h1v1h-1zM50 1h1v2h-1zM67 1h2v1h-2zM75 1h1v1h-1zM79 1h1v1h-1zM83 1h2v1' +
      'h-2zM7 2h1v2h-1zM15 2h1v1h-1zM19 2h2v1h-2zM42 2h2v1h-2zM45 2h2v1h-2zM68 2h1v1h-1zM70 2h2' +
      'v1h-2zM8 3h1v1h-1zM24 3h1v4h-1zM39 3h1v1h-1zM42 3h1v1h-1zM44 3h1v1h-1zM46 3h2v1h-2zM74 3' +
      'h1v1h-1zM85 3h2v1h-2zM1 4h1v1h-1zM4 4h2v1h-2zM13 4h1v1h-1zM16 4h1v1h-1zM18 4h1v1h-1zM41 ' +
      '4h1v1h-1zM47 4h1v2h-1zM71 4h2v1h-2zM81 4h1v1h-1zM85 4h1v3h-1zM5 5h1v1h-1zM14 5h1v1h-1zM4' +
      '0 5h1v1h-1zM49 5h1v1h-1zM68 5h1v1h-1zM71 5h1v2h-1zM77 5h1v4h-1zM89 5h1v3h-1zM4 6h1v1h-1z' +
      'M9 6h1v1h-1zM21 6h1v1h-1zM38 6h2v1h-2zM46 6h1v1h-1zM69 6h1v1h-1zM75 6h1v1h-1zM86 6h2v1h-' +
      '2zM3 7h1v2h-1zM6 7h1v1h-1zM10 7h2v1h-2zM13 7h2v1h-2zM19 7h1v1h-1zM28 7h1v2h-1zM37 7h2v2h' +
      '-2zM41 7h2v1h-2zM47 7h1v1h-1zM62 7h1v1h-1zM66 7h1v1h-1zM70 7h1v1h-1zM76 7h1v1h-1zM80 7h1' +
      'v1h-1zM84 7h1v1h-1zM13 8h1v1h-1zM16 8h1v1h-1zM26 8h1v1h-1zM35 8h1v1h-1zM40 8h1v2h-1zM48 ' +
      '8h1v4h-1zM50 8h1v1h-1zM64 8h1v1h-1zM75 8h1v1h-1zM79 8h1v1h-1zM5 9h1v1h-1zM7 9h1v1h-1zM12' +
      ' 9h1v1h-1zM34 9h1v2h-1zM41 9h1v1h-1zM43 9h2v1h-2zM62 9h1v1h-1zM65 9h1v1h-1zM78 9h1v1h-1z' +
      'M85 9h1v1h-1zM8 10h1v1h-1zM16 10h1v1h-1zM24 10h1v1h-1zM28 10h1v1h-1zM36 10h1v2h-1zM45 10' +
      'h1v2h-1zM1 11h1v1h-1zM5 11h1v1h-1zM7 11h1v1h-1zM9 11h1v1h-1zM18 11h1v1h-1zM39 11h3v1h-3z' +
      'M43 11h2v1h-2zM49 11h1v4h-1zM51 11h1v2h-1zM60 11h1v1h-1zM73 11h1v1h-1zM85 11h2v1h-2zM32 ' +
      '12h1v1h-1zM38 12h1v1h-1zM40 12h2v1h-2zM44 12h1v2h-1zM58 12h1v1h-1zM71 12h1v1h-1zM88 12h1' +
      'v1h-1zM6 13h1v1h-1zM10 13h1v1h-1zM12 13h1v2h-1zM21 13h1v2h-1zM34 13h1v1h-1zM36 13h1v1h-1' +
      'zM43 13h1v3h-1zM55 13h1v1h-1zM69 13h1v1h-1zM78 13h1v2h-1zM85 13h1v1h-1zM2 14h1v1h-1zM13 ' +
      '14h2v1h-2zM19 14h1v1h-1zM22 14h1v1h-1zM24 14h1v1h-1zM66 14h1v2h-1zM68 14h1v2h-1zM70 14h1' +
      'v1h-1zM76 14h2v1h-2zM6 15h1v1h-1zM14 15h3v1h-3zM20 15h1v1h-1zM26 15h1v2h-1zM42 15h1v1h-1' +
      'zM64 15h1v2h-1zM74 15h3v1h-3zM84 15h1v1h-1zM2 16h2v1h-2zM8 16h1v2h-1zM21 16h2v1h-2zM33 1' +
      '6h1v1h-1zM52 16h1v1h-1zM67 16h1v2h-1zM86 16h2v1h-2zM2 17h1v1h-1zM9 17h1v1h-1zM24 17h1v2h' +
      '-1zM35 17h1v1h-1zM41 17h1v1h-1zM66 17h1v1h-1zM10 18h1v1h-1zM25 18h2v1h-2zM36 18h1v3h-1zM' +
      '49 18h1v1h-1zM54 18h1v3h-1zM64 18h2v1h-2zM3 19h1v1h-1zM7 19h1v1h-1zM27 19h3v1h-3zM39 19h' +
      '1v1h-1zM52 19h2v1h-2zM61 19h3v1h-3zM80 19h1v2h-1zM83 19h1v2h-1zM9 20h2v1h-2zM13 20h1v1h-' +
      '1zM76 20h1v1h-1zM81 20h1v3h-1zM86 20h1v1h-1zM9 21h1v2h-1zM11 21h2v1h-2zM15 21h4v1h-4zM72' +
      ' 21h4v1h-4zM78 21h2v1h-2zM2 22h1v1h-1zM8 22h1v1h-1z',
  ],
  [
    '#a8260c',
      'M1 0h1v1h-1zM3 0h1v1h-1zM5 0h1v1h-1zM14 0h1v1h-1zM20 0h1v2h-1zM40 0h1v2h-1zM47 0h1v1h-1z' +
      'M85 0h1v1h-1zM7 1h1v1h-1zM43 1h1v1h-1zM80 1h1v1h-1zM23 2h1v1h-1zM44 2h1v1h-1zM48 2h1v2h-' +
      '1zM75 2h1v1h-1zM43 3h1v1h-1zM66 3h1v1h-1zM83 3h1v1h-1zM9 4h1v1h-1zM38 4h1v1h-1zM44 4h2v1' +
      'h-2zM74 4h1v1h-1zM76 4h2v1h-2zM86 4h1v2h-1zM1 5h1v3h-1zM3 5h2v1h-2zM22 5h1v1h-1zM39 5h1v' +
      '1h-1zM43 5h2v4h-2zM66 5h1v2h-1zM80 5h1v1h-1zM87 5h1v1h-1zM17 6h1v1h-1zM41 6h2v1h-2zM47 6' +
      'h1v1h-1zM81 6h1v1h-1zM84 6h1v1h-1zM40 7h1v1h-1zM71 7h1v1h-1zM87 7h1v2h-1zM39 8h1v2h-1zM4' +
      '2 8h1v3h-1zM45 8h1v2h-1zM47 8h1v1h-1zM62 8h1v1h-1zM81 8h1v1h-1zM83 8h1v1h-1zM0 9h2v1h-2z' +
      'M3 9h1v1h-1zM9 9h1v1h-1zM23 9h1v2h-1zM25 9h1v1h-1zM46 9h1v14h-1zM73 9h1v1h-1zM80 9h1v2h-' +
      '1zM89 9h1v1h-1zM0 10h1v1h-1zM6 10h1v1h-1zM10 10h1v2h-1zM13 10h2v1h-2zM40 10h2v1h-2zM49 1' +
      '0h1v1h-1zM67 10h1v1h-1zM74 10h1v1h-1zM76 10h2v1h-2zM79 10h1v3h-1zM84 10h2v1h-2zM11 11h1v' +
      '2h-1zM29 11h1v1h-1zM34 11h1v2h-1zM47 11h1v12h-1zM78 11h1v2h-1zM83 11h1v1h-1zM4 12h1v1h-1' +
      'zM8 12h1v1h-1zM12 12h2v1h-2zM19 12h1v1h-1zM21 12h2v1h-2zM36 12h1v1h-1zM39 12h1v1h-1zM43 ' +
      '12h1v1h-1zM45 12h1v11h-1zM48 12h1v3h-1zM68 12h1v1h-1zM77 12h1v2h-1zM2 13h1v1h-1zM13 13h3' +
      'v1h-3zM18 13h1v1h-1zM20 13h1v1h-1zM33 13h1v1h-1zM51 13h1v2h-1zM56 13h1v1h-1zM67 13h1v1h-' +
      '1zM70 13h1v1h-1zM75 13h2v1h-2zM80 13h1v1h-1zM5 14h1v1h-1zM15 14h3v1h-3zM37 14h1v1h-1zM54' +
      ' 14h1v1h-1zM71 14h1v9h-1zM73 14h3v1h-3zM83 14h1v1h-1zM3 15h1v1h-1zM10 15h1v1h-1zM17 15h3' +
      'v6h-3zM22 15h1v1h-1zM63 15h1v1h-1zM70 15h1v8h-1zM72 15h2v6h-2zM80 15h1v1h-1zM11 16h2v1h-' +
      '2zM15 16h2v3h-2zM20 16h1v7h-1zM23 16h1v1h-1zM25 16h1v1h-1zM41 16h1v1h-1zM44 16h1v7h-1zM4' +
      '8 16h1v7h-1zM54 16h1v1h-1zM69 16h1v7h-1zM74 16h2v3h-2zM77 16h3v1h-3zM12 17h3v1h-3zM21 17' +
      'h2v6h-2zM40 17h1v1h-1zM50 17h1v1h-1zM55 17h1v1h-1zM65 17h1v1h-1zM68 17h1v6h-1zM76 17h3v1' +
      'h-3zM14 18h1v1h-1zM23 18h1v5h-1zM27 18h1v1h-1zM33 18h1v5h-1zM43 18h1v5h-1zM51 18h2v1h-2z' +
      'M56 18h1v5h-1zM63 18h1v1h-1zM66 18h2v5h-2zM76 18h1v1h-1zM87 18h1v1h-1zM12 19h1v1h-1zM16 ' +
      '19h1v2h-1zM24 19h3v4h-3zM30 19h3v4h-3zM34 19h2v4h-2zM42 19h1v4h-1zM50 19h1v1h-1zM55 19h1' +
      'v4h-1zM57 19h4v4h-4zM64 19h2v4h-2zM74 19h1v2h-1zM78 19h1v1h-1zM14 20h2v1h-2zM27 20h3v3h-' +
      '3zM37 20h1v1h-1zM40 20h2v3h-2zM49 20h1v3h-1zM61 20h3v3h-3zM75 20h1v1h-1zM7 21h1v1h-1zM10' +
      ' 21h1v1h-1zM19 21h1v2h-1zM36 21h1v2h-1zM38 21h2v2h-2zM50 21h5v2h-5zM80 21h1v1h-1zM85 21h' +
      '1v1h-1zM13 22h6v1h-6zM37 22h1v1h-1zM72 22h6v1h-6zM82 22h1v1h-1zM87 22h1v1h-1z',
  ],
  [
    '#ce8a3a',
      'M12 0h1v1h-1zM44 0h1v2h-1zM49 0h1v1h-1zM70 0h1v2h-1zM76 0h1v1h-1zM78 0h1v1h-1zM83 0h1v1h' +
      '-1zM87 0h1v2h-1zM3 1h1v2h-1zM5 1h1v3h-1zM14 1h1v1h-1zM42 1h1v1h-1zM46 1h1v1h-1zM48 1h1v1' +
      'h-1zM71 1h1v1h-1zM85 1h1v2h-1zM6 2h1v1h-1zM8 2h1v1h-1zM10 2h2v1h-2zM40 2h1v1h-1zM67 2h1v' +
      '2h-1zM79 2h2v1h-2zM82 2h1v1h-1zM84 2h1v1h-1zM88 2h1v3h-1zM15 3h1v1h-1zM23 3h1v1h-1zM41 3' +
      'h1v1h-1zM45 3h1v1h-1zM7 4h1v1h-1zM14 4h1v1h-1zM40 4h1v1h-1zM42 4h2v1h-2zM46 4h1v2h-1zM48' +
      ' 4h2v1h-2zM66 4h1v1h-1zM2 5h1v1h-1zM6 5h1v2h-1zM8 5h1v1h-1zM10 5h1v1h-1zM12 5h1v3h-1zM16' +
      ' 5h1v1h-1zM18 5h1v2h-1zM41 5h2v1h-2zM45 5h1v3h-1zM72 5h1v2h-1zM82 5h1v5h-1zM84 5h1v1h-1z' +
      'M7 6h1v3h-1zM15 6h1v1h-1zM36 6h1v1h-1zM40 6h1v1h-1zM73 6h1v1h-1zM79 6h1v1h-1zM83 6h1v2h-' +
      '1zM8 7h1v3h-1zM23 7h1v2h-1zM39 7h1v1h-1zM46 7h1v2h-1zM49 7h1v1h-1zM69 7h1v1h-1zM74 7h1v1' +
      'h-1zM78 7h1v1h-1zM9 8h1v1h-1zM14 8h1v2h-1zM19 8h2v1h-2zM27 8h1v1h-1zM63 8h1v1h-1zM67 8h1' +
      'v2h-1zM70 8h2v1h-2zM76 8h1v2h-1zM10 9h2v1h-2zM15 9h1v1h-1zM17 9h1v1h-1zM35 9h2v1h-2zM38 ' +
      '9h1v1h-1zM47 9h1v2h-1zM49 9h2v1h-2zM75 9h1v1h-1zM81 9h1v2h-1zM87 9h1v2h-1zM3 10h1v1h-1zM' +
      '5 10h1v1h-1zM9 10h1v1h-1zM11 10h1v1h-1zM37 10h1v1h-1zM39 10h1v1h-1zM62 10h1v1h-1zM72 10h' +
      '1v1h-1zM78 10h1v1h-1zM89 10h1v1h-1zM12 11h3v1h-3zM16 11h1v1h-1zM23 11h2v1h-2zM28 11h1v1h' +
      '-1zM35 11h1v2h-1zM38 11h1v1h-1zM61 11h1v1h-1zM66 11h2v1h-2zM76 11h2v1h-2zM80 11h1v1h-1zM' +
      '88 11h1v1h-1zM2 12h1v1h-1zM6 12h1v1h-1zM14 12h2v1h-2zM17 12h1v2h-1zM31 12h1v1h-1zM37 12h' +
      '1v1h-1zM42 12h1v1h-1zM59 12h1v1h-1zM69 12h1v1h-1zM75 12h2v1h-2zM82 12h1v1h-1zM84 12h1v1h' +
      '-1zM86 12h1v1h-1zM9 13h1v3h-1zM16 13h1v1h-1zM23 13h1v1h-1zM38 13h1v1h-1zM57 13h1v1h-1zM7' +
      '2 13h3v1h-3zM81 13h1v2h-1zM83 13h1v1h-1zM7 14h1v1h-1zM11 14h1v2h-1zM18 14h1v1h-1zM25 14h' +
      '1v1h-1zM36 14h1v1h-1zM42 14h1v1h-1zM44 14h1v2h-1zM65 14h1v1h-1zM72 14h1v1h-1zM79 14h2v1h' +
      '-2zM85 14h1v1h-1zM87 14h1v1h-1zM8 15h1v1h-1zM12 15h2v1h-2zM23 15h1v1h-1zM27 15h8v1h-8zM4' +
      '8 15h1v1h-1zM51 15h1v2h-1zM53 15h1v1h-1zM56 15h7v1h-7zM67 15h1v1h-1zM77 15h3v1h-3zM82 15' +
      'h1v1h-1zM4 16h1v2h-1zM6 16h1v1h-1zM10 16h1v1h-1zM13 16h2v1h-2zM24 16h1v1h-1zM36 16h1v1h-' +
      '1zM43 16h1v2h-1zM50 16h1v1h-1zM65 16h2v1h-2zM76 16h1v1h-1zM81 16h1v1h-1zM7 17h1v1h-1zM11' +
      ' 17h1v2h-1zM25 17h10v1h-10zM37 17h1v2h-1zM42 17h1v2h-1zM53 17h1v1h-1zM56 17h9v1h-9zM83 1' +
      '7h1v1h-1zM85 17h3v1h-3zM3 18h1v1h-1zM6 18h1v3h-1zM8 18h1v2h-1zM13 18h1v2h-1zM28 18h5v1h-' +
      '5zM34 18h2v1h-2zM38 18h1v1h-1zM41 18h1v2h-1zM55 18h1v1h-1zM57 18h6v1h-6zM77 18h1v2h-1zM7' +
      '9 18h1v1h-1zM82 18h1v2h-1zM84 18h1v2h-1zM9 19h1v1h-1zM14 19h2v1h-2zM40 19h1v1h-1zM49 19h' +
      '1v1h-1zM75 19h2v1h-2zM81 19h1v1h-1zM86 19h1v1h-1zM4 20h1v1h-1zM38 20h2v1h-2zM50 20h4v1h-' +
      '4zM5 21h1v2h-1zM37 21h1v1h-1zM83 21h1v1h-1zM3 22h2v1h-2zM10 22h3v1h-3zM78 22h3v1h-3zM84 ' +
      '22h3v1h-3z',
  ],
  [
    '#f0e278',
      'M2 0h1v5h-1zM7 0h3v1h-3zM13 0h1v4h-1zM19 0h1v2h-1zM41 0h3v1h-3zM46 0h1v1h-1zM48 0h1v1h-1' +
      'zM71 0h1v1h-1zM77 0h1v4h-1zM81 0h2v2h-2zM88 0h1v2h-1zM8 1h2v1h-2zM12 1h1v4h-1zM41 1h1v2h' +
      '-1zM49 1h1v3h-1zM76 1h1v3h-1zM78 1h1v6h-1zM9 2h1v2h-1zM14 2h1v2h-1zM81 2h1v2h-1zM87 2h1v' +
      '3h-1zM3 3h1v2h-1zM6 3h1v2h-1zM10 3h2v2h-2zM40 3h1v1h-1zM75 3h1v3h-1zM79 3h2v2h-2zM84 3h1' +
      'v2h-1zM15 4h1v2h-1zM23 4h1v3h-1zM39 4h1v1h-1zM67 4h1v4h-1zM83 4h1v2h-1zM7 5h1v1h-1zM11 5' +
      'h1v2h-1zM37 5h2v1h-2zM48 5h1v3h-1zM74 5h1v2h-1zM79 5h1v1h-1zM88 5h1v6h-1zM2 6h1v6h-1zM8 ' +
      '6h1v1h-1zM16 6h1v2h-1zM22 6h1v6h-1zM37 6h1v1h-1zM68 6h1v6h-1zM9 7h1v1h-1zM17 7h2v2h-2zM2' +
      '1 7h1v5h-1zM36 7h1v2h-1zM72 7h2v2h-2zM81 7h1v1h-1zM10 8h1v1h-1zM41 8h1v1h-1zM49 8h1v1h-1' +
      'zM69 8h1v4h-1zM80 8h1v1h-1zM18 9h3v2h-3zM26 9h2v6h-2zM63 9h2v6h-2zM70 9h3v1h-3zM79 9h1v1' +
      'h-1zM1 10h1v1h-1zM12 10h1v1h-1zM15 10h1v2h-1zM25 10h1v4h-1zM35 10h1v1h-1zM38 10h1v1h-1zM' +
      '50 10h1v6h-1zM65 10h1v4h-1zM70 10h2v2h-2zM75 10h1v2h-1zM3 11h1v4h-1zM6 11h1v1h-1zM19 11h' +
      '2v1h-2zM37 11h1v1h-1zM62 11h1v4h-1zM74 11h1v2h-1zM84 11h1v1h-1zM87 11h1v3h-1zM7 12h1v2h-' +
      '1zM16 12h1v1h-1zM20 12h1v1h-1zM23 12h2v1h-2zM28 12h3v3h-3zM60 12h2v3h-2zM66 12h2v1h-2zM7' +
      '0 12h1v1h-1zM73 12h1v1h-1zM83 12h1v1h-1zM4 13h1v3h-1zM8 13h1v2h-1zM24 13h1v1h-1zM31 13h2' +
      'v2h-2zM35 13h1v3h-1zM39 13h4v1h-4zM58 13h2v2h-2zM66 13h1v1h-1zM82 13h1v2h-1zM86 13h1v3h-' +
      '1zM10 14h1v1h-1zM33 14h2v1h-2zM38 14h4v2h-4zM55 14h3v1h-3zM5 15h1v6h-1zM36 15h2v1h-2zM54' +
      ' 15h2v1h-2zM81 15h1v1h-1zM85 15h1v2h-1zM9 16h1v1h-1zM37 16h4v1h-4zM53 16h1v1h-1zM80 16h1' +
      'v2h-1zM84 16h1v2h-1zM3 17h1v1h-1zM6 17h1v1h-1zM10 17h1v1h-1zM38 17h2v1h-2zM51 17h2v1h-2z' +
      'M79 17h1v1h-1zM4 18h1v2h-1zM7 18h1v1h-1zM12 18h1v1h-1zM78 18h1v1h-1zM83 18h1v1h-1zM85 18' +
      'h2v1h-2zM85 19h1v2h-1zM84 20h1v2h-1zM6 21h1v2h-1zM7 22h1v1h-1zM83 22h1v1h-1z',
  ],
]
