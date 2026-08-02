import { useQuery } from '@tanstack/react-query';
import { CRS, latLngBounds, type LatLngExpression } from 'leaflet';
import { CircleMarker, MapContainer, SVGOverlay, Tooltip, useMap } from 'react-leaflet';
import { type SyntheticEvent, useEffect } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Flag, Layers3, Minus, Plus, X } from 'lucide-react';
import type {
  EventMapCue,
  MapFeature,
  Nation,
  RegionState,
  TerritorialStatus,
  Unit,
} from '@what-if-history/contracts';
import { api } from '../api';
import styles from '../styles/App.module.css';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  nationFocusBounds,
  svgPointToLeaflet,
  type LeafletBounds,
} from './mapCoordinates';
import {
  StrategicCommandPanel,
  strategicLayerOptions,
  StrategicMapOverlays,
  type StrategicLayer,
} from './StrategicMapUi';

export interface MapSelection {
  kind: 'city' | 'unit' | 'nation' | 'character' | 'region';
  name: string;
  nationCode: string;
  detail: string;
  controllerNationCode?: string;
  territorialStatus?: TerritorialStatus;
  administeringNationCode?: string;
  claimNationCodes?: string[];
  regionId?: string;
  regionState?: RegionState;
  entityId?: string;
}

const MAP_MAX_ZOOM = 4;

