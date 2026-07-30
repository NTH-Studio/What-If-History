import { useQuery } from '@tanstack/react-query';
import { CRS, latLngBounds, type LatLngExpression } from 'leaflet';
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  SVGOverlay,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { type SyntheticEvent, useEffect } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Minus, Plus, X } from 'lucide-react';
import type { EventMapCue, MapFeature, Nation, Unit } from '@what-if-history/contracts';
import { api } from '../api';
import styles from '../styles/App.module.css';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  nationFocusBounds,
  svgPointToLeaflet,
  type LeafletBounds,
} from './mapCoordinates';

export interface MapSelection {
  kind: 'city' | 'unit' | 'nation';
  name: string;
  nationCode: string;
  detail: string;
}

export default function MapView({
  gameId,
  units,
  nations,
  playerNationCode,
  onCountrySelect,
  onSelectionChange,
  focusCue,
  showIntel = true,
  recenterToken = 0,
  surface = 'none',
}: {
  gameId: string;
  units: Unit[];
  nations: Nation[];
  playerNationCode: string;
  onCountrySelect: (code: string) => void;
  onSelectionChange?: (selection: MapSelection | undefined) => void;
  focusCue?: EventMapCue;
  showIntel?: boolean;
  recenterToken?: number;
  surface?: 'none' | 'dock' | 'deck' | 'workspace';
}) {
  const { t } = useTranslation();
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.cities });
  const regions = useQuery({ queryKey: ['regions'], queryFn: api.regions });
  const campaignRegions = useQuery({
    queryKey: ['game-regions', gameId],
    queryFn: () => api.gameRegions(gameId),
  });
  const features = useQuery({
    queryKey: ['map-features', gameId],
    queryFn: () => api.mapFeatures(gameId),
  });
  const [selection, setSelection] = useState<MapSelection>();
  const selectMapItem = (next: MapSelection) => {
    setSelection(next);
    onSelectionChange?.(next);
  };
  const nationNames = useMemo(
    () => new Map(nations.map((nation) => [nation.code, nation.name])),
    [nations],
  );
  const bounds = latLngBounds([0, 0], [MAP_HEIGHT, MAP_WIDTH]);
  const focusableRegions = useMemo(() => {
    const firstByNation = new Map<string, string>();
    for (const region of regions.data?.regions ?? []) {
      if (region.nation_code && !firstByNation.has(region.nation_code)) {
        firstByNation.set(region.nation_code, region.id);
      }
    }
    return firstByNation;
  }, [regions.data]);
  const focusBounds = useMemo(
    () => (cities.data ? nationFocusBounds(cities.data, playerNationCode) : undefined),
    [cities.data, playerNationCode],
  );
  const campaignOwners = useMemo(
    () =>
      new Map(
        campaignRegions.data?.map((region) => [region.regionId, region.ownerNationCode]) ?? [],
      ),
    [campaignRegions.data],
  );
  const activeRegionIds = useMemo(
    () =>
      new Set(
        focusCue?.locations
          .filter((location) => location.kind === 'region')
          .map((location) => location.region_id) ?? [],
      ),
    [focusCue],
  );
  const activeNationCodes = useMemo(
    () =>
      new Set(
        focusCue?.locations
          .filter((location) => location.kind === 'nation')
          .map((location) => location.nation_code) ?? [],
      ),
    [focusCue],
  );
  const activeFeatureIds = useMemo(
    () =>
      new Set(
        focusCue?.locations
          .filter((location) => location.kind === 'feature')
          .map((location) => location.feature_id) ?? [],
      ),
    [focusCue],
  );
  const activeUnitIds = useMemo(
    () =>
      new Set(
        focusCue?.locations
          .filter((location) => location.kind === 'unit')
          .map((location) => location.unit_id) ?? [],
      ),
    [focusCue],
  );

  return (
    <div className={styles.mapWorkspace} data-surface={surface}>
      <section className={styles.mapPanel} aria-label={t('map.title')}>
        <MapContainer
          crs={CRS.Simple}
          bounds={bounds}
          minZoom={-1}
          maxZoom={3}
          zoomSnap={0.25}
          zoomDelta={0.5}
          className={styles.map!}
          attributionControl={false}
          zoomControl={false}
        >
          <NationViewport bounds={focusBounds} recenterToken={recenterToken} />
          <MapControls homeBounds={focusBounds} />
          <EventViewport
            cue={focusCue}
            cities={cities.data ?? []}
            features={features.data ?? []}
            units={units}
          />
          <ImageOverlay url="/1936.svg" bounds={bounds} />
          <SVGOverlay
            bounds={bounds}
            attributes={{
              class: styles.nationHitOverlay!,
              viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`,
              preserveAspectRatio: 'none',
            }}
          >
            {(regions.data?.regions ?? []).map((region) => {
              const nationCode = campaignOwners.get(region.id) ?? region.nation_code;
              if (!nationCode) return null;
              const nationName = nationNames.get(nationCode) ?? nationCode;
              const focusable = focusableRegions.get(nationCode) === region.id;
              return (
                <path
                  key={region.id}
                  d={region.path}
                  data-region-id={region.id}
                  className={`${styles.nationHitRegion} ${
                    activeRegionIds.has(region.id) || activeNationCodes.has(nationCode)
                      ? styles.mapEventRegion
                      : ''
                  }`}
                  tabIndex={focusable ? 0 : -1}
                  role={focusable ? 'button' : undefined}
                  aria-label={
                    focusable ? t('map.inspectCountry', { country: nationName }) : undefined
                  }
                  onClick={() => {
                    selectMapItem({
                      kind: 'nation',
                      name: nationName,
                      nationCode,
                      detail: t('map.nation'),
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectMapItem({
                        kind: 'nation',
                        name: nationName,
                        nationCode,
                        detail: t('map.nation'),
                      });
                    }
                  }}
                >
                  <title>{nationName}</title>
                </path>
              );
            })}
          </SVGOverlay>
          {features.data?.map((feature) => (
            <CircleMarker
              key={`feature-${feature.id}`}
              center={svgPointToLeaflet(feature.coords)}
              radius={feature.featureType === 'capital' ? 7 : 5}
              pathOptions={{
                color: feature.color,
                fillColor: feature.color,
                fillOpacity: 0.88,
                weight: 2,
                className: activeFeatureIds.has(feature.id) ? styles.mapEventMarker : undefined,
              }}
              eventHandlers={{
                click: () =>
                  selectMapItem({
                    kind: 'city',
                    name: `${feature.symbol} ${feature.name}`,
                    nationCode: feature.nationCode ?? playerNationCode,
                    detail: feature.featureType,
                  }),
              }}
            >
              <Tooltip>{feature.name}</Tooltip>
            </CircleMarker>
          ))}
          {units.map((unit) => (
            <CircleMarker
              key={unit.id}
              center={svgPointToLeaflet(unit.centroid)}
              radius={7}
              pathOptions={{
                color: '#0b121d',
                fillColor: '#6ac6d9',
                fillOpacity: 0.95,
                weight: 2,
                className: activeUnitIds.has(unit.id) ? styles.mapEventMarker : undefined,
              }}
              eventHandlers={{
                click: () =>
                  selectMapItem({
                    kind: 'unit',
                    name: unit.name,
                    nationCode: unit.nationCode,
                    detail: `${unit.unitType} · ${unit.strength}%`,
                  }),
              }}
            >
              <Tooltip>{unit.name}</Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </section>
      {showIntel && selection ? (
        <aside className={styles.intelPanel} aria-live="polite">
          <header className={styles.intelHeader}>
            <div>
              <p className={styles.eyebrow}>INTEL · GEO</p>
              <h2>{selection.name}</h2>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('common.close')}
              onClick={() => {
                setSelection(undefined);
                onSelectionChange?.(undefined);
              }}
            >
              <X size={17} />
            </button>
          </header>
          <dl className={styles.detailList}>
            <div>
              <dt>{t('map.nation')}</dt>
              <dd>{nationNames.get(selection.nationCode) ?? selection.nationCode}</dd>
            </div>
            <div>
              <dt>
                {selection.kind === 'city'
                  ? t('map.city')
                  : selection.kind === 'unit'
                    ? t('map.units')
                    : t('map.nation')}
              </dt>
              <dd>{selection.detail}</dd>
            </div>
            <div>
              <dt>{t('map.countryProfile')}</dt>
              <dd>
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() => onCountrySelect(selection.nationCode)}
                >
                  {t('map.openCountry', {
                    country: nationNames.get(selection.nationCode) ?? selection.nationCode,
                  })}
                </button>
              </dd>
            </div>
          </dl>
        </aside>
      ) : null}
    </div>
  );
}

function EventViewport({
  cue,
  cities,
  features,
  units,
}: {
  cue: EventMapCue | undefined;
  cities: ReadonlyArray<{
    nation_code: string;
    type: string;
    coords: readonly [number, number];
  }>;
  features: MapFeature[];
  units: Unit[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!cue?.locations.length) return;
    const reduceMotion =
      (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
      globalThis.document.documentElement.dataset.reduceMapMotion === 'true';
    const points: LatLngExpression[] = [];
    let worldView = cue.camera === 'world';

    for (const location of cue.locations) {
      if (location.kind === 'global') {
        worldView = true;
        continue;
      }
      if (location.kind === 'coordinates') {
        points.push(svgPointToLeaflet(location.coordinates));
        continue;
      }
      if (location.kind === 'feature') {
        const feature = features.find((item) => item.id === location.feature_id);
        if (feature) points.push(svgPointToLeaflet(feature.coords));
        continue;
      }
      if (location.kind === 'unit') {
        const unit = units.find((item) => item.id === location.unit_id);
        if (unit) points.push(svgPointToLeaflet(unit.centroid));
        continue;
      }
      if (location.kind === 'nation') {
        const nationBounds = nationFocusBounds(cities, location.nation_code);
        if (nationBounds) points.push(...nationBounds);
        continue;
      }
      const regionPath = Array.from(
        globalThis.document.querySelectorAll<SVGGraphicsElement>('[data-region-id]'),
      ).find((element) => element.dataset.regionId === location.region_id);
      if (regionPath) {
        const box = regionPath.getBBox();
        points.push(
          svgPointToLeaflet([box.x, box.y + box.height]),
          svgPointToLeaflet([box.x + box.width, box.y]),
        );
      }
    }

    map.invalidateSize({ animate: false });
    if (worldView || points.length === 0) {
      map.fitBounds(latLngBounds([0, 0], [MAP_HEIGHT, MAP_WIDTH]), {
        animate: !reduceMotion,
        duration: reduceMotion ? 0 : 0.75,
        padding: [24, 24],
      });
      return;
    }
    if (points.length === 1 || cue.camera === 'point') {
      map.flyTo(points[0]!, 2.35, {
        animate: !reduceMotion,
        duration: reduceMotion ? 0 : 0.75,
      });
      return;
    }
    map.flyToBounds(latLngBounds(points), {
      animate: !reduceMotion,
      duration: reduceMotion ? 0 : 0.75,
      paddingTopLeft: [28, 28],
      paddingBottomRight: [380, 80],
      maxZoom: 3,
    });
  }, [cities, cue, features, map, units]);

  return null;
}

function MapControls({ homeBounds }: { homeBounds: LeafletBounds | undefined }) {
  const map = useMap();
  const { t } = useTranslation();
  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

  return (
    <div
      className={styles.mapControls}
      role="group"
      aria-label={t('map.controls')}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <button
        type="button"
        aria-label={t('map.zoomIn')}
        onClick={() => map.zoomIn(0.5, { animate: false })}
      >
        <Plus size={18} />
      </button>
      <button
        type="button"
        aria-label={t('map.zoomOut')}
        onClick={() => map.zoomOut(0.5, { animate: false })}
      >
        <Minus size={18} />
      </button>
      <button
        type="button"
        aria-label={t('map.recenter')}
        disabled={!homeBounds}
        onClick={() =>
          homeBounds &&
          map.fitBounds(homeBounds, {
            animate: true,
            duration: 0.2,
            padding: [28, 28],
            maxZoom: 3,
          })
        }
      >
        <Crosshair size={17} />
      </button>
    </div>
  );
}

function NationViewport({
  bounds,
  recenterToken,
}: {
  bounds: LeafletBounds | undefined;
  recenterToken: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) return;
    map.invalidateSize({ animate: false });
    map.fitBounds(bounds, {
      animate: false,
      padding: [28, 28],
      maxZoom: 3,
    });
  }, [bounds, map, recenterToken]);

  return null;
}
