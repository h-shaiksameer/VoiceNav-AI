"use client";

import { useEffect, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { AlertTriangle, Layers, LocateFixed, MapPin, Minus, Plus } from "lucide-react";
import type { Location, NavigationSession, PlaceResult, RouteResult } from "@/types/domain";
import { formatDistance, formatDuration } from "@/utils/geo";

type Props = { session: NavigationSession; alternatives: RouteResult[]; userLocation: Location | null; places: PlaceResult[]; selected: PlaceResult | null; onSelect: (place: PlaceResult) => void; onLocate: () => void };

function MapBehavior({ session, alternatives, userLocation, places, selected, onLocate }: Props) {
  const map = useMap();
  const lastRevision = useRef(-1);
  const lastPlaceIds = useRef("");

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (session.route && session.revision !== lastRevision.current) {
      lastRevision.current = session.revision;
      const points = session.route.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
      map.fitBounds(latLngBounds(points), { padding: [55, 55], maxZoom: 15, animate: false });
    }
  }, [map, session]);

  useEffect(() => {
    if (!alternatives.length || !session.route) return;
    const points = [session.route, ...alternatives].flatMap((route) => route.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]));
    map.fitBounds(latLngBounds(points), { padding: [55, 55], maxZoom: 15, animate: false });
  }, [map, alternatives, session.route]);

  useEffect(() => {
    if (userLocation && !session.route) map.setView([userLocation.lat, userLocation.lon], 14);
  }, [map, userLocation, session.route]);

  useEffect(() => {
    const ids = places.map((place) => place.id).join(",");
    if (ids && ids !== lastPlaceIds.current && !session.route) map.fitBounds(latLngBounds(places.map((place) => [place.lat, place.lon])), { padding: [50, 50], maxZoom: 15 });
    lastPlaceIds.current = ids;
  }, [map, places, session.route]);

  useEffect(() => {
    if (selected) map.setView([selected.lat, selected.lon], Math.max(map.getZoom(), 15));
  }, [map, selected]);

  return <div className="map-controls">
    <button className="map-button" title="Zoom in" aria-label="Zoom in" onClick={() => map.zoomIn()}><Plus size={19} /></button>
    <button className="map-button" title="Zoom out" aria-label="Zoom out" onClick={() => map.zoomOut()}><Minus size={19} /></button>
    <button className="map-button locate-map" title="Use current location" aria-label="Use current location" onClick={onLocate}><LocateFixed size={19} /></button>
    {session.route && <button className="map-button" title="Fit route to map" aria-label="Fit route to map" onClick={() => map.fitBounds(latLngBounds(session.route!.geometry.coordinates.map(([lon, lat]) => [lat, lon])), { padding: [55, 55] })}><MapPin size={19} /></button>}
  </div>;
}

export default function MapView(props: Props) {
  const [failedTiles, setFailedTiles] = useState(false);
  const errors = useRef(0);
  const successes = useRef(0);
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  return <div className="map-canvas" aria-label="Interactive navigation map">
    <MapContainer center={[20, 0]} zoom={3} minZoom={2} maxZoom={19} zoomControl={false} scrollWheelZoom attributionControl>
      <TileLayer url={tileUrl} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' eventHandlers={{
        loading: () => { errors.current = 0; successes.current = 0; },
        tileerror: () => { errors.current += 1; setFailedTiles(true); },
        tileload: () => { successes.current += 1; },
        load: () => setFailedTiles(errors.current > successes.current),
      }} />
      {props.alternatives.map((route, index) => <Polyline key={index} positions={route.geometry.coordinates.map(([lon, lat]) => [lat, lon])} pathOptions={{ color: "#456d9c", weight: 5, opacity: 0.85, dashArray: "9 7" }}><Tooltip>Other route {index + 1}: {formatDuration(route.durationSeconds)} · {formatDistance(route.distanceMeters)}</Tooltip></Polyline>)}
      {props.session.route && <>
        <Polyline positions={props.session.route.geometry.coordinates.map(([lon, lat]) => [lat, lon])} pathOptions={{ color: "#073b32", weight: 10, opacity: 0.6 }} />
        <Polyline positions={props.session.route.geometry.coordinates.map(([lon, lat]) => [lat, lon])} pathOptions={{ color: "#078e72", weight: 6, opacity: 1 }} />
      </>}
      {props.session.origin && <CircleMarker center={[props.session.origin.lat, props.session.origin.lon]} radius={8} pathOptions={{ color: "#fff", fillColor: "#1689e5", fillOpacity: 1, weight: 3 }}><Popup>Origin: {props.session.origin.name}</Popup></CircleMarker>}
      {props.session.destination && <CircleMarker center={[props.session.destination.lat, props.session.destination.lon]} radius={9} pathOptions={{ color: "#fff", fillColor: "#dc455a", fillOpacity: 1, weight: 3 }}><Popup>Destination: {props.session.destination.name}</Popup></CircleMarker>}
      {props.userLocation && <CircleMarker center={[props.userLocation.lat, props.userLocation.lon]} radius={6} pathOptions={{ color: "#fff", fillColor: "#1689e5", fillOpacity: 1, weight: 2 }}><Tooltip>Current location · one-time fix</Tooltip></CircleMarker>}
      {props.places.map((place, index) => <CircleMarker key={place.id} center={[place.lat, place.lon]} radius={props.selected?.id === place.id ? 12 : 9} pathOptions={{ color: props.selected?.id === place.id ? "#111e1b" : "#fff", fillColor: "#eea32c", fillOpacity: 1, weight: 2 }} eventHandlers={{ click: () => props.onSelect(place) }}><Tooltip>{index + 1}. {place.name}</Tooltip><Popup><strong>{index + 1}. {place.name}</strong><p>{place.address || "Address: Not available"}</p></Popup></CircleMarker>)}
      <MapBehavior {...props} />
    </MapContainer>
    <div className="map-provider"><Layers size={13} /> OpenStreetMap</div>
    {failedTiles && <div className="map-error" role="alert"><AlertTriangle size={16} />Some map tiles could not load. Check your connection, then pan or zoom to retry.</div>}
  </div>;
}