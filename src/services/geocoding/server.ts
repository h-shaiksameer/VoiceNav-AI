import "server-only";
import { z } from "zod";
import { cached, serializedGeocode, ServiceError, upstream } from "@/services/server/http";
import { countryCodeSchema } from "@/types/schemas";
import type { Coordinates, Location } from "@/types/domain";

const responseSchema = z.array(z.object({
  place_id: z.number(), osm_type: z.string().optional(), osm_id: z.number().optional(),
  lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180), display_name: z.string().min(1),
  address: z.object({ country_code: countryCodeSchema.optional() }).optional(),
}));

function phoneticQueries(query: string): string[] {
  const bases = [query, query.replace(/(.)\1+/g, "$1")];
  const variants = new Set(bases);
  for (const base of bases) {
    for (const [from, to] of [["kh", "q"], ["q", "kh"], ["oo", "u"], ["u", "oo"], ["ph", "f"], ["f", "ph"]] as const) {
      if (base.toLowerCase().includes(from)) variants.add(base.replace(new RegExp(from, "gi"), to));
    }
  }
  return [...variants].slice(0, 5);
}

async function countryAt(reference: Coordinates, identity: string): Promise<string> {
  return cached(`country:${reference.lat}:${reference.lon}`, 86_400_000, () => serializedGeocode(async () => {
    const url = new URL("reverse", `${(process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "")}/`);
    url.search = new URLSearchParams({ lat: String(reference.lat), lon: String(reference.lon), format: "jsonv2", zoom: "3", addressdetails: "1" }).toString();
    const result = z.object({ address: z.object({ country_code: countryCodeSchema.optional() }).optional() }).parse(await upstream(url, identity));
    if (!result.address?.country_code) throw new ServiceError("The starting location's country could not be verified. Select a more specific starting address and try again.");
    return result.address.country_code;
  }));
}

export async function geocode(query: string, identity: string, reference?: Coordinates, countryCode?: string): Promise<Location[]> {
  const country = countryCode ?? (reference ? await countryAt(reference, identity) : undefined);
  return cached(`geocode:v2:${country ?? "all"}:${query.toLowerCase()}`, 86_400_000, () => serializedGeocode(async () => {
    const baseUrl = `${(process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "")}/`;
    for (const candidate of phoneticQueries(query)) {
      const url = new URL("search", baseUrl);
      const params = new URLSearchParams({ q: candidate, format: "jsonv2", limit: "5", addressdetails: "1", "accept-language": "en" });
      if (country) params.set("countrycodes", country);
      url.search = params.toString();
      const results = responseSchema.parse(await upstream(url, identity)).filter((item) => !country || item.address?.country_code === country);
      if (results.length) return results.map((item) => ({ id: item.osm_type && item.osm_id ? `osm:${item.osm_type}:${item.osm_id}` : `nominatim:${item.place_id}`, lat: item.lat, lon: item.lon, name: item.display_name, countryCode: item.address?.country_code }));
    }
    return [];
  }));
}