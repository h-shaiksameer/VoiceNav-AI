import "server-only";
import { z } from "zod";
import { lineString, point } from "@turf/helpers";
import pointToLineDistance from "@turf/point-to-line-distance";
import type { PlaceResult } from "@/types/domain";
import { placesRequestSchema } from "@/types/schemas";
import { distanceBetween } from "@/utils/geo";
import { cached, ServiceError, throttle, upstream } from "@/services/server/http";

const responseSchema = z.object({
  remark: z.string().optional(),
  elements: z.array(z.object({
    type: z.enum(["node", "way", "relation"]), id: z.number(),
    lat: z.number().optional(), lon: z.number().optional(),
    center: z.object({ lat: z.number(), lon: z.number() }).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })),
});

export async function findPlaces(input: z.infer<typeof placesRequestSchema>, identity: string): Promise<PlaceResult[]> {
  const coordinates = input.geometry?.coordinates;
  if (input.scope === "route" && coordinates) {
    let length = 0;
    for (let index = 1; index < coordinates.length; index += 1) length += distanceBetween({ lat: coordinates[index - 1][1], lon: coordinates[index - 1][0] }, { lat: coordinates[index][1], lon: coordinates[index][0] });
    if (length > 150_000) throw new ServiceError("Along-route searches currently support routes up to 150 km. Use a nearby search for this journey.", 422);
  }
  const key = `places:${JSON.stringify(input)}`;
  return cached(key, 180_000, async () => {
    throttle("overpass", 5000);
    let around = `around:5000,${input.center.lat},${input.center.lon}`;
    if (input.scope === "route" && coordinates) {
      const stride = Math.max(1, Math.ceil(coordinates.length / 160));
      const sampled = coordinates.filter((_, index) => index % stride === 0 || index === coordinates.length - 1);
      around = `around:1500,${sampled.map(([lon, lat]) => `${lat},${lon}`).join(",")}`;
    }
    const query = `[out:json][timeout:20];nwr["amenity"="${input.category}"](${around});out center tags 150;`;
    const result = responseSchema.parse(await upstream(process.env.OVERPASS_BASE_URL || "https://overpass-api.de/api/interpreter", identity, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }).toString(),
    }));
    if (result.remark) throw new ServiceError("The place search could not finish. Please retry later; partial results have not been used.", 504);
    const line = input.scope === "route" && coordinates ? lineString(coordinates) : null;
    const places: PlaceResult[] = [];
    for (const item of result.elements) {
      const lat = item.lat ?? item.center?.lat;
      const lon = item.lon ?? item.center?.lon;
      if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const distanceMeters = line ? pointToLineDistance(point([lon, lat]), line, { units: "meters" }) : distanceBetween(input.center, { lat, lon });
      if (line && distanceMeters > 1500) continue;
      const tags = item.tags ?? {};
      const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" ");
      places.push({ id: `osm:${item.type}:${item.id}`, name: tags.name || tags.brand || `Unnamed ${input.category.replaceAll("_", " ")}`, lat, lon, category: input.category, distanceMeters, address: address || undefined, openingHours: tags.opening_hours, website: tags.website });
    }
    return places.sort((first, second) => first.distanceMeters - second.distanceMeters).slice(0, 12);
  });
}