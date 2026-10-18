'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

interface P {
  lat: number;
  lng: number;
}

/** Pick-up, drop-off and the driver's car, kept in view as the car moves. */
export default function SharedMap({ pickup, dropoff, car, heading }: { pickup: P; dropoff: P; car: P | null; heading: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const a: L.LatLngTuple = [pickup.lat, pickup.lng];
    const b: L.LatLngTuple = [dropoff.lat, dropoff.lng];
    L.polyline([a, b], { color: '#0b6e4f', weight: 3, dashArray: '6 8', opacity: 0.6 }).addTo(g);
    L.circleMarker(a, { radius: 8, color: '#0b6e4f', weight: 4, fillColor: '#fff', fillOpacity: 1 }).addTo(g);
    L.circleMarker(b, { radius: 9, color: '#fff', weight: 3, fillColor: '#f2b33d', fillOpacity: 1 }).addTo(g);
    const points: L.LatLngTuple[] = [a, b];
    if (car) {
      const c: L.LatLngTuple = [car.lat, car.lng];
      const icon = L.divIcon({
        className: 'car-icon',
        html: `<span style="transform: rotate(${heading ?? 0}deg)"></span>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
      L.marker(c, { icon }).addTo(g);
      points.push(c);
    }
    m.fitBounds(L.latLngBounds(points).pad(0.35), { maxZoom: 16 });
  }, [pickup, dropoff, car, heading]);

  return <div ref={el} className="shared-map" role="region" aria-label="map" />;
}
