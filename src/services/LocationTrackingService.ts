import type { LocationTrackingStatus, TrackedLocation } from "@/types/domain";
import { validCoordinates } from "@/utils/geo";

type TrackingCallbacks = {
  onLocation: (location: TrackedLocation) => void;
  onStatus: (status: LocationTrackingStatus, message?: string) => void;
};

const options: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };

export class LocationTrackingService {
  private watchId: number | null = null;
  private latest: TrackedLocation | null = null;

  constructor(private readonly callbacks: TrackingCallbacks) {}

  getLatest(): TrackedLocation | null { return this.latest; }

  start(): void {
    if (this.watchId !== null) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      this.callbacks.onStatus("unavailable", "Continuous location tracking is not supported by this browser.");
      return;
    }
    this.callbacks.onStatus("waiting");
    this.watchId = navigator.geolocation.watchPosition(this.accept, this.handleError, options);
  }

  pause(): void {
    if (this.watchId === null) return;
    navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.callbacks.onStatus("paused");
  }

  stop(): void {
    if (this.watchId !== null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.latest = null;
    this.callbacks.onStatus("idle");
  }

  private accept = (position: GeolocationPosition): void => {
    const timestamp = position.timestamp;
    const accuracyMeters = position.coords.accuracy;
    const location = { id: "device:current", lat: position.coords.latitude, lon: position.coords.longitude, name: "Current location", accuracyMeters, timestamp };
    if (!validCoordinates(location) || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
      this.callbacks.onStatus("error", "Your device returned an invalid location.");
      return;
    }
    if (this.latest && timestamp <= this.latest.timestamp) return;
    if (this.latest && accuracyMeters > this.latest.accuracyMeters * 3 && timestamp - this.latest.timestamp < 30000) return;
    this.latest = location;
    this.callbacks.onStatus("active");
    this.callbacks.onLocation(location);
  };

  private handleError = (error: GeolocationPositionError): void => {
    if (error.code === 1) this.callbacks.onStatus("permission_denied", "Location access was denied. Allow it in browser settings while safely stopped.");
    else if (error.code === 2) this.callbacks.onStatus("unavailable", "Your current location is temporarily unavailable. Waiting for recovery.");
    else this.callbacks.onStatus("error", "Location lookup timed out. Waiting for another fix.");
  };
}