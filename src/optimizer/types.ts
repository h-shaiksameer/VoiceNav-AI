import type { Location, RouteResult } from "@/types/domain";

export type TrafficProfile = { departureTime?: string; trafficAware: boolean };

export type TravelMatrix = {
  distancesMeters: number[][];
  durationsSeconds: number[][];
  traffic: TrafficProfile;
};

export type RoutingMatrixProvider = {
  getMatrix(locations: Location[], traffic?: TrafficProfile): Promise<TravelMatrix>;
  getRoute(locations: Location[], traffic?: TrafficProfile): Promise<RouteResult>;
};

export type OptimizedStops = {
  order: number[];
  startIndex: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
};
