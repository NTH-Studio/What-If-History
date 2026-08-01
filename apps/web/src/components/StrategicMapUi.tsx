import { useMutation, useQueryClient } from '@tanstack/react-query';
import { divIcon, type LatLngExpression } from 'leaflet';
import {
  Activity,
  Biohazard,
  Crosshair,
  Eye,
  Factory,
  Flame,
  Layers3,
  Radio,
  Route,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Circle, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import type {
  CharacterIconKey,
  MovementOrderInput,
  MovementOrderPreview,
  StrategicMission,
  StrategicState,
  StrategicUnit,
} from '@what-if-history/contracts';
import { api, createRequestId } from '../api';
import styles from '../styles/App.module.css';
import { svgPointToLeaflet } from './mapCoordinates';

export type StrategicLayer =
  | 'political'
  | 'fronts'
  | 'forces'
  | 'supply'
  | 'population'
  | 'habitability'
  | 'radiation'
  | 'intelligence'
  | 'events';

const unitGlyph: Record<StrategicUnit['unitType'], string> = {
  infantry: 'INF',
  armor: 'ARM',
  artillery: 'ART',
  naval: 'FLT',
  submarine: 'SUB',
  air: 'AIR',
  transport: 'TRN',
};

const characterGlyph: Record<CharacterIconKey, string> = {
  leader: '<path d="M5 8l3 3 4-6 4 6 3-3-2 10H7L5 8Z"/><path d="M8 21h8"/>',
  commander:
    '<path d="M12 3l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L12 3Z"/>',
  diplomat: '<path d="M7 8h10v7H9l-4 3v-3H3V8h4Z"/><path d="M9 11h6"/>',
  operative:
    '<path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/>',
  scientist:
    '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M8 15h8"/>',
  civilian: '<circle cx="12" cy="8" r="3"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/>',
};

const escapeMarkerText = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });

const layerOptions: Array<{
  id: StrategicLayer;
  icon: typeof Layers3;
  label: string;
}> = [
  { id: 'political', icon: Layers3, label: 'strategic.layers.political' },
  { id: 'fronts', icon: Shield, label: 'strategic.layers.fronts' },
  { id: 'forces', icon: Crosshair, label: 'strategic.layers.forces' },
  { id: 'supply', icon: Route, label: 'strategic.layers.supply' },
  { id: 'population', icon: Users, label: 'strategic.layers.population' },
  { id: 'habitability', icon: Activity, label: 'strategic.layers.habitability' },
  { id: 'radiation', icon: Biohazard, label: 'strategic.layers.radiation' },
  { id: 'intelligence', icon: Eye, label: 'strategic.layers.intelligence' },
  { id: 'events', icon: Flame, label: 'strategic.layers.events' },
];