function heatColor(value: number, low: string, high: string) {
  const parse = (color: string) =>
    [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
  const start = parse(low);
  const end = parse(high);
  const ratio = Math.max(0, Math.min(1, value / 100));
  return `rgb(${start.map((channel, index) => Math.round(channel! + (end[index]! - channel!) * ratio)).join(',')})`;
}

function regionLayerFill(
  layer: StrategicLayer,
  region: RegionState | undefined,
  politicalColor: string,
) {
  if (
    !region ||
    layer === 'political' ||
    layer === 'forces' ||
    layer === 'intelligence' ||
    layer === 'events'
  ) {
    return politicalColor;
  }
  if (layer === 'population')
    return heatColor(Math.min(100, Math.log10(region.population + 1) * 13), '#172d3f', '#ffcb54');
  if (layer === 'habitability') return heatColor(region.habitability, '#6f1524', '#5fbf72');
  if (layer === 'radiation') return heatColor(region.radiation, '#173d2c', '#d6ff38');
  if (layer === 'supply') return heatColor(region.supply, '#6f2632', '#45b7c4');
  return politicalColor;
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
  const { t, i18n } = useTranslation();
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
  const strategic = useQuery({
    queryKey: ['strategic-state', gameId],
    queryFn: () => api.strategicState(gameId),
  });
  const [selection, setSelection] = useState<MapSelection>();
  const [showClaims, setShowClaims] = useState(false);
  const [strategicLayer, setStrategicLayer] = useState<StrategicLayer>(() => {
    const stored = localStorage.getItem(`what-if-history-strategic-layer:${gameId}`);
    return (
      [
        'political',
        'fronts',
        'forces',
        'supply',
        'population',
        'habitability',
        'radiation',
        'intelligence',
        'events',
      ].includes(stored ?? '')
        ? stored
        : 'political'
    ) as StrategicLayer;
  });
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const [destinationRegionId, setDestinationRegionId] = useState<string>();
  const selectMapItem = (next: MapSelection) => {
    setSelection(next);
    onSelectionChange?.(next);
  };
  const nationNames = useMemo(
    () => new Map(nations.map((nation) => [nation.code, nation.name])),
    [nations],
  );
  const nationColors = useMemo(
    () => new Map(nations.map((nation) => [nation.code, nation.color])),
    [nations],
  );
  const integer = useMemo(
    () =>
      new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
        maximumFractionDigits: 0,
      }),
    [i18n.language, i18n.resolvedLanguage],
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
  const campaignWorld = useMemo(
    () => new Map(campaignRegions.data?.map((region) => [region.regionId, region]) ?? []),
    [campaignRegions.data],
  );
  const strategicRegions = useMemo(
    () => new Map(strategic.data?.regions.map((region) => [region.regionId, region]) ?? []),
    [strategic.data],
  );
  const frontRegionIds = useMemo(
    () => new Set(strategic.data?.fronts.flatMap((front) => front.regionIds) ?? []),
    [strategic.data],
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
          maxZoom={MAP_MAX_ZOOM}
          zoomSnap={0.25}
          zoomDelta={0.5}
          className={styles.map!}
          attributionControl={false}
          zoomControl={false}
        >
          <NationViewport bounds={focusBounds} recenterToken={recenterToken} />
          <MapControls
            homeBounds={focusBounds}
            showClaims={showClaims}
            onToggleClaims={() => setShowClaims((current) => !current)}
            strategicLayer={strategicLayer}
            onStrategicLayerChange={(layer) => {
              setStrategicLayer(layer);
              localStorage.setItem(`what-if-history-strategic-layer:${gameId}`, layer);
            }}
          />
          <EventViewport
            cue={focusCue}
            cities={cities.data ?? []}
            features={features.data ?? []}
            units={strategic.data?.units ?? units}
          />
          <SVGOverlay
            bounds={bounds}
            attributes={{
              class: styles.neutralMapOverlay!,
              viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`,
              preserveAspectRatio: 'none',
              'aria-hidden': 'true',
            }}
          >
            {(regions.data?.regions ?? []).map((region) => (
              <path key={`neutral-${region.id}`} d={region.path} />
            ))}
          </SVGOverlay>
          <SVGOverlay
            bounds={bounds}
            attributes={{
              class: styles.nationHitOverlay!,
              viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`,
              preserveAspectRatio: 'none',
            }}
          >
            {(regions.data?.regions ?? []).map((region) => {
              const campaignRegion = campaignWorld.get(region.id);
              const nationCode = campaignRegion?.ownerNationCode ?? region.nation_code;
              if (!nationCode) return null;
              const controllerNationCode = campaignRegion?.controllerNationCode ?? nationCode;
              const claimNationCodes = campaignRegion?.claimNationCodes ?? [];
              const nationName = nationNames.get(nationCode) ?? nationCode;
              const controllerName = nationNames.get(controllerNationCode) ?? controllerNationCode;
              const ownerColor = nationColors.get(nationCode) ?? region.fill;
              const controllerColor = nationColors.get(controllerNationCode) ?? '#101820';
              const contested = controllerNationCode !== nationCode;
              const focusable = focusableRegions.get(nationCode) === region.id;
              const strategicState = strategicRegions.get(region.id);
              const strategicFill = regionLayerFill(strategicLayer, strategicState, ownerColor);
              const regionName = campaignRegion?.name ?? region.name;
              const regionSelection: MapSelection = {
                kind: 'region',
                name: regionName,
                nationCode,
                controllerNationCode,
                detail: regionName,
                regionId: region.id,
                ...(strategicState ? { regionState: strategicState } : {}),
                ...(campaignRegion?.territorialStatus
                  ? { territorialStatus: campaignRegion.territorialStatus }
                  : {}),
                ...(campaignRegion?.administeringNationCode
                  ? { administeringNationCode: campaignRegion.administeringNationCode }
                  : {}),
                ...(claimNationCodes.length ? { claimNationCodes } : {}),
              };
              const accessibleState = [
                t('map.legalOwner', { country: nationName }),
                t('map.militaryController', { country: controllerName }),
                claimNationCodes.length
                  ? t('map.claimedBy', {
                      countries: claimNationCodes
                        .map((code) => nationNames.get(code) ?? code)
                        .join(', '),
                    })
                  : t('map.noClaims'),
              ].join('. ');
              return (
                <path
                  key={region.id}
                  d={region.path}
                  data-region-id={region.id}
                  data-owner-code={nationCode}
                  data-controller-code={controllerNationCode}
                  data-claim-codes={claimNationCodes.join(',')}
                  data-contested={contested}
                  className={`${styles.nationHitRegion} ${
                    activeRegionIds.has(region.id) || activeNationCodes.has(nationCode)
                      ? styles.mapEventRegion
                      : ''
                  }`}
                  style={{
                    fill: strategicFill,
                    fillOpacity: 0.96,
                    vectorEffect: 'non-scaling-stroke',
                    stroke: frontRegionIds.has(region.id)
                      ? '#ff704f'
                      : contested
                        ? controllerColor
                        : showClaims && claimNationCodes.length
                          ? '#f5c451'
                          : '#245aa5',
                    strokeWidth: frontRegionIds.has(region.id)
                      ? 3
                      : contested
                        ? 2.2
                        : showClaims && claimNationCodes.length
                          ? 1.8
                          : 1.15,
                    strokeDasharray:
                      contested || (showClaims && claimNationCodes.length) ? '6 3' : undefined,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${t('map.inspectRegion', { region: regionName })}. ${
                    focusable ? `${t('map.inspectCountry', { country: nationName })}. ` : ''
                  }${accessibleState}`}
                  onClick={() => {
                    if (selectedUnitId) setDestinationRegionId(region.id);
                    selectMapItem(regionSelection);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectMapItem(regionSelection);
                    }
                  }}
                >
                  <title>{accessibleState}</title>
                </path>
              );
            })}
          </SVGOverlay>
          {features.data?.map((feature) => (
            <CircleMarker
              key={`feature-${feature.id}`}
              ref={(marker) => {
                const element = marker?.getElement();
                element?.setAttribute('role', 'button');
                element?.setAttribute('tabindex', '0');
                element?.setAttribute(
                  'aria-label',
                  t('map.inspectFeature', { feature: feature.name }),
                );
              }}
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
                click: () => {
                  const campaignRegion = campaignWorld.get(feature.regionId);
                  const catalogFeature = cities.data?.find(
                    (city) =>
                      city.region_id === feature.regionId &&
                      city.coords[0] === feature.coords[0] &&
                      city.coords[1] === feature.coords[1],
                  );
                  selectMapItem({
                    kind: 'city',
                    name: `${feature.symbol} ${feature.name}`,
                    nationCode:
                      campaignRegion?.administeringNationCode ??
                      feature.nationCode ??
                      playerNationCode,
                    detail:
                      catalogFeature?.type === 'fortress'
                        ? t('map.fortress')
                        : feature.featureType === 'capital'
                          ? t('map.capital')
                          : t('map.city'),
                    ...(campaignRegion?.territorialStatus
                      ? { territorialStatus: campaignRegion.territorialStatus }
                      : {}),
                    ...(campaignRegion?.administeringNationCode
                      ? { administeringNationCode: campaignRegion.administeringNationCode }
                      : {}),
                    ...(campaignRegion?.claimNationCodes.length
                      ? { claimNationCodes: campaignRegion.claimNationCodes }
                      : {}),
                    regionId: feature.regionId,
                  });
                },
              }}
            >
              <Tooltip>{feature.name}</Tooltip>
            </CircleMarker>
          ))}
          {!strategic.data
            ? units.map((unit) => (
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
                        regionId: unit.regionId,
                        detail: `${unit.unitType} · ${unit.strength}%`,
                      }),
                  }}
                >
                  <Tooltip>{unit.name}</Tooltip>
                </CircleMarker>
              ))
            : null}
          {strategic.data ? (
            <StrategicMapOverlays
              state={strategic.data}
              cities={(cities.data ?? []).map((city) => ({
                region_id: city.region_id,
                coords: [...city.coords] as [number, number],
              }))}
              activeLayer={strategicLayer}
              {...(selectedUnitId ? { selectedUnitId } : {})}
              onSelectUnit={(unit) => {
                setSelectedUnitId(unit.id);
                setDestinationRegionId(undefined);
                selectMapItem({
                  kind: 'unit',
                  name: unit.name,
                  nationCode: unit.nationCode,
                  regionId: unit.regionId,
                  entityId: unit.id,
                  detail: `${unit.unitType} · ${Math.round(unit.strength)}% · ${Math.round(unit.supply)}%`,
                });
              }}
              onSelectCharacter={(characterId) => {
                const character = strategic.data.characters.find(
                  (candidate) => candidate.id === characterId,
                );
                if (!character) return;
                selectMapItem({
                  kind: 'character',
                  name: character.name,
                  nationCode: character.nationCode ?? playerNationCode,
                  ...(character.regionId ? { regionId: character.regionId } : {}),
                  entityId: character.id,
                  detail: `${character.role} · ${character.status}`,
                });
              }}
            />
          ) : null}
        </MapContainer>
      </section>
      {strategic.data && selectedUnitId ? (
        <StrategicCommandPanel
          gameId={gameId}
          state={strategic.data}
          unitId={selectedUnitId}
          {...(destinationRegionId ? { destinationRegionId } : {})}
          onDestinationChange={setDestinationRegionId}
          onClose={() => {
            setSelectedUnitId(undefined);
            setDestinationRegionId(undefined);
          }}
        />
      ) : null}
      {showIntel && selection && !selectedUnitId ? (
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
            {selection.kind === 'region' ? (
              <>
                <div>
                  <dt>{t('map.legalOwnerLabel')}</dt>
                  <dd>{nationNames.get(selection.nationCode) ?? selection.nationCode}</dd>
                </div>
                <div>
                  <dt>{t('map.militaryControllerLabel')}</dt>
                  <dd>
                    {nationNames.get(selection.controllerNationCode ?? selection.nationCode) ??
                      selection.controllerNationCode ??
                      selection.nationCode}
                  </dd>
                </div>
              </>
            ) : selection.territorialStatus ? (
              <>
                <div>
                  <dt>{t('map.territorialStatus')}</dt>
                  <dd>{t(`map.territorialStatuses.${selection.territorialStatus}`)}</dd>
                </div>
                <div>
                  <dt>{t('map.administeringPower')}</dt>
                  <dd>
                    {nationNames.get(selection.administeringNationCode ?? selection.nationCode) ??
                      selection.administeringNationCode ??
                      selection.nationCode}
                  </dd>
                </div>
                {selection.claimNationCodes?.length ? (
                  <div>
                    <dt>{t('map.territorialClaim')}</dt>
                    <dd>
                      {selection.claimNationCodes
                        .map((code) => nationNames.get(code) ?? code)
                        .join(', ')}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : (
              <div>
                <dt>{t('map.nation')}</dt>
                <dd>{nationNames.get(selection.nationCode) ?? selection.nationCode}</dd>
              </div>
            )}
            {selection.kind === 'region' && selection.territorialStatus ? (
              <>
                <div>
                  <dt>{t('map.territorialStatus')}</dt>
                  <dd>{t(`map.territorialStatuses.${selection.territorialStatus}`)}</dd>
                </div>
                {selection.administeringNationCode ? (
                  <div>
                    <dt>{t('map.administeringPower')}</dt>
                    <dd>
                      {nationNames.get(selection.administeringNationCode) ??
                        selection.administeringNationCode}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
            {selection.kind === 'region' && selection.claimNationCodes?.length ? (
              <div>
                <dt>{t('map.territorialClaim')}</dt>
                <dd>
                  {selection.claimNationCodes
                    .map((code) => nationNames.get(code) ?? code)
                    .join(', ')}
                </dd>
              </div>
            ) : null}
            {selection.kind === 'region' && selection.regionState ? (
              <>
                <div>
                  <dt>{t('map.region')}</dt>
                  <dd>{selection.detail}</dd>
                </div>
                <div>
                  <dt>{t('map.population')}</dt>
                  <dd>{integer.format(selection.regionState.population)}</dd>
                </div>
                <div>
                  <dt>{t('map.terrain')}</dt>
                  <dd>{t(`map.terrainTypes.${selection.regionState.terrain}`)}</dd>
                </div>
                {[
                  ['infrastructure', selection.regionState.infrastructure],
                  ['industrialCapacity', selection.regionState.industrialCapacity],
                  ['supply', selection.regionState.supply],
                  ['health', selection.regionState.health],
                  ['habitability', selection.regionState.habitability],
                  ['contamination', selection.regionState.contamination],
                  ['radiation', selection.regionState.radiation],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{t(`map.${label}`)}</dt>
                    <dd>{Math.round(value as number)}%</dd>
                  </div>
                ))}
              </>
            ) : null}
            {selection.kind !== 'region' ? (
              <div>
                <dt>
                  {selection.kind === 'city'
                    ? t('map.city')
                    : selection.kind === 'unit'
                      ? t('map.units')
                      : selection.kind === 'character'
                        ? t('strategic.characters')
                        : t('map.nation')}
                </dt>
                <dd>{selection.detail}</dd>
              </div>
            ) : null}
            <div>
              <dt>
                {selection.territorialStatus
                  ? t('map.administeringPowerProfile')
                  : t('map.countryProfile')}
              </dt>
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
  units: Array<{ id: string; centroid: [number, number] }>;
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

function MapControls({
  homeBounds,
  showClaims,
  onToggleClaims,
  strategicLayer,
  onStrategicLayerChange,
}: {
  homeBounds: LeafletBounds | undefined;
  showClaims: boolean;
  onToggleClaims: () => void;
  strategicLayer: StrategicLayer;
  onStrategicLayerChange: (layer: StrategicLayer) => void;
}) {
  const map = useMap();
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

  useEffect(() => {
    const syncZoom = () => setZoom(map.getZoom());
    syncZoom();
    map.on('zoomend', syncZoom);
    return () => {
      map.off('zoomend', syncZoom);
    };
  }, [map]);

  return (
    <div
      className={styles.mapControls}
      data-testid="map-controls"
      data-zoom={zoom}
      role="group"
      aria-label={t('map.controls')}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <button
        type="button"
        aria-label={t('map.zoomIn')}
        disabled={zoom >= map.getMaxZoom()}
        onClick={() => map.zoomIn(0.5, { animate: false })}
      >
        <Plus size={18} />
      </button>
      <button
        type="button"
        aria-label={t('map.zoomOut')}
        disabled={zoom <= map.getMinZoom()}
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
      <span className={styles.mapControlsDivider} aria-hidden="true" />
      <button
        type="button"
        className={styles.mapClaimsControl}
        aria-label={t('map.claimsLayer')}
        aria-pressed={showClaims}
        title={t('map.claimsLayer')}
        onClick={onToggleClaims}
      >
        <Flag size={17} />
      </button>
      <span className={styles.mapControlsDivider} aria-hidden="true" />
      <div className={styles.strategicLayerControl} data-expanded={layerMenuOpen}>
        <button
          type="button"
          className={styles.strategicLayerToggle}
          aria-label={t('strategic.layers.open')}
          aria-expanded={layerMenuOpen}
          onClick={() => setLayerMenuOpen((current) => !current)}
        >
          <Layers3 size={18} />
          <span>{t('strategic.layers.title')}</span>
        </button>
        {layerMenuOpen ? (
          <div role="radiogroup" aria-label={t('strategic.layers.title')}>
            {strategicLayerOptions.map(({ id, icon: Icon, label }) => (
              <button
                type="button"
                role="radio"
                aria-checked={strategicLayer === id}
                data-active={strategicLayer === id}
                key={id}
                onClick={() => {
                  onStrategicLayerChange(id);
                  setLayerMenuOpen(false);
                }}
              >
                <Icon size={16} />
                <span>{t(label)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
