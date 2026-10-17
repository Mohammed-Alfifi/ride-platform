'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { ZoneView } from '@/lib/client';

const RIYADH: L.LatLngExpression = [24.7136, 46.6753];
const ROUTE = '#0b6e4f';
const MUTED = '#7a8796';

export interface ZoneMapProps {
  zones: ZoneView[];
  selectedId: string | null;
  drawing: boolean;
  draft: [number, number][]; // [lng, lat]
  lang: 'ar' | 'en';
  onAddPoint: (lng: number, lat: number) => void;
  onSelect: (id: string) => void;
}

/** Service areas on an OpenStreetMap base; in drawing mode each click adds a corner. */
export default function ZoneMap({ zones, selectedId, drawing, draft, lang, onAddPoint, onSelect }: ZoneMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const zoneLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onAddPoint, onSelect, drawing });
  handlers.current = { onAddPoint, onSelect, drawing };
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(RIYADH, 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    zoneLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (handlers.current.drawing) handlers.current.onAddPoint(e.latlng.lng, e.latlng.lat);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const layer = zoneLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    for (const z of zones) {
      const ring = z.area.coordinates[0].map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      const selected = z.id === selectedId;
      const poly = L.polygon(ring, {
        color: z.active ? ROUTE : MUTED,
        weight: selected ? 3 : 2,
        fillOpacity: selected ? 0.25 : 0.12,
        dashArray: z.active ? undefined : '6 6',
      })
        .bindTooltip(lang === 'ar' ? z.nameAr : z.nameEn, { sticky: true })
        .on('click', (e) => {
          if (handlers.current.drawing) return;
          L.DomEvent.stopPropagation(e);
          handlers.current.onSelect(z.id);
        });
      poly.addTo(layer);
      bounds.extend(poly.getBounds());
    }
    if (!fitted.current && bounds.isValid()) {
      m.fitBounds(bounds.pad(0.3));
      fitted.current = true;
    }
  }, [zones, selectedId, lang]);

  useEffect(() => {
    const m = map.current;
    const z = zones.find((x) => x.id === selectedId);
    if (m && z) {
      const ring = z.area.coordinates[0].map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      m.fitBounds(L.latLngBounds(ring).pad(0.4));
    }
  }, [selectedId, zones]);

  useEffect(() => {
    const layer = draftLayer.current;
    if (!layer) return;
    layer.clearLayers();
    const pts = draft.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
    if (pts.length >= 2) {
      L.polygon(pts, { color: ROUTE, weight: 2, dashArray: '4 6', fillOpacity: 0.15 }).addTo(layer);
    }
    pts.forEach((p, i) =>
      L.circleMarker(p, {
        radius: i === pts.length - 1 ? 7 : 5,
        color: ROUTE,
        weight: 2,
        fillColor: i === pts.length - 1 ? ROUTE : '#ffffff',
        fillOpacity: 1,
      }).addTo(layer),
    );
  }, [draft]);

  return <div ref={el} className={`map${drawing ? ' drawing' : ''}`} dir="ltr" />;
}