export function StrategicLayerControl({
  active,
  onChange,
}: {
  active: StrategicLayer;
  onChange: (layer: StrategicLayer) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.strategicLayerControl} data-expanded={expanded}>
      <button
        type="button"
        className={styles.strategicLayerToggle}
        aria-label={t('strategic.layers.open')}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <Layers3 size={18} />
        <span>{t('strategic.layers.title')}</span>
      </button>
      {expanded ? (
        <div role="radiogroup" aria-label={t('strategic.layers.title')}>
          {layerOptions.map(({ id, icon: Icon, label }) => (
            <button
              type="button"
              role="radio"
              aria-checked={active === id}
              data-active={active === id}
              key={id}
              onClick={() => {
                onChange(id);
                setExpanded(false);
              }}
            >
              <Icon size={16} />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StrategicMapOverlays({
  state,
  cities,
  activeLayer,
  selectedUnitId,
  onSelectUnit,
  onSelectCharacter,
}: {
  state: StrategicState;
  cities: Array<{ region_id: string; coords: [number, number] }>;
  activeLayer: StrategicLayer;
  selectedUnitId?: string;
  onSelectUnit: (unit: StrategicUnit) => void;
  onSelectCharacter: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  const map = useMap();
  const [mapRevision, setMapRevision] = useState(0);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string>();
  const [isMobile, setIsMobile] = useState(
    () => globalThis.matchMedia?.('(max-width: 720px)').matches ?? false,
  );
  const cityByRegion = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const city of cities) if (!map.has(city.region_id)) map.set(city.region_id, city.coords);
    return map;
  }, [cities]);
  const unitById = useMemo(
    () => new Map(state.units.map((unit) => [unit.id, unit])),
    [state.units],
  );

  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 720px)');
    if (!media) return;
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const refresh = () => {
      setExpandedGroupKey(undefined);
      setMapRevision((current) => current + 1);
    };
    const collapse = () => setExpandedGroupKey(undefined);
    map.on('zoomend', refresh);
    map.on('resize', refresh);
    map.on('moveend', collapse);
    return () => {
      map.off('zoomend', refresh);
      map.off('resize', refresh);
      map.off('moveend', collapse);
    };
  }, [map]);

  useEffect(() => setExpandedGroupKey(undefined), [activeLayer]);

  type StrategicMarkerEntity =
    | {
        kind: 'unit';
        id: string;
        coordinates: [number, number];
        unit: StrategicUnit;
      }
    | {
        kind: 'character';
        id: string;
        coordinates: [number, number];
        character: StrategicState['characters'][number];
      };

  const markerEntities = useMemo<StrategicMarkerEntity[]>(() => {
    const units: StrategicMarkerEntity[] =
      activeLayer === 'forces' ||
      activeLayer === 'fronts' ||
      activeLayer === 'supply' ||
      activeLayer === 'intelligence'
        ? state.units.map((unit) => ({
            kind: 'unit' as const,
            id: unit.id,
            coordinates: unit.centroid,
            unit,
          }))
        : [];
    const characters: StrategicMarkerEntity[] =
      activeLayer === 'political' || activeLayer === 'intelligence'
        ? state.characters.flatMap((character) =>
            character.status !== 'dead' && character.coordinates
              ? [
                  {
                    kind: 'character' as const,
                    id: character.id,
                    coordinates: character.coordinates,
                    character,
                  },
                ]
              : [],
          )
        : [];
    return [...units, ...characters];
  }, [activeLayer, state.characters, state.units]);

  const markerGroups = useMemo(() => {
    void mapRevision;
    const groups: Array<{
      members: StrategicMarkerEntity[];
      center: { x: number; y: number };
    }> = [];

    for (const entity of markerEntities) {
      const point = map.latLngToContainerPoint(svgPointToLeaflet(entity.coordinates));
      const group = groups.find(
        (candidate) => Math.hypot(candidate.center.x - point.x, candidate.center.y - point.y) < 48,
      );
      if (!group) {
        groups.push({ members: [entity], center: { x: point.x, y: point.y } });
        continue;
      }
      const previousCount = group.members.length;
      group.members.push(entity);
      group.center = {
        x: (group.center.x * previousCount + point.x) / group.members.length,
        y: (group.center.y * previousCount + point.y) / group.members.length,
      };
    }

    return groups.map((group) => ({
      ...group,
      key: group.members
        .map((member) => `${member.kind}:${member.id}`)
        .sort()
        .join('|'),
    }));
  }, [map, mapRevision, markerEntities]);

  const selectEntity = (entity: StrategicMarkerEntity, groupKey?: string) => {
    setExpandedGroupKey(isMobile ? undefined : groupKey);
    if (entity.kind === 'unit') onSelectUnit(entity.unit);
    else onSelectCharacter(entity.character.id);
  };

  const renderMarker = (
    entity: StrategicMarkerEntity,
    position: LatLngExpression,
    groupKey?: string,
    spreadIndex = 0,
  ) => {
    if (entity.kind === 'unit') {
      const { unit } = entity;
      const selected = selectedUnitId === unit.id;
      const icon = divIcon({
        className: '',
        html: `<span class="${styles.strategicUnitMarker}" data-domain="${unit.domain}" data-selected="${selected}" data-intel="${unit.intelLevel}"><span>${unitGlyph[unit.unitType]}</span><small>${unit.nationCode}</small><i style="--unit-strength:${Math.round(unit.strength)}%"></i></span>`,
        iconSize: [42, 48],
        iconAnchor: [21, 24],
      });
      return (
        <Marker
          key={`unit-${unit.id}-${spreadIndex}`}
          position={position}
          icon={icon}
          title={unit.name}
          eventHandlers={{ click: () => selectEntity(entity, groupKey) }}
          zIndexOffset={selected ? 1_200 : 700 + spreadIndex}
        >
          <Tooltip>
            <strong>{unit.name}</strong>
            <br />
            {unit.unitType} · {Math.round(unit.strength)}%
            {unit.intelLevel === 'exact' ? ` · ${Math.round(unit.supply)}%` : ' · estimation'}
          </Tooltip>
        </Marker>
      );
    }

    const { character } = entity;
    const icon = divIcon({
      className: '',
      html: `<span class="${styles.strategicCharacterMarker}" data-status="${character.status}" data-icon="${character.iconKey}"><svg aria-hidden="true" viewBox="0 0 24 24">${characterGlyph[character.iconKey]}</svg><span class="${styles.srOnly}">${escapeMarkerText(character.name)} — ${escapeMarkerText(character.role)}</span><i aria-hidden="true">${character.nationCode ?? '—'}</i></span>`,
      iconSize: [44, 52],
      iconAnchor: [22, 26],
    });
    return (
      <Marker
        key={`character-${character.id}-${spreadIndex}`}
        position={position}
        icon={icon}
        title={`${character.name} — ${character.role}`}
        eventHandlers={{ click: () => selectEntity(entity, groupKey) }}
        zIndexOffset={900 + spreadIndex}
      >
        <Tooltip>
          <strong>{character.name}</strong>
          <br />
          {character.role}
        </Tooltip>
      </Marker>
    );
  };

  const mobileGroup = isMobile
    ? markerGroups.find((group) => group.key === expandedGroupKey)
    : undefined;

  return (
    <>
      {(activeLayer === 'events' ||
        activeLayer === 'radiation' ||
        activeLayer === 'habitability') &&
        state.impactZones.map((zone) => (
          <Circle
            key={zone.id}
            center={svgPointToLeaflet(zone.coordinates)}
            radius={Math.max(8, zone.radius)}
            pathOptions={{
              color: zone.kind === 'nuclear_strike' ? '#ffcc45' : '#ff6b4a',
              fillColor: zone.kind === 'nuclear_strike' ? '#d94425' : '#d87938',
              fillOpacity: 0.24 + zone.intensity / 300,
              weight: 2,
              className: styles.strategicImpactZone,
            }}
          >
            <Tooltip>{zone.label}</Tooltip>
          </Circle>
        ))}

      {markerGroups.flatMap((group) => {
        if (group.members.length === 1) {
          const member = group.members[0]!;
          return [renderMarker(member, svgPointToLeaflet(member.coordinates))];
        }

        const groupPosition = map.containerPointToLatLng([group.center.x, group.center.y]);
        const selectedMember = group.members.some(
          (member) => member.kind === 'unit' && member.unit.id === selectedUnitId,
        );
        const spread = (!isMobile && expandedGroupKey === group.key) || selectedMember;
        const clusterIcon = divIcon({
          className: '',
          html: `<span class="${styles.strategicMarkerCluster}" data-marker-cluster data-cluster-count="${group.members.length}" data-expanded="${spread}"><span aria-hidden="true">${group.members.length}</span><span class="${styles.srOnly}">${escapeMarkerText(t('strategic.markerGroups.open', { count: group.members.length }))}</span></span>`,
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        });
        const rendered = [
          <Marker
            key={`cluster-${group.key}`}
            position={groupPosition}
            icon={clusterIcon}
            title={t('strategic.markerGroups.open', { count: group.members.length })}
            eventHandlers={{
              click: () =>
                setExpandedGroupKey((current) => (current === group.key ? undefined : group.key)),
            }}
            zIndexOffset={spread ? 650 : 1_000}
          >
            <Tooltip>{t('strategic.markerGroups.open', { count: group.members.length })}</Tooltip>
          </Marker>,
        ];
        if (spread) {
          const radius = Math.min(78, 52 + group.members.length * 4);
          group.members.forEach((member, index) => {
            const angle = (Math.PI * 2 * index) / group.members.length - Math.PI / 2;
            const position = map.containerPointToLatLng([
              group.center.x + Math.cos(angle) * radius,
              group.center.y + Math.sin(angle) * radius,
            ]);
            rendered.push(renderMarker(member, position, group.key, index + 1));
          });
        }
        return rendered;
      })}

      {(activeLayer === 'forces' || activeLayer === 'supply' || activeLayer === 'fronts') &&
        state.orders
          .filter((order) => order.status === 'queued' || order.status === 'moving')
          .map((order) => {
            const unit = unitById.get(order.unitId);
            if (!unit) return null;
            const points = order.route
              .map((regionId, index) => (index === 0 ? unit.centroid : cityByRegion.get(regionId)))
              .filter((point): point is [number, number] => Boolean(point))
              .map(svgPointToLeaflet);
            if (points.length < 2) return null;
            return (
              <Polyline
                key={order.id}
                positions={points}
                pathOptions={{
                  color:
                    unit.domain === 'air'
                      ? '#80d8ff'
                      : unit.domain === 'naval'
                        ? '#61a8ff'
                        : '#f5c451',
                  weight: 3,
                  opacity: 0.9,
                  dashArray:
                    unit.domain === 'air' ? '3 8' : unit.domain === 'naval' ? '10 6' : '7 5',
                  className: styles.strategicRoute,
                }}
              />
            );
          })}

      {mobileGroup
        ? createPortal(
            <aside
              className={styles.strategicMarkerPicker}
              data-testid="strategic-marker-picker"
              role="dialog"
              aria-label={t('strategic.markerGroups.title')}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <span>{t('strategic.markerGroups.eyebrow')}</span>
                  <strong>{t('strategic.markerGroups.title')}</strong>
                </div>
                <button
                  type="button"
                  aria-label={t('strategic.markerGroups.close')}
                  onClick={() => setExpandedGroupKey(undefined)}
                >
                  <X size={18} />
                </button>
              </header>
              <div>
                {mobileGroup.members.map((member) => (
                  <button
                    type="button"
                    data-marker-choice-kind={member.kind}
                    key={`${member.kind}-${member.id}`}
                    onClick={() => selectEntity(member)}
                  >
                    <small>{t(`strategic.markerGroups.${member.kind}`)}</small>
                    <strong>
                      {member.kind === 'unit' ? member.unit.name : member.character.name}
                    </strong>
                    <span>
                      {member.kind === 'unit'
                        ? `${member.unit.unitType} · ${Math.round(member.unit.strength)}%`
                        : member.character.role}
                    </span>
                  </button>
                ))}
              </div>
            </aside>,
            map.getContainer(),
          )
        : null}
    </>
  );
}

export function StrategicCommandPanel({
  gameId,
  state,
  unitId,
  destinationRegionId,
  onDestinationChange,
  onClose,
}: {
  gameId: string;
  state: StrategicState;
  unitId: string;
  destinationRegionId?: string;
  onDestinationChange: (regionId: string | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const unit = state.units.find((candidate) => candidate.id === unitId);
  const [type, setType] = useState<Exclude<StrategicMission, 'idle'>>('move');
  const [directive, setDirective] = useState('');
  const [preview, setPreview] = useState<MovementOrderPreview>();
  const [draftKey, setDraftKey] = useState(createRequestId);
  const buildInput = (): MovementOrderInput | null =>
    unit && destinationRegionId
      ? {
          unitId: unit.id,
          type,
          destinationRegionId,
          directive,
          idempotencyKey: draftKey,
          expectedWorldRevision: state.worldRevision,
        }
      : null;
  const previewMutation = useMutation({
    mutationFn: async () => {
      const input = buildInput();
      if (!input) throw new Error('ORDER_DESTINATION_REQUIRED');
      return api.previewOrder(gameId, input);
    },
    onSuccess: setPreview,
  });
  const createMutation = useMutation({
    mutationFn: async () => {
      const input = buildInput();
      if (!input) throw new Error('ORDER_DESTINATION_REQUIRED');
      return api.createOrder(gameId, input);
    },
    onSuccess: async () => {
      setPreview(undefined);
      setDraftKey(createRequestId());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['strategic-state', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['timeline', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
      ]);
      onClose();
    },
  });

  if (!unit) return null;
  return (
    <aside className={styles.strategicCommandPanel} aria-label={t('strategic.command.title')}>
      <header>
        <div>
          <p>{t('strategic.command.eyebrow')}</p>
          <h2>{unit.name}</h2>
        </div>
        <button type="button" aria-label={t('common.close')} onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className={styles.strategicUnitReadiness}>
        <span>
          <Activity size={14} /> {Math.round(unit.strength)}%
        </span>
        <span>
          <Factory size={14} /> {Math.round(unit.supply)}%
        </span>
        <span>
          <Radio size={14} /> {Math.round(unit.fuel)}%
        </span>
      </div>
      <label>
        <span>{t('strategic.command.mission')}</span>
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value as Exclude<StrategicMission, 'idle'>);
            setPreview(undefined);
          }}
        >
          {(
            [
              'move',
              'attack',
              'defend',
              'retreat',
              'patrol',
              'intercept',
              'bombard',
              'escort',
              'landing',
              'transport',
            ] as const
          ).map((mission) => (
            <option value={mission} key={mission}>
              {t(`strategic.missions.${mission}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('strategic.command.destination')}</span>
        <select
          value={destinationRegionId ?? ''}
          onChange={(event) => {
            onDestinationChange(event.target.value || undefined);
            setPreview(undefined);
          }}
        >
          <option value="">{t('strategic.command.selectDestination')}</option>
          {state.regions
            .filter(
              (region) =>
                region.regionId !== unit.regionId &&
                (unit.domain === 'air' ||
                  (unit.domain === 'naval'
                    ? region.terrain === 'ocean' || region.terrain === 'coastal'
                    : region.terrain !== 'ocean')),
            )
            .map((region) => (
              <option value={region.regionId} key={region.regionId}>
                {region.regionId.replaceAll('_', ' ')}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>{t('strategic.command.directive')}</span>
        <textarea
          value={directive}
          maxLength={4_000}
          onChange={(event) => {
            setDirective(event.target.value);
            setPreview(undefined);
          }}
          placeholder={t('strategic.command.directivePlaceholder')}
        />
      </label>
      {preview ? (
        <div className={styles.strategicOrderPreview} data-valid={preview.valid}>
          <strong>
            {preview.valid ? t('strategic.command.ready') : t('strategic.command.blocked')}
          </strong>
          <span>{t('strategic.command.duration', { days: preview.durationDays })}</span>
          <span>{t('strategic.command.fuel', { value: Math.round(preview.fuelCost) })}</span>
          <span>{t(`strategic.risk.${preview.supplyRisk}`)}</span>
          {preview.warnings.map((warning) => (
            <small key={warning}>{warning}</small>
          ))}
        </div>
      ) : null}
      <footer>
        <button
          type="button"
          className={styles.button}
          disabled={!destinationRegionId || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? t('common.loading') : t('strategic.command.preview')}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!preview?.valid || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? t('common.loading') : t('strategic.command.confirm')}
        </button>
      </footer>
    </aside>
  );
}
