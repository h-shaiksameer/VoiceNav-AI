"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { Location } from "@/types/domain";
import { searchLocations } from "@/services/client";
import { distanceBetween } from "@/utils/geo";

type Props = { label: string; value: Location | null; reference?: Location; onChange: (value: Location | null) => void; disabled?: boolean; children?: React.ReactNode };

export function LocationField({ label, value, reference, onChange, disabled, children }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const id = `location-${label.toLowerCase()}`;

  async function search() {
    const text = (value?.name ?? query).trim();
    if (text.length < 3) { setError("Enter at least 3 characters."); return; }
    const current = ++request.current;
    setBusy(true); setError(""); setResults([]);
    try {
      const locations = await searchLocations(text, reference);
      if (current !== request.current) return;
      const choices = locations.filter((location) => !reference?.countryCode || location.countryCode === reference.countryCode)
        .sort((first, second) => reference ? distanceBetween(reference, first) - distanceBetween(reference, second) : 0).slice(0, 5);
      setResults(choices);
      if (!choices.length) setError(reference ? "No addresses found in the starting location's country. Try a more specific location." : "No addresses found. Try a more specific location.");
    } catch (error) {
      if (current === request.current) setError(error instanceof Error ? error.message : "Address search failed.");
    } finally { if (current === request.current) setBusy(false); }
  }

  return <div className="location-field">
    <div className="field-label"><label htmlFor={id}>{label}</label>{children}</div>
    <div className={`input-shell ${value ? "resolved" : ""}`}>
      <span className={`endpoint-dot ${label === "Origin" ? "origin-dot" : "destination-dot"}`} />
      <input id={id} value={value?.name ?? query} disabled={disabled} placeholder={label === "Origin" ? "Address or current location" : "Where are you heading?"} maxLength={300} autoComplete="off"
        onChange={(event) => { request.current += 1; setBusy(false); setQuery(event.target.value); onChange(null); setResults([]); setError(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} aria-describedby={error ? `${id}-error` : undefined} />
      <button type="button" className="icon-button" title={`Search ${label.toLowerCase()} address`} aria-label={`Search ${label.toLowerCase()} address`} disabled={disabled || busy} onClick={() => void search()}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />}
      </button>
    </div>
    {error && <p className="field-error" id={`${id}-error`} role="alert">{error}</p>}
    {results.length > 0 && <ul className="address-results" aria-label={`${label} search results`}>
      {results.map((location) => <li key={location.id}><button type="button" onClick={() => { onChange(location); setQuery(location.name); setResults([]); }}>{location.name}</button></li>)}
    </ul>}
  </div>;
}