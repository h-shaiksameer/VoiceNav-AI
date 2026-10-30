import type { Location } from "@/types/domain";
import { validCoordinates } from "@/utils/geo";

export function requestCurrentLocation(): Promise<Location> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { reject(new Error("Geolocation is not supported. Give a starting address instead.")); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      const location = { id: "device:current", lat: position.coords.latitude, lon: position.coords.longitude, name: "Current location" };
      if (!validCoordinates(location)) { reject(new Error("Your device returned an invalid location. Try again or give a starting address.")); return; }
      resolve(location);
    }, (error) => {
      reject(new Error(error.code === 1 ? "Location access was denied. Allow location access in browser settings while safely stopped, or give a starting address." : error.code === 3 ? "Location lookup timed out. Try again or give a starting address." : "Your current location is unavailable. Give a starting address instead."));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}