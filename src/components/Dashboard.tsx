"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Compass, Menu, Navigation2, Radio, ShieldCheck, WifiOff, X } from "lucide-react";
import { RoutePanel } from "@/components/RoutePanel/RoutePanel";
import { PlaceResults } from "@/components/PlaceResults/PlaceResults";
import { VoiceAssistant } from "@/components/VoiceAssistant/VoiceAssistant";
import { ParallelAssistantPanel } from "@/components/ParallelAssistantPanel";
import { ServiceStatus } from "@/components/ServiceStatus";
import MapLoader from "@/components/MapView/MapLoader";
import { useNavigationApp } from "./useNavigationApp";
import { serviceAvailability } from "@/services/availability";
import { SessionWorkspace } from "./SessionWorkspace";

type WorkspaceSession = { id: string; name: string };

function subscribeConnection(callback: () => void) { window.addEventListener("online", callback); window.addEventListener("offline", callback); return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); }; }
const connectionSnapshot = () => navigator.onLine;
const serverConnection = () => true;

export function Dashboard() {
  const app = useNavigationApp();
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const online = useSyncExternalStore(subscribeConnection, connectionSnapshot, serverConnection);
  const services = useSyncExternalStore(serviceAvailability.subscribe, serviceAvailability.getSnapshot, serviceAvailability.getServerSnapshot);

  return <div className="app-shell">
    <a className="skip-link" href="#journey">Skip to route planner</a>
    <header className="app-header">
      <Link className="brand" href="/" aria-label="VoiceNav AI home"><span className="brand-symbol"><Navigation2 size={25} fill="currentColor" strokeWidth={1.5} /></span><span>VoiceNav<span className="brand-ai">AI</span></span></Link>
      <div className="header-divider" /><span className="header-caption">A clearer way forward.</span>
      <nav className="header-meta" aria-label="Application status"><span id="ui-control-slot" /><span className="demo-badge">DEVELOPMENT MVP</span><span className="privacy-label"><ShieldCheck size={15} /> Destination protected</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" title="OpenStreetMap attribution">OpenStreetMap <ArrowUpRight size={13} /></a><button className="header-menu-button" type="button" aria-label="Open map sessions" aria-expanded={sessionsOpen} title="Map sessions" onClick={() => setSessionsOpen((open) => !open)}><Menu size={22} /></button></nav>
    </header>
    {!online && <div className="offline-banner" role="alert"><WifiOff size={16} />You are offline. Map tiles, address search, routes, and place searches need an internet connection.</div>}
    <div className="workspace-tabs" role="tablist" aria-label="Map workspaces">
      <button type="button" role="tab" aria-selected={!activeSessionId} className={!activeSessionId ? "workspace-tab-active" : ""} onClick={() => setActiveSessionId(null)}>Main journey</button>
      {sessions.map((session) => <button key={session.id} type="button" role="tab" aria-selected={session.id === activeSessionId} className={session.id === activeSessionId ? "workspace-tab-active" : ""} onClick={() => setActiveSessionId(session.id)}>{session.name}</button>)}
    </div>
    <main className={`app-grid ${activeSessionId ? "workspace-hidden" : ""}`} id="journey">
      <aside className="sidebar" aria-label="Journey planner and places">
        <RoutePanel origin={app.origin} destination={app.destination} session={app.session} alternatives={app.alternatives} onCheckAlternatives={() => void app.externalMessage("Check other routes")} busy={app.working} locating={app.locating} error={app.routeError} trackingStatus={app.trackingStatus} movement={app.movement} progress={app.progress} offRoute={app.offRoute} onOrigin={app.setOrigin} onDestination={app.setDestination} onLocate={app.locate} onSearch={() => void app.calculateRoute()} onStart={() => void app.startJourney()} onPause={app.pauseJourney} onResume={app.resumeJourney} onEnd={app.endJourney} onRecalculate={() => void app.recalculateJourney()} onStop={() => void app.stopRoute()} />
        <PlaceResults category={app.category} scope={app.scope} search={app.search} selected={app.selected} detours={app.detours} busy={app.working} hasRoute={!!app.session.route} error={app.placeError} unavailable={services.places.status === "unavailable" ? services.places.message : undefined} onCategory={app.setCategory} onScope={app.setScope} onSearch={() => void app.findPlaces()} onSelect={app.setSelected} onNavigate={app.navigateTo} onCompare={() => void app.externalMessage("Compare options")} />
        <ServiceStatus services={services} />
        <footer className="sidebar-footer"><Compass size={14} /><span>Explore with intention.</span><span>v0.1</span></footer>
      </aside>
      <section className="map-stage" aria-label="Map and navigation assistant">
        <MapLoader session={app.session} alternatives={app.alternatives} userLocation={app.userLocation} places={app.search?.places ?? []} selected={app.selected} onSelect={app.setSelected} onLocate={app.locate} mapCommand={app.mapCommand} />
        <div className="map-status"><span className={`status-dot ${app.session.route ? "" : "neutral"}`} /><span>{app.session.route ? app.session.status === "active" ? "Journey active" : app.session.status === "paused" ? "Journey paused" : "Route ready" : "No active route"}</span><span className="map-status-divider" /><Radio size={13} /><span>{online ? "OSM map" : "Offline"}</span></div>
        <VoiceAssistant engine={app.runtime.conversation} blocked={app.busy || app.locating} onBusyChange={app.setAssistantBusy} active={!activeSessionId} />
        <ParallelAssistantPanel snapshot={app.parallelAssistantSnapshot} blocked={app.working} onAsk={app.askParallelAssistant} onCancel={() => app.parallelAssistant.cancel()} />
      </section>
    </main>
    {sessionsOpen && <aside className="session-drawer" aria-label="Map sessions">
      <div className="session-drawer-list">
        <div className="session-drawer-title"><div><span className="eyebrow">WORKSPACE</span><h2>Map sessions</h2></div><button className="icon-button" type="button" aria-label="Close map sessions" title="Close map sessions" onClick={() => setSessionsOpen(false)}><X size={19} /></button></div>
        <button className="primary-button session-new-button" type="button" onClick={() => { const next = { id: `session-${Date.now()}`, name: `Session ${sessions.length + 1}` }; setSessions((current) => [...current, next]); setActiveSessionId(next.id); }}>+ New session</button>
        {!sessions.length && <p className="session-empty">Create a session to open an independent map workspace. Your main journey stays untouched.</p>}
        <ul className="session-list">{sessions.map((session) => <li key={session.id} className={session.id === activeSessionId ? "session-list-active" : ""}><button type="button" onClick={() => setActiveSessionId(session.id)}><span>{session.name}</span><small>{session.id === activeSessionId ? "Open" : "Ready"}</small></button><button type="button" className="icon-button" aria-label={`Delete ${session.name}`} title={`Delete ${session.name}`} onClick={() => { setSessions((current) => current.filter((item) => item.id !== session.id)); if (activeSessionId === session.id) setActiveSessionId(null); }}><span aria-hidden="true">×</span></button></li>)}</ul>
      </div>
    </aside>}
    {sessions.map((session) => <SessionWorkspace key={session.id} name={session.name} active={session.id === activeSessionId} online={online} />)}
  </div>;
}