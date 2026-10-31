"use client";

import { AlertTriangle, ArrowRight, Clock3, GitFork, LocateFixed, LoaderCircle, Pause, Play, Route, Square } from "lucide-react";
import type { Location, LocationTrackingStatus, NavigationSession, RouteResult } from "@/types/domain";
import type { MovementState } from "@/services/MovementDetectionService";
import type { RouteProgress } from "@/services/RouteProgressService";
import { formatDistance, formatDuration } from "@/utils/geo";
import { LocationField } from "@/components/SearchPanel/LocationField";

type Props = {
  origin: Location | null; destination: Location | null; session: NavigationSession;
  busy: boolean; locating: boolean; error: string;
  alternatives: RouteResult[]; onCheckAlternatives: () => void;
  onOrigin: (location: Location | null) => void; onDestination: (location: Location | null) => void;
  onLocate: () => void; onSearch: () => void; onStart: () => void; onPause: () => void; onResume: () => void; onEnd: () => void; onRecalculate: () => void; onStop: () => void;
  trackingStatus: LocationTrackingStatus; movement: MovementState; progress: RouteProgress | null; offRoute: boolean;
};

export function RoutePanel(props: Props) {
  const reference = props.origin ?? props.session.origin;
  return <section className="route-panel" aria-labelledby="route-heading">
    <div className="section-heading"><div><span className="eyebrow">YOUR JOURNEY</span><h1 id="route-heading">Where to next?</h1></div><Route size={23} className="muted-icon" /></div>
    <form onSubmit={(event) => { event.preventDefault(); props.onSearch(); }}>
      <LocationField label="Origin" value={props.origin} onChange={props.onOrigin} disabled={props.busy}>
        <button type="button" className="text-button" onClick={props.onLocate} disabled={props.locating || props.busy} title="Use current location">
          {props.locating ? <LoaderCircle size={12} className="spin" /> : <LocateFixed size={12} />} My location
        </button>
      </LocationField>
      <LocationField key={reference ? `${reference.id}:${reference.lat}:${reference.lon}` : "no-origin"} label="Destination" value={props.destination} reference={reference ?? undefined} onChange={props.onDestination} disabled={props.busy || !reference} />
      <button className="primary-button route-submit" type="submit" disabled={props.busy || !props.origin || !props.destination}>
        {props.busy ? <LoaderCircle size={18} className="spin" /> : <Route size={18} />}{props.busy ? "Calculating route" : "Search Route"}<ArrowRight size={17} />
      </button>
    </form>
    {props.error && <p className="field-error" role="alert">{props.error}</p>}
    {props.session.route ? <div className="route-summary">
      <div className="summary-top"><span className={`status-dot ${props.session.status === "active" ? "" : "neutral"}`} /> {props.session.status === "active" ? "Journey active" : props.session.status === "paused" ? "Journey paused" : props.session.status === "arrived" ? "Arrived" : props.session.status === "stopped" ? "Journey ended" : "Driving route ready"}<button className="icon-button" title="Clear route preview" aria-label="Clear route preview" onClick={props.onStop} disabled={props.busy}><Square size={13} /></button></div>
      <div className="route-metrics"><div><Clock3 size={15} /><strong>{formatDuration(props.session.route.durationSeconds)}</strong><span>Estimated time</span></div><div><Route size={15} /><strong>{formatDistance(props.session.route.distanceMeters)}</strong><span>Driving distance</span></div></div>
      <p className="route-destination">To {props.session.destination?.name}</p>
      <span className="data-note">OSRM estimate · No live traffic or turn-by-turn</span>
      {props.session.status === "arrived" && <p className="journey-arrived" role="status">You have arrived at your destination.</p>}
      {props.session.status === "active" && <div className="journey-metrics" aria-label="Active journey status"><span>GPS: {props.trackingStatus.replaceAll("_", " ")}</span><span>Movement: {props.movement}</span>{props.progress && <><span>{props.progress.percentage}% complete</span><span>{formatDistance(props.progress.remainingDistanceMeters)} remaining · {formatDuration(props.progress.remainingDurationSeconds)} estimate</span></>}{props.offRoute && <strong><AlertTriangle size={14} /> Off route. Recalculate before continuing.</strong>}</div>}
      {(props.session.status === "ready" || props.session.status === "preview") && <button className="primary-button full-width" type="button" onClick={props.onStart} disabled={props.busy || props.locating}><Play size={15} />Start Journey</button>}
      {props.session.status === "active" && <button className="secondary-button full-width" type="button" onClick={props.onPause} disabled={props.busy}><Pause size={15} />Pause Journey</button>}
      {props.session.status === "paused" && <button className="primary-button full-width" type="button" onClick={props.onResume} disabled={props.busy}><Play size={15} />Resume Journey</button>}
      {props.offRoute && ["active", "paused"].includes(props.session.status) && <button className="secondary-button full-width" type="button" onClick={props.onRecalculate} disabled={props.busy || !props.progress}><Route size={15} />Recalculate from GPS</button>}
      {["active", "paused", "starting"].includes(props.session.status) && <button className="text-button full-width" type="button" onClick={props.onEnd} disabled={props.busy}>End Journey</button>}
      <button className="secondary-button full-width alternatives-button" type="button" onClick={props.onCheckAlternatives} disabled={props.busy}><GitFork size={15} />Check other routes</button>
      {props.alternatives.length > 0 && <div className="route-alternatives"><h3>Other route previews</h3><ol>{props.alternatives.map((route, index) => <li key={index}><span>Option {index + 1}</span><strong>{formatDuration(route.durationSeconds)} · {formatDistance(route.distanceMeters)}</strong></li>)}</ol></div>}
    </div> : <div className="route-empty"><Route size={18} /><span>No active route</span></div>}
  </section>;
}