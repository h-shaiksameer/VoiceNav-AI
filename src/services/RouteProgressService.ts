import type { Coordinates, RouteResult, TrackedLocation } from "@/types/domain";
import { distanceBetween } from "@/utils/geo";

export type RouteProgress = {
  completedDistanceMeters: number;
  remainingDistanceMeters: number;
  remainingDurationSeconds: number;
  percentage: number;
  distanceFromRouteMeters: number;
  offRoute: boolean;
  arrived: boolean;
};

function segmentProjection(point: Coordinates, start: Coordinates, end: Coordinates) {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const x = (point.lon - start.lon) * scale;
  const y = point.lat - start.lat;
  const endX = (end.lon - start.lon) * scale;
  const endY = end.lat - start.lat;
  const length = endX ** 2 + endY ** 2;
  const ratio = length ? Math.max(0, Math.min(1, (x * endX + y * endY) / length)) : 0;
  const projected = { lat: start.lat + (end.lat - start.lat) * ratio, lon: start.lon + (end.lon - start.lon) * ratio };
  return { projected, ratio };
}

export function calculateRouteProgress(route: RouteResult, location: TrackedLocation, offRouteThresholdMeters = 80, arrivalThresholdMeters = 35): RouteProgress {
  const points = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  let bestDistance = Number.POSITIVE_INFINITY;
  let completedDistance = 0;
  let routeLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distanceBetween(points[index - 1], points[index]);
    const projection = segmentProjection(location, points[index - 1], points[index]);
    const distance = distanceBetween(location, projection.projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      completedDistance = routeLength + segmentLength * projection.ratio;
    }
    routeLength += segmentLength;
  }
  const ratio = routeLength ? Math.max(0, Math.min(1, completedDistance / routeLength)) : 0;
  return {
    completedDistanceMeters: completedDistance,
    remainingDistanceMeters: Math.max(0, routeLength - completedDistance),
    remainingDurationSeconds: route.durationSeconds * (1 - ratio),
    percentage: Math.round(ratio * 100),
    distanceFromRouteMeters: bestDistance,
    offRoute: bestDistance > offRouteThresholdMeters,
    arrived: distanceBetween(location, points.at(-1) ?? location) <= arrivalThresholdMeters,
  };
}