'use client';

import { useState } from 'react';

export interface DayPoint {
  date: string;
  value: number;
}

const MARK = '#14875f';

/**
 * One series over days as thin bars: baseline-anchored, rounded data ends, a recessive
 * grid, the peak labelled, and a tooltip per bar on hover and keyboard focus.
 */
export function DayBars({
  points,
  format,
  label,
  lang,
}: {
  points: DayPoint[];
  format: (v: number) => string;
  label: string;
  lang: 'ar' | 'en';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const pad = { top: 26, bottom: 26, side: 8 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const nice = niceMax(max);
  const n = points.length || 1;
  const slot = (W - pad.side * 2) / n;
  const bar = Math.max(2, Math.min(18, slot - 2));
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / nice);
  // Bars run with time from right to left in Arabic, as the reader scans.
  const x = (i: number) => (lang === 'ar' ? W - pad.side - slot * (i + 1) : pad.side + slot * i) + (slot - bar) / 2;
  const peak = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? -1) ? i : best), 0);
  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const ticks = [0, nice / 2, nice];
  const every = Math.ceil(n / 6);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none" className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.side} x2={W - pad.side} y1={y(t)} y2={y(t)} stroke="#e6ebee" strokeWidth="1" />
            {t > 0 && (
              // Scale labels sit on the oldest side, away from today's bars.
              <text
                x={lang === 'ar' ? W - pad.side : pad.side}
                y={y(t) - 4}
                textAnchor={lang === 'ar' ? 'end' : 'start'}
                className="chart-axis"
              >
                {format(t)}
              </text>
            )}
          </g>
        ))}
        {points.map((p, i) => {
          const top = y(p.value);
          const h = Math.max(0, H - pad.bottom - top);
          return (
            <g key={p.date}>
              {h > 0 && (
                <path
                  d={roundedTop(x(i), top, bar, h, Math.min(4, bar / 2, h))}
                  fill={MARK}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              <rect
                x={x(i) - (slot - bar) / 2}
                y={pad.top}
                width={slot}
                height={H - pad.top - pad.bottom}
                fill="transparent"
                tabIndex={0}
                aria-label={`${dayLabel(p.date)}: ${format(p.value)}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {i % every === 0 && (
                <text x={x(i) + bar / 2} y={H - 8} textAnchor="middle" className="chart-axis">
                  {dayLabel(p.date)}
                </text>
              )}
            </g>
          );
        })}
        {points[peak]?.value > 0 && hover === null && (
          <text x={x(peak) + bar / 2} y={y(points[peak].value) - 6} textAnchor="middle" className="chart-peak">
            {format(points[peak].value)}
          </text>
        )}
      </svg>
      {hover !== null && points[hover] && (
        <div
          className="chart-tip"
          style={{ insetInlineStart: `${(lang === 'ar' ? (n - hover - 0.5) : hover + 0.5) * (100 / n)}%` }}
          role="status"
        >
          <strong className="tabnum">{format(points[hover].value)}</strong>
          <span>{dayLabel(points[hover].date)}</span>
        </div>
      )}
    </figure>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}
