import type { OptimizedStops, TravelMatrix } from "./types";

const MAX_EXACT_STOPS = 10;

function score(order: number[], matrix: TravelMatrix): { distance: number; duration: number } {
  let distance = 0;
  let duration = 0;
  for (let index = 1; index < order.length; index += 1) {
    distance += matrix.distancesMeters[order[index - 1]][order[index]];
    duration += matrix.durationsSeconds[order[index - 1]][order[index]];
  }
  return { distance, duration };
}

function nearestNeighbor(matrix: TravelMatrix): number[] {
  const remaining = new Set(matrix.distancesMeters.map((_, index) => index));
  const order: number[] = [];
  let current = 0;
  while (remaining.size) {
    order.push(current);
    remaining.delete(current);
    const next = [...remaining].sort((first, second) => matrix.durationsSeconds[current][first] - matrix.durationsSeconds[current][second])[0];
    if (next === undefined) break;
    current = next;
  }
  return order;
}

export function optimizeStops(matrix: TravelMatrix): OptimizedStops {
  const count = matrix.distancesMeters.length;
  if (count < 2 || matrix.durationsSeconds.some((row) => row.length !== count) || matrix.distancesMeters.some((row) => row.length !== count)) throw new Error("At least two valid locations and a complete travel matrix are required.");
  if (count > MAX_EXACT_STOPS) {
    const order = nearestNeighbor(matrix);
    const totals = score(order, matrix);
    return { order, startIndex: order[0], totalDistanceMeters: totals.distance, totalDurationSeconds: totals.duration };
  }

  let best: OptimizedStops | null = null;
  for (let start = 0; start < count; start += 1) {
    const remaining = ((1 << count) - 1) ^ (1 << start);
    const memo = new Map<string, { distance: number; duration: number; order: number[] }>();
    function visit(current: number, mask: number): { distance: number; duration: number; order: number[] } {
      if (!mask) return { distance: 0, duration: 0, order: [current] };
      const key = `${current}:${mask}`;
      const cached = memo.get(key);
      if (cached) return cached;
      let choice: { distance: number; duration: number; order: number[] } | null = null;
      for (let next = 0; next < count; next += 1) {
        if (!(mask & (1 << next))) continue;
        const tail = visit(next, mask ^ (1 << next));
        const candidate = {
          distance: matrix.distancesMeters[current][next] + tail.distance,
          duration: matrix.durationsSeconds[current][next] + tail.duration,
          order: [current, ...tail.order],
        };
        if (!choice || candidate.duration < choice.duration || candidate.duration === choice.duration && candidate.distance < choice.distance) choice = candidate;
      }
      if (!choice) throw new Error("Unable to optimize the selected stops.");
      memo.set(key, choice);
      return choice;
    }
    const result = visit(start, remaining);
    if (!best || result.duration < best.totalDurationSeconds || result.duration === best.totalDurationSeconds && result.distance < best.totalDistanceMeters) best = { order: result.order, startIndex: start, totalDistanceMeters: result.distance, totalDurationSeconds: result.duration };
  }
  if (!best) throw new Error("Unable to optimize the selected stops.");
  return best;
}
