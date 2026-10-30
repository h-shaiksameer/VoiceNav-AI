import type { PlaceCategory } from "@/types/domain";
import { normalizeHindi } from "@/ai/language";

export const categories: { value: PlaceCategory; label: string; pattern: RegExp }[] = [
  { value: "fuel", label: "Petrol", pattern: /\b(petrol|gas|gasoline|fuel|filling)(?:\s+(?:stations?|pumps?))?\b/i },
  { value: "restaurant", label: "Restaurants", pattern: /\b(restaurants?|food|dining|khana|hotel)\b/i },
  { value: "hospital", label: "Hospitals", pattern: /\b(hospitals?|aspataal|aspatal|dawakhana)\b/i },
  { value: "pharmacy", label: "Pharmacies", pattern: /\b(pharmacy|pharmacies|chemists?|drugstores?|medical|dawai|dawa)\b/i },
  { value: "atm", label: "ATMs", pattern: /\b(atms?|cash machines?|cashpoints?)\b/i },
  { value: "parking", label: "Parking", pattern: /\b(parking|car parks?)\b/i },
  { value: "cafe", label: "Cafes", pattern: /\b(cafes?|coffee)\b/i },
  { value: "charging_station", label: "EV charging", pattern: /\b(ev|chargers?|charging)\b/i },
];

export const categoryLabel = (category: PlaceCategory) => categories.find((item) => item.value === category)?.label ?? category;
export const matchingCategories = (text: string) => categories.filter((item) => item.pattern.test(normalizeHindi(text)));