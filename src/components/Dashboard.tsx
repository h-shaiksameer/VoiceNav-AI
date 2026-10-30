"use client";

import { useSyncExternalStore } from "react";
import { ArrowUpRight, Compass, Navigation2, Radio, ShieldCheck, WifiOff } from "lucide-react";
import { RoutePanel } from "@/components/RoutePanel/RoutePanel";
import { PlaceResults } from "@/components/PlaceResults/PlaceResults";
import { VoiceAssistant } from "@/components/VoiceAssistant/VoiceAssistant";
import MapLoader from "@/components/MapView/MapLoader";
import { useNavigationApp } from "./useNavigationApp";

function subscribeConnection(callback: () => void) { window.addEventListener("online", callback); window.addEventListener("offline", callback); return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); }; }
const connectionSnapshot = () => navigator.onLine;
const serverConnection = () => true;

export function Dashboard() {
  const app = useNavigationApp();
  const online = useSyncExternalStore(subscribeConnection, connectionSnapshot, serverConnection);

  return <div className="app-shell">
    <a className="skip-link" href="#journey">Skip to route planner</a>
    <header className="app-header">
      <a className="brand" href="/" aria-label="VoiceNav AI home"><span className="brand-symbol"><Navigation2 size={25} fill="currentColor" strokeWidth={1.5} /></span><span>VoiceNav<span className="brand-ai">AI</span></span></a>
      <div className="header-divider" /><span className="header-caption">A clearer way forward.</span>
      <nav className="header-meta" aria-label="Application status"><span className="demo-badge">DEVELOPMENT MVP</span><span className="privacy-label"><ShieldCheck size={15} /> Destination protected</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" title="OpenStreetMap attribution">OpenStreetMap <ArrowUpRight size={13} /></a></nav>
    </header>
    {!online && <div className="offline-banner" role="alert"><WifiOff size={16} />You are offline. Map tiles, address search, routes, and place searches need an internet connection.</div>}
    <main className="app-grid" id="journey">
      <aside className="sidebar" aria-label="Journey planner and places">
        <RoutePanel origin={app.origin} destination={app.destination} session={app.session} alternatives={app.alternatives} onCheckAlternatives={() => void app.externalMessage("Check other routes")} busy={app.working} locating={app.locating} error={app.routeError} onOrigin={app.setOrigin} onDestination={app.setDestination} onLocate={app.locate} onSearch={() => void app.calculateRoute()} onStop={() => void app.stopRoute()} />
        <PlaceResults category={app.category} scope={app.scope} search={app.search} selected={app.selected} detours={app.detours} busy={app.working} hasRoute={!!app.session.route} error={app.placeError} onCategory={app.setCategory} onScope={app.setScope} onSearch={() => void app.findPlaces()} onSelect={app.setSelected} onNavigate={app.navigateTo} onCompare={() => void app.externalMessage("Compare options")} />
        <footer className="sidebar-footer"><Compass size={14} /><span>Explore with intention.</span><span>v0.1</span></footer>
      </aside>
      <section className="map-stage" aria-label="Map and navigation assistant">
        <MapLoader session={app.session} alternatives={app.alternatives} userLocation={app.userLocation} places={app.search?.places ?? []} selected={app.selected} onSelect={app.setSelected} onLocate={app.locate} />
        <div className="map-status"><span className={`status-dot ${app.session.route ? "" : "neutral"}`} /><span>{app.session.route ? "Route preview" : "No active route"}</span><span className="map-status-divider" /><Radio size={13} /><span>{online ? "OSM map" : "Offline"}</span></div>
        <VoiceAssistant engine={app.runtime.conversation} blocked={app.busy || app.locating} onBusyChange={app.setAssistantBusy} />
      </section>
    </main>
  </div>;
}