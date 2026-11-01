"use client";

import { startTransition, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Compass, Menu, Radio, Route as RouteIcon, ShieldCheck, Trash2, WifiOff } from "lucide-react";
import { RoutePanel } from "@/components/RoutePanel/RoutePanel";
import { PlaceResults } from "@/components/PlaceResults/PlaceResults";
import { VoiceAssistant } from "@/components/VoiceAssistant/VoiceAssistant";
import { ParallelAssistantPanel } from "@/components/ParallelAssistantPanel";
import { ServiceStatus } from "@/components/ServiceStatus";
import MapLoader from "@/components/MapView/MapLoader";
import { useNavigationApp } from "./useNavigationApp";
import { serviceAvailability } from "@/services/availability";
import { SessionWorkspace } from "./SessionWorkspace";
import { MultiStopOptimizer, optimizerStorageKey, type OptimizerState } from "./MultiStopOptimizer";

type WorkspaceSession = { id: string; name: string; optimizerData?: boolean };
const sessionsStorageKey = "voicenav-workspace-sessions";

type SessionsSectionProps = { sessions: WorkspaceSession[]; activeSessionId: string | null; mainOptimizerData: boolean; onNew: () => void; onSelect: (id: string | null) => void; onClear: (id: string) => void; onDelete: (id: string) => void };

function SessionsSection({ sessions, activeSessionId, mainOptimizerData, onNew, onSelect, onClear, onDelete }: SessionsSectionProps) {
  return <section className="sidebar-sessions" aria-label="Map sessions"><div className="sidebar-section-heading"><div><span className="eyebrow">WORKSPACE</span><h2>Sessions</h2></div><button className="secondary-button sidebar-session-new" type="button" onClick={onNew}><span aria-hidden="true">+</span> New</button></div><ul className="session-list"><li className={!activeSessionId ? "session-list-active" : ""}><button type="button" onClick={() => onSelect(null)}><span>Main journey</span><small>{mainOptimizerData ? "Trip stops saved" : "Open"}</small></button>{mainOptimizerData && <button type="button" className="icon-button" aria-label="Clear main journey trip stops" title="Clear trip stops" onClick={() => onClear("main")}><Trash2 size={14} /></button>}</li>{sessions.map((session) => <li key={session.id} className={session.id === activeSessionId ? "session-list-active" : ""}><button type="button" onClick={() => onSelect(session.id)}><span>{session.name}</span><small>{session.optimizerData ? "Trip stops saved" : session.id === activeSessionId ? "Open" : "Ready"}</small></button>{session.optimizerData && <button type="button" className="icon-button" aria-label={`Clear ${session.name} trip stops`} title="Clear trip stops" onClick={() => onClear(session.id)}><Trash2 size={14} /></button>}<button type="button" className="icon-button" aria-label={`Delete ${session.name}`} title={`Delete ${session.name}`} onClick={() => onDelete(session.id)}><span aria-hidden="true">×</span></button></li>)}</ul>{!sessions.length && <p className="session-empty">Create an independent workspace without changing the main journey.</p>}</section>;
}

function readSessions(): WorkspaceSession[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(sessionsStorageKey) || "[]") as WorkspaceSession[];
    return Array.isArray(stored) ? stored.filter((session) => typeof session?.id === "string" && typeof session?.name === "string") : [];
  } catch { return []; }
}

