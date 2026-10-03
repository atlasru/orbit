export const PAGE_SIZE = 8;
export type Point = { x: number; y: number };
export function ringPoints(count: number, radius = 166): Point[] {
  return Array.from({ length: count }, (_, i) => ({ x: Math.sin(2 * Math.PI * i / count) * radius, y: -Math.cos(2 * Math.PI * i / count) * radius }));
}
export function pageItems<T>(items: T[], page: number): T[] { return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE); }
export function directionalIndex(index: number, key: string, count: number): number {
  const points = ringPoints(count);
  if (count < 2) return 0;
  const direction: Point = key === 'ArrowUp' ? { x: 0, y: -1 } : key === 'ArrowDown' ? { x: 0, y: 1 } : key === 'ArrowLeft' ? { x: -1, y: 0 } : { x: 1, y: 0 };
  const origin = points[index] ?? points[0];
  let best = index, score = -Infinity;
  for (let i = 0; i < count; i++) {
    if (i === index) continue;
    const dx = points[i].x - origin.x, dy = points[i].y - origin.y;
    const distance = Math.hypot(dx, dy), dot = dx * direction.x + dy * direction.y;
    if (dot <= 0.1) continue;
    const current = dot / distance - distance / 4000;
    if (current > score) { score = current; best = i; }
  }
  return best;
}
