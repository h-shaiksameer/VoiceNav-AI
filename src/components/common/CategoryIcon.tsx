import { Banknote, Coffee, Fuel, Hospital, ParkingCircle, Pill, PlugZap, Utensils } from "lucide-react";
import type { PlaceCategory } from "@/types/domain";

export function CategoryIcon({ category, size = 18 }: { category: PlaceCategory; size?: number }) {
  const Icon = { fuel: Fuel, restaurant: Utensils, hospital: Hospital, pharmacy: Pill, atm: Banknote, parking: ParkingCircle, cafe: Coffee, charging_station: PlugZap }[category];
  return <Icon size={size} aria-hidden="true" />;
}