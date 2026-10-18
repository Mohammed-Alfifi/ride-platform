'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { DispatchDriver, TripView } from '@/lib/client';

const RIYADH: L.LatLngExpression = [24.7136, 46.6753];
const ROUTE = '#0b6e4f';
const BRIGHT = '#3fbf8f';
const IDLE = '#4a5a6e';
const HOLD = '#b42318';

export interface DispatchMapProps {
  drivers: DispatchDriver[];
  selected: TripView | null;
  route: { lat: number; lng: number }[];
  onSelectDriver: (id: string) => void;
}

/** Drivers' live positions, and the selected trip's stops and path so far. */
export default function DispatchMap({ drivers, selected, route, onSelectDriver }: DispatchMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const driverLayer = useRef<L.LayerGroup | null>(null);
  const tripLayer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const select = useRef(onSelectDriver);
  select.current = onSelectDriver;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView(RIYADH, 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    tripLayer.current = L.layerGroup().addTo(m);
    driverLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const layer = driverLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    for (const d of drivers) {
      if (!d.location) continue;
      const color = d.onHold ? HOLD : d.currentTripId ? BRIGHT : IDLE;
      const pos: L.LatLngTuple = [d.location.lat, d.location.lng];
      L.circleMarker(pos, { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 })
        .bindTooltip(d.plate ?? d.name ?? '', { permanent: true, direction: 'top', offset: [0, -10], className: 'plate-tip' })
        .on('click', () => select.current(d.id))
        .addTo(layer);
      bounds.extend(pos);
    }
    if (!fitted.current && bounds.isValid()) {
      m.fitBounds(bounds.pad(0.4), { maxZoom: 14 });
      fitted.current = true;
    }
  }, [drivers]);

  useEffect(() => {
    const m = map.current;
    const layer = tripLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    if (!selected) return;
    const a: L.LatLngTuple = [selected.pickup.lat, selected.pickup.lng];
    const b: L.LatLngTuple = [selected.dropoff.lat, selected.dropoff.lng];
    L.polyline([a, b], { color: ROUTE, weight: 2, dashArray: '6 8', opacity: 0.6 }).addTo(layer);
    if (route.length > 1) {
      L.polyline(route.map((p) => [p.lat, p.lng] as L.LatLngTuple), { color: ROUTE, weight: 4 }).addTo(layer);
    }
    L.circleMarker(a, { radius: 7, color: ROUTE, weight: 3, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(selected.pickup.name, { direction: 'bottom' })
      .addTo(layer);
    L.circleMarker(b, { radius: 8, color: ROUTE, weight: 3, fillColor: ROUTE, fillOpacity: 1 })
      .bindTooltip(selected.dropoff.name, { direction: 'bottom' })
      .addTo(layer);
    m.fitBounds(L.latLngBounds([a, b, ...route.map((p) => [p.lat, p.lng] as L.LatLngTuple)]).pad(0.5), { maxZoom: 15 });
  }, [selected, route]);

  return <div ref={el} className="map map-tall" role="region" aria-label="map" />;
}
