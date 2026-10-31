"use client";

import { Compass, Radio } from "lucide-react";
import { PlaceResults } from "@/components/PlaceResults/PlaceResults";
import { RoutePanel } from "@/components/RoutePanel/RoutePanel";
import { VoiceAssistant } from "@/components/VoiceAssistant/VoiceAssistant";
import { ParallelAssistantPanel } from "@/components/ParallelAssistantPanel";
import MapLoader from "@/components/MapView/MapLoader";
import { serviceAvailability } from "@/services/availability";
import { useSyncExternalStore } from "react";
import { useNavigationApp } from "./useNavigationApp";

type Props = { name: string; active: boolean; online: boolean };

export function SessionWorkspace({ name, active, online }: Props) {
  const app = useNavigationApp();
  const services = useSyncExternalStore(serviceAvailability.subscribe, serviceAvailability.getSnapshot, serviceAvailability.getServerSnapshot);

  return <main className={`session-workspace ${active ? "session-workspace-active" : ""}`} aria-hidden={!active}>
    <aside className="sidebar" aria-label={`${name} planner and places`}>
      <RoutePanel origin={app.origin} destination={app.destination} session={app.session} alternatives={app.alternatives} onCheckAlternatives={() => void app.externalMessage("Check other routes")} busy={app.working} locating={app.locating} error={app.routeError} trackingStatus={app.trackingStatus} movement={app.movement} progress={app.progress} offRoute={app.offRoute} onOrigin={app.setOrigin} onDestination={app.setDestination} onLocate={app.locate} onSearch={() => void app.calculateRoute()} onStart={() => void app.startJourney()} onPause={app.pauseJourney} onResume={app.resumeJourney} onEnd={app.endJourney} onRecalculate={() => void app.recalculateJourney()} onStop={() => void app.stopRoute()} />
      <PlaceResults category={app.category} scope={app.scope} search={app.search} selected={app.selected} detours={app.detours} busy={app.working} hasRoute={!!app.session.route} error={app.placeError} unavailable={services.places.status === "unavailable" ? services.places.message : undefined} onCategory={app.setCategory} onScope={app.setScope} onSearch={() => void app.findPlaces()} onSelect={app.setSelected} onNavigate={app.navigateTo} onCompare={() => void app.externalMessage("Compare options")} />
      <footer className="sidebar-footer"><Compass size={14} /><span>{name}</span><span>SESSION</span></footer>
    </aside>
    <section className="map-stage" aria-label={`${name} map and navigation assistant`}>
      <MapLoader session={app.session} alternatives={app.alternatives} userLocation={app.userLocation} places={app.search?.places ?? []} selected={app.selected} onSelect={app.setSelected} onLocate={app.locate} />
      <div className="map-status"><span className={`status-dot ${app.session.route ? "" : "neutral"}`} /><span>{app.session.route ? app.session.status === "active" ? "Journey active" : app.session.status === "paused" ? "Journey paused" : "Route ready" : "No active route"}</span><span className="map-status-divider" /><Radio size={13} /><span>{online ? "OSM map" : "Offline"}</span></div>
      <VoiceAssistant engine={app.runtime.conversation} blocked={app.busy || app.locating} onBusyChange={app.setAssistantBusy} />
      <ParallelAssistantPanel snapshot={app.parallelAssistantSnapshot} blocked={app.working} onAsk={app.askParallelAssistant} onCancel={() => app.parallelAssistant.cancel()} />
    </section>
  </main>;
}