function subscribeConnection(callback: () => void) { window.addEventListener("online", callback); window.addEventListener("offline", callback); return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); }; }
const connectionSnapshot = () => navigator.onLine;
const serverConnection = () => true;
function subscribeMobile(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(max-width: 800px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const mobileSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 800px)").matches;
const serverMobile = () => false;

export function Dashboard() {
  const app = useNavigationApp();
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [mainOptimizerData, setMainOptimizerData] = useState(false);
  const [optimizerResets, setOptimizerResets] = useState<Record<string, number>>({});
  const [mobileOptimizerResults, setMobileOptimizerResults] = useState<Record<string, OptimizerState>>({});
  const online = useSyncExternalStore(subscribeConnection, connectionSnapshot, serverConnection);
  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverMobile);
  const services = useSyncExternalStore(serviceAvailability.subscribe, serviceAvailability.getSnapshot, serviceAvailability.getServerSnapshot);
  const optimizerWorkspaceId = activeSessionId ?? "main";

  useEffect(() => { startTransition(() => { setSessions(readSessions()); setMainOptimizerData(Boolean(window.localStorage.getItem(optimizerStorageKey("main")))); setSessionsLoaded(true); }); }, []);
  useEffect(() => { if (sessionsLoaded) window.localStorage.setItem(sessionsStorageKey, JSON.stringify(sessions)); }, [sessions, sessionsLoaded]);

  function updateOptimizerData(workspaceId: string, hasData: boolean) {
    if (workspaceId === "main") setMainOptimizerData(hasData);
    else setSessions((current) => current.map((session) => session.id === workspaceId ? { ...session, optimizerData: hasData } : session));
  }

  function clearOptimizerData(workspaceId: string) {
    window.localStorage.removeItem(optimizerStorageKey(workspaceId));
    setOptimizerResets((current) => ({ ...current, [workspaceId]: (current[workspaceId] ?? 0) + 1 }));
    updateOptimizerData(workspaceId, false);
    setMobileOptimizerResults((current) => { const next = { ...current }; delete next[workspaceId]; return next; });
  }

  function createSession() {
    const next = { id: `session-${Date.now()}`, name: `Session ${sessions.length + 1}` };
    setSessions((current) => [...current, next]);
    setActiveSessionId(next.id);
    setOptimizerOpen(false);
  }

  function selectWorkspace(workspaceId: string | null) {
    setOptimizerOpen(false);
    setActiveSessionId(workspaceId);
    setMobileSidebarOpen(false);
  }

  function deleteSession(sessionId: string) {
    clearOptimizerData(sessionId);
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    if (activeSessionId === sessionId) { setActiveSessionId(null); setOptimizerOpen(false); }
  }

  const sessionsPanel = <SessionsSection sessions={sessions} activeSessionId={activeSessionId} mainOptimizerData={mainOptimizerData} onNew={createSession} onSelect={selectWorkspace} onClear={clearOptimizerData} onDelete={deleteSession} />;

  function handleOptimizerResult(result: OptimizerState) {
    setMobileOptimizerResults((current) => ({ ...current, [optimizerWorkspaceId]: result }));
    if (result && isMobile) setOptimizerOpen(false);
  }

  const mobileResult = isMobile && !optimizerOpen ? mobileOptimizerResults[optimizerWorkspaceId] : null;
  const mainMapSession = mobileResult ? { ...app.session, revision: mobileResult.result.order.length, status: "ready" as const, route: mobileResult.route } : app.session;
  return <div className="app-shell">
    <a className="skip-link" href="#journey">Skip to route planner</a>
    <header className="app-header">
      <button className="header-menu-button" type="button" aria-label="Open journey planner and sessions" aria-expanded={mobileSidebarOpen} aria-controls="journey-sidebar" title="Journey planner and sessions" onClick={() => setMobileSidebarOpen((open) => !open)}><Menu size={22} /></button>
      <Link className="brand" href="/" aria-label="VoiceNav AI home"><span className="brand-symbol"><img src="/voicenav-badge.png" alt="" /></span><span>VoiceNav<span className="brand-ai">AI</span></span></Link>
      <div className="header-divider" /><span className="header-caption">A clearer way forward.</span>
      <nav className="header-meta" aria-label="Application status"><span id="ui-control-slot" /><span className="demo-badge">DEVELOPMENT MVP</span><span className="privacy-label"><ShieldCheck size={15} /> Destination protected</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" title="OpenStreetMap attribution">OpenStreetMap <ArrowUpRight size={13} /></a></nav>
    </header>
    {!online && <div className="offline-banner" role="alert"><WifiOff size={16} />You are offline. Map tiles, address search, routes, and place searches need an internet connection.</div>}
    <div className="workspace-tabs" role="tablist" aria-label="Map workspaces">
      <button type="button" role="tab" aria-selected={!activeSessionId} className={!activeSessionId ? "workspace-tab-active" : ""} onClick={() => { setMobileSidebarOpen(false); setActiveSessionId(null); }}>Main journey</button>
      {sessions.map((session) => <button key={session.id} type="button" role="tab" aria-selected={session.id === activeSessionId} className={session.id === activeSessionId ? "workspace-tab-active" : ""} onClick={() => { setMobileSidebarOpen(false); setActiveSessionId(session.id); }}>{session.name}</button>)}
    </div>
    <main className={`app-grid ${activeSessionId || optimizerOpen ? "workspace-hidden" : ""}`} id="journey">
      <aside className={`sidebar ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`} id="journey-sidebar" aria-label="Journey planner and places">
      <button className="optimizer-launch-button" type="button" onClick={() => { setMobileSidebarOpen(false); setActiveSessionId(null); setOptimizerOpen(true); }}><RouteIcon />Optimize Multi-Stop Trip</button>
        <RoutePanel origin={app.origin} destination={app.destination} session={app.session} alternatives={app.alternatives} onCheckAlternatives={() => void app.externalMessage("Check other routes")} busy={app.working} locating={app.locating} error={app.routeError} trackingStatus={app.trackingStatus} movement={app.movement} progress={app.progress} offRoute={app.offRoute} onOrigin={app.setOrigin} onDestination={app.setDestination} onLocate={app.locate} onSearch={() => void app.calculateRoute()} onStart={() => void app.startJourney()} onPause={app.pauseJourney} onResume={app.resumeJourney} onEnd={app.endJourney} onRecalculate={() => void app.recalculateJourney()} onStop={() => void app.stopRoute()} />
        {sessionsPanel}
        <PlaceResults category={app.category} scope={app.scope} search={app.search} selected={app.selected} detours={app.detours} busy={app.working} hasRoute={!!app.session.route} error={app.placeError} unavailable={services.places.status === "unavailable" ? services.places.message : undefined} onCategory={app.setCategory} onScope={app.setScope} onSearch={() => void app.findPlaces()} onSelect={app.setSelected} onNavigate={app.navigateTo} onCompare={() => void app.externalMessage("Compare options")} />
        <ServiceStatus services={services} />
        <footer className="sidebar-footer"><Compass size={14} /><span>Explore with intention.</span><span>v0.1</span></footer>
      </aside>
      <section className="map-stage" aria-label="Map and navigation assistant">
        <MapLoader session={mainMapSession} alternatives={app.alternatives} userLocation={app.userLocation} places={app.search?.places ?? []} selected={app.selected} onSelect={app.setSelected} onLocate={app.locate} mapCommand={app.mapCommand} routeStops={mobileResult?.ordered} />
        <div className="map-status"><span className={`status-dot ${app.session.route ? "" : "neutral"}`} /><span>{app.session.route ? app.session.status === "active" ? "Journey active" : app.session.status === "paused" ? "Journey paused" : "Route ready" : "No active route"}</span><span className="map-status-divider" /><Radio size={13} /><span>{online ? "OSM map" : "Offline"}</span></div>
        <VoiceAssistant engine={app.runtime.conversation} blocked={app.busy || app.locating} onBusyChange={app.setAssistantBusy} active={!activeSessionId} />
        <ParallelAssistantPanel snapshot={app.parallelAssistantSnapshot} blocked={app.working} onAsk={app.askParallelAssistant} onCancel={() => app.parallelAssistant.cancel()} />
      </section>
    </main>
    {!optimizerOpen && <button className="optimizer-mobile-launch" type="button" aria-label="Open multi-stop optimizer" title="Optimize multi-stop trip" onClick={() => { setMobileSidebarOpen(false); setOptimizerOpen(true); }}><RouteIcon size={20} /></button>}
    <div className={`optimizer-host ${optimizerOpen ? "" : "workspace-hidden"}`}><MultiStopOptimizer key={`${optimizerWorkspaceId}:${optimizerResets[optimizerWorkspaceId] ?? 0}`} workspaceId={optimizerWorkspaceId} onClose={() => setOptimizerOpen(false)} onDraftChange={(hasData) => updateOptimizerData(optimizerWorkspaceId, hasData)} onOptimized={handleOptimizerResult} /></div>
    {mobileSidebarOpen && <button className="mobile-sidebar-backdrop" type="button" aria-label="Close journey planner" onClick={() => setMobileSidebarOpen(false)} />}
    {!optimizerOpen && sessions.map((session) => <SessionWorkspace key={session.id} name={session.name} active={session.id === activeSessionId} online={online} mobileSidebarOpen={mobileSidebarOpen} optimizerResult={isMobile ? mobileOptimizerResults[session.id] ?? null : null} sessionsPanel={sessionsPanel} onCloseMobileSidebar={() => setMobileSidebarOpen(false)} onOpenOptimizer={() => { setMobileSidebarOpen(false); setActiveSessionId(session.id); setOptimizerOpen(true); }} />)}
  </div>;
}