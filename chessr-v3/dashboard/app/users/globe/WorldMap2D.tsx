'use client';

import { useMemo, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';
import { pickIso, pickName, type CountryFeature, type CountryRow } from './lib';

// SVG choropleth using d3-geo's Natural Earth projection. Same GeoJSON
// the 3D globe uses, so toggling between views is a free swap with no
// extra fetch. Hover tooltip is a positioned div populated from the
// hovered country's data — much nicer than the native <title> popup.

export function WorldMap2D({
  width, height, countries, counts, max, colorFor,
}: {
  width: number;
  height: number;
  countries: CountryFeature[];
  counts: Record<string, CountryRow>;
  max: number;
  colorFor: (count: number, max: number) => string;
}) {
  // fitSize on the special Sphere GeoJSON object — d3-geo's idiomatic way
  // to scale the projection so the entire world fits the viewport.
  const projection = useMemo(() => {
    return geoNaturalEarth1().fitSize(
      [width, height],
      { type: 'Sphere' } as unknown as Feature<Geometry>,
    );
  }, [width, height]);

  const pathGen = useMemo(() => geoPath(projection), [projection]);

  // Sphere outline path = the "ocean" rectangle equivalent for non-rect
  // projections; gives us the curved outer border of the world.
  const spherePath = useMemo(
    () => pathGen({ type: 'Sphere' } as unknown as Feature<Geometry>) || '',
    [pathGen],
  );

  // Subtle graticule (lat/lng grid) — purely decorative.
  const graticulePath = useMemo(() => {
    const lines: string[] = [];
    for (let lng = -150; lng <= 150; lng += 30) {
      const d = pathGen({
        type: 'LineString',
        coordinates: Array.from({ length: 181 }, (_, i) => [lng, -90 + i]),
      } as unknown as Feature<Geometry>);
      if (d) lines.push(d);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const d = pathGen({
        type: 'LineString',
        coordinates: Array.from({ length: 361 }, (_, i) => [-180 + i, lat]),
      } as unknown as Feature<Geometry>);
      if (d) lines.push(d);
    }
    return lines.join(' ');
  }, [pathGen]);

  const [hover, setHover] = useState<{ x: number; y: number; iso: string | null; name: string; count: number } | null>(null);

  if (width === 0 || height === 0) return null;

  return (
    <div className="relative h-full w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Ocean fill — match the 3D globe's ocean material so toggling
            doesn't feel like a brand swap. */}
        <path d={spherePath} fill="#101115" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
        <path d={graticulePath} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />

        {countries.map((f, i) => {
          const iso = pickIso(f);
          const row = iso ? counts[iso] : undefined;
          const count = row?.user_count ?? 0;
          const d = pathGen(f);
          if (!d) return null;
          return (
            <path
              key={iso ?? `unk-${i}`}
              d={d}
              fill={colorFor(count, max)}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={0.4}
              style={{ cursor: 'default', transition: 'fill 200ms' }}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement)?.getBoundingClientRect();
                setHover({
                  x: e.clientX - (rect?.left ?? 0),
                  y: e.clientY - (rect?.top ?? 0),
                  iso,
                  name: row?.country || pickName(f),
                  count,
                });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-card/95 px-2.5 py-1.5 text-[12px] shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(hover.x + 12, width - 160),
            top: Math.min(hover.y + 12, height - 44),
          }}
        >
          <div className="font-semibold">
            {hover.name}
            {hover.iso && <span className="ml-1.5 font-normal text-muted-foreground">({hover.iso})</span>}
          </div>
          <div className="num text-[11px] text-muted-foreground">
            {hover.count.toLocaleString()} user{hover.count === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  );
}
