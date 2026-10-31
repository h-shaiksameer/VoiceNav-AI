"use client";

import { startTransition, useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, MapPin, Plus, Route, Trash2 } from "lucide-react";
import type { Location, NavigationSession, RouteResult } from "@/types/domain";
import { LocationField } from "@/components/SearchPanel/LocationField";
import MapLoader from "@/components/MapView/MapLoader";
import { osrmOptimizerProvider } from "@/optimizer/osrmProvider";
import { optimizeStops } from "@/optimizer/optimize";
import type { OptimizedStops } from "@/optimizer/types";
import { formatDistance, formatDuration } from "@/utils/geo";

type Props = { onClose: () => void };

export type OptimizerState = { ordered: Location[]; route: RouteResult; result: OptimizedStops } | null;
type OptimizerDraft = { locations: (Location | null)[]; optimizer: OptimizerState };

export const optimizerStorageKey = (workspaceId: string) => `voicenav-optimizer:${workspaceId}`;

function readDraft(workspaceId: string): OptimizerDraft {
  if (typeof window === "undefined") return { locations: [null], optimizer: null };
  try {
    const stored = JSON.parse(window.localStorage.getItem(optimizerStorageKey(workspaceId)) || "null") as Partial<OptimizerDraft> | null;
    return { locations: Array.isArray(stored?.locations) && stored.locations.length ? stored.locations : [null], optimizer: stored?.optimizer ?? null };
  } catch { return { locations: [null], optimizer: null }; }
}

const emptySession: NavigationSession = { revision: 0, status: "idle", origin: null, destination: null, route: null };

type ExtendedProps = Props & { workspaceId: string; onDraftChange: (hasData: boolean) => void };

export function MultiStopOptimizer({ onClose, workspaceId, onDraftChange }: ExtendedProps) {
  const [locations, setLocations] = useState<(Location | null)[]>([null]);
  const [optimizer, setOptimizer] = useState<OptimizerState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const draft = readDraft(workspaceId);
    startTransition(() => {
      setLocations(draft.locations);
      setOptimizer(draft.optimizer);
    });
  }, [workspaceId]);

  function saveDraft(nextLocations: (Location | null)[], nextOptimizer: OptimizerState) {
    window.localStorage.setItem(optimizerStorageKey(workspaceId), JSON.stringify({ locations: nextLocations, optimizer: nextOptimizer } satisfies OptimizerDraft));
    onDraftChange(nextLocations.some(Boolean) || !!nextOptimizer);
  }

  function clearDraft() {
    const nextLocations: (Location | null)[] = [null];
    setLocations(nextLocations);
    setOptimizer(null);
    window.localStorage.removeItem(optimizerStorageKey(workspaceId));
    onDraftChange(false);
    setError("");
  }

  function updateLocation(index: number, location: Location | null) {
    if (location && locations.some((current, currentIndex) => currentIndex !== index && current?.id === location.id)) {
      setError("That location is already selected. Choose a different stop.");
      return;
    }
    const nextLocations = locations.map((item, itemIndex) => itemIndex === index ? location : item);
    setLocations(nextLocations);
    setOptimizer(null);
    saveDraft(nextLocations, null);
    setError("");
  }

  function addLocation() {
    if (locations.length < 12) {
      const nextLocations = [...locations, null];
      setLocations(nextLocations);
      saveDraft(nextLocations, optimizer);
    }
  }

  function removeLocation(index: number) {
    const nextLocations = locations.length === 1 ? locations : locations.filter((_, itemIndex) => itemIndex !== index);
    setLocations(nextLocations);
    setOptimizer(null);
    saveDraft(nextLocations, null);
  }

  async function optimize() {
    const selected = locations.filter((location): location is Location => location !== null);
    if (selected.length < 2 || new Set(selected.map((location) => location.id)).size !== selected.length) {
      setError("Select at least two different locations before optimizing.");
      return;
    }
    setBusy(true); setError("");
    try {
      const matrix = await osrmOptimizerProvider.getMatrix(selected, { trafficAware: false });
      const result = optimizeStops(matrix);
      const ordered = result.order.map((index) => selected[index]);
      const route = await osrmOptimizerProvider.getRoute(ordered, { trafficAware: false });
      const nextOptimizer = { ordered, route, result };
      setOptimizer(nextOptimizer);
      saveDraft(locations, nextOptimizer);
    } catch (reason) {
      setOptimizer(null);
      saveDraft(locations, null);
      setError(reason instanceof Error ? reason.message : "Unable to optimize this trip. Choose fewer or more accessible locations and retry.");
    } finally { setBusy(false); }
  }

  const optimizedSession: NavigationSession = optimizer ? { revision: optimizer.result.order.length, status: "ready", origin: null, destination: null, route: optimizer.route } : emptySession;
  const selectedCount = locations.filter(Boolean).length;

  return <main className="optimizer-workspace">
    <aside className="optimizer-sidebar" aria-label="Multi-stop route optimizer">
      <div className="optimizer-toolbar"><button className="text-button optimizer-back" type="button" onClick={onClose}><ArrowLeft size={15} /> Back to journey</button><button className="text-button" type="button" onClick={clearDraft} disabled={busy || (!locations.some(Boolean) && !optimizer)}><Trash2 size={14} /> Clear stops</button></div>
      <div className="optimizer-heading"><span className="eyebrow">TRIP PLANNER</span><h1>Optimize Multi-Stop Trip</h1><p>Choose stops in any order. Road-network estimates decide the starting point and visiting order.</p></div>
      <div className="optimizer-stops">
        {locations.map((location, index) => <div className="optimizer-stop-field" key={index}><LocationField label={`Stop ${index + 1}`} value={location} onChange={(value) => updateLocation(index, value)} disabled={busy}><button className="icon-button" type="button" aria-label={`Remove stop ${index + 1}`} title="Remove stop" onClick={() => removeLocation(index)} disabled={locations.length === 1 || busy}><Trash2 size={14} /></button></LocationField></div>)}
      </div>
      <div className="optimizer-actions"><button className="secondary-button full-width" type="button" onClick={addLocation} disabled={busy || locations.length >= 12}><Plus size={15} />Add Location</button><button className="primary-button full-width" type="button" onClick={() => void optimize()} disabled={busy || selectedCount < 2}>{busy ? <LoaderCircle size={15} className="spin" /> : <Route size={15} />}Optimize Route</button></div>
      {error && <p className="voice-error" role="alert">{error}</p>}
      {optimizer && <section className="optimizer-results" aria-live="polite"><div className="optimizer-metrics"><div><strong>{formatDistance(optimizer.route.distanceMeters)}</strong><span>Total distance</span></div><div><strong>{formatDuration(optimizer.route.durationSeconds)}</strong><span>Estimated time</span></div></div><p className="optimizer-note">OSRM driving estimate · live traffic is not available</p><ol>{optimizer.ordered.map((location, index) => <li key={location.id}><span>{index + 1}</span><div><strong>{location.name}</strong>{index === 0 && <small>Recommended start</small>}</div></li>)}</ol></section>}
    </aside>
    <section className="optimizer-map-stage" aria-label="Optimized multi-stop route map"><MapLoader session={optimizedSession} alternatives={[]} userLocation={null} places={[]} selected={null} onSelect={() => {}} onLocate={() => {}} routeStops={optimizer?.ordered} /><div className="map-status"><MapPin size={13} /><span>{optimizer ? `${optimizer.ordered.length} stops optimized` : "Select stops to begin"}</span><span className="map-status-divider" /><span>OSRM · no live traffic</span></div></section>
  </main>;
}
