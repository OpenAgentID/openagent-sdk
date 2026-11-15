/**
 * The 16 px distinctness method from the avatar family design (§11): coverage of a silhouette on a 16 × 16 grid
 * (4 × 4 supersampled, the head box -100..100), and the L1 difference between two coverages in pixels.
 */
type Pt = readonly [number, number];

function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Coverage of the union of `polys` at `px` pixels. */
export function coverage(polys: readonly (readonly Pt[])[], px = 16): Float64Array {
  const grid = new Float64Array(px * px), ss = 4;
  for (let r = 0; r < px; r++) for (let c = 0; c < px; c++) {
    let hit = 0;
    for (let a = 0; a < ss; a++) for (let b = 0; b < ss; b++) {
      const x = -100 + (c + (b + 0.5) / ss) * 200 / px, y = -100 + (r + (a + 0.5) / ss) * 200 / px;
      if (polys.some(poly => inside(poly, x, y))) hit++;
    }
    grid[r * px + c] = hit / (ss * ss);
  }
  return grid;
}

export function difference(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i]! - b[i]!);
  return total;
}
