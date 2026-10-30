"use client";

import { ArrowUpRight, GitCompareArrows, LoaderCircle, MapPin, RotateCw, X } from "lucide-react";
import type { DetourResult, PlaceCategory, PlaceResult } from "@/types/domain";
import type { PlaceSearch } from "@/conversation/ConversationEngine";
import { categories, categoryLabel } from "@/utils/categories";
import { formatDistance } from "@/utils/geo";
import { CategoryIcon } from "@/components/common/CategoryIcon";

type Props = {
  category: PlaceCategory; scope: "nearby" | "route"; search: PlaceSearch | null; selected: PlaceResult | null;
  detours: DetourResult[]; busy: boolean; hasRoute: boolean; error: string;
  unavailable?: string;
  onCategory: (category: PlaceCategory) => void; onScope: (scope: "nearby" | "route") => void;
  onSearch: () => void; onSelect: (place: PlaceResult | null) => void; onNavigate: (place: PlaceResult) => void; onCompare: () => void;
};

function safeWebsite(value?: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function PlaceResults(props: Props) {
  return <section className="places-panel" aria-labelledby="places-heading">
    <div className="section-heading compact"><div><span className="eyebrow">EXPLORE</span><h2 id="places-heading">Places on your way</h2></div><MapPin size={20} className="muted-icon" /></div>
    <div className="segmented" aria-label="Place search area">
      <button aria-pressed={props.scope === "nearby"} onClick={() => props.onScope("nearby")} disabled={props.busy || !!props.unavailable}>Nearby</button>
      <button aria-pressed={props.scope === "route"} onClick={() => props.onScope("route")} disabled={props.busy || !!props.unavailable || !props.hasRoute}>Along route</button>
    </div>
    <div className="category-grid" aria-label="Place category">
      {categories.map((category) => <button key={category.value} title={category.label} aria-pressed={props.category === category.value} onClick={() => props.onCategory(category.value)} disabled={props.busy || !!props.unavailable}><CategoryIcon category={category.value} /><span>{category.label}</span></button>)}
    </div>
    {props.unavailable && <div role="status"><strong>Places temporarily unavailable</strong><p className="field-error">{props.unavailable}</p>{props.search && <p className="data-note">Previous results are shown below.</p>}</div>}
    <button className="secondary-button full-width" onClick={props.onSearch} disabled={props.busy}>{props.busy ? <LoaderCircle size={16} className="spin" /> : props.unavailable ? <RotateCw size={16} /> : <MapPin size={16} />}{props.unavailable ? "Retry place service" : `Find ${categoryLabel(props.category).toLowerCase()}`}</button>
    {props.error && !props.unavailable && <p className="field-error" role="alert">{props.error}</p>}
    {props.search && <div className="results-heading"><span>{props.search.places.length} results · {props.search.scope === "route" ? "along route" : "near origin"}</span><button className="icon-button" onClick={props.onCompare} disabled={props.busy || !props.hasRoute || !props.search.places.length} title="Compare real driving detours for the first 3 results" aria-label="Compare driving detours"><GitCompareArrows size={17} /></button></div>}
    {!props.search ? !props.unavailable && <div className="places-empty"><MapPin size={25} /><p>Nearby places</p><span>No search results yet</span></div> : props.search.places.length === 0 ? <p className="empty-message">No matching places returned in this area.</p> : <ol className="place-list">
      {props.search.places.map((place, index) => {
        const detour = props.detours.find((item) => item.placeId === place.id);
        return <li key={place.id} className={props.selected?.id === place.id ? "selected" : ""}>
          <button className="place-row" onClick={() => props.onSelect(place)} aria-pressed={props.selected?.id === place.id}><span className="place-number">{index + 1}</span><div><strong>{place.name}</strong><span>{formatDistance(place.distanceMeters)} {props.search?.scope === "route" ? "from route" : "straight line"}</span>{detour && <span className="detour-label">{Math.abs(Math.round(detour.extraDurationSeconds / 60))} min {detour.extraDurationSeconds < 0 ? "less" : "extra"} driving</span>}</div><ArrowUpRight size={15} /></button>
        </li>;
      })}
    </ol>}
    {props.selected && <div className="place-detail">
      <div className="detail-title"><CategoryIcon category={props.selected.category} /><strong>{props.selected.name}</strong><button className="icon-button" title="Close place details" aria-label="Close place details" onClick={() => props.onSelect(null)}><X size={15} /></button></div>
      <dl><div><dt>Address</dt><dd>{props.selected.address || "Not available"}</dd></div><div><dt>Opening hours</dt><dd>{props.selected.openingHours || "Not available"}</dd></div><div><dt>Ratings</dt><dd>Not available</dd></div><div><dt>Website</dt><dd>{safeWebsite(props.selected.website) ? <a href={safeWebsite(props.selected.website)!} target="_blank" rel="noopener noreferrer">Visit website <ArrowUpRight size={12} /></a> : "Not available"}</dd></div><div><dt>Driving detour</dt><dd>{props.detours.some((item) => item.placeId === props.selected?.id) ? "Calculated above" : "Not available"}</dd></div></dl>
      <button className="secondary-button full-width" disabled={props.busy || !props.hasRoute} onClick={() => props.onNavigate(props.selected!)}><ArrowUpRight size={16} /> Navigate here</button>
    </div>}
    <p className="data-note places-note">OpenStreetMap data · Coverage and hours may be incomplete</p>
  </section>;
}