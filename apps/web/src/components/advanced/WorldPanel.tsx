import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, History, MapPin, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameRegion, Nation } from '@what-if-history/contracts';
import { api } from '../../api';
import { ConfirmDialog, Modal } from '../Dialogs';
import { PageHeader, regionTypes } from './shared';
import styles from '../../styles/App.module.css';

export function WorldPanel({ gameId, nations }: { gameId: string; nations: Nation[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const regions = useQuery({
    queryKey: ['game-regions', gameId],
    queryFn: () => api.gameRegions(gameId),
  });
  const features = useQuery({
    queryKey: ['map-features', gameId],
    queryFn: () => api.mapFeatures(gameId),
  });
  const history = useQuery({
    queryKey: ['world-history', gameId],
    queryFn: () => api.worldHistory(gameId),
  });
  const [featureOpen, setFeatureOpen] = useState(false);
  const [deleteFeature, setDeleteFeature] = useState<string>();
  const [regionFilter, setRegionFilter] = useState('');
  const updateRegion = useMutation({
    mutationFn: ({
      regionId,
      input,
    }: {
      regionId: string;
      input: {
        ownerNationCode?: string | null;
        controllerNationCode?: string | null;
        claimNationCodes?: string[];
        regionType?: GameRegion['regionType'];
      };
    }) => api.updateGameRegion(gameId, regionId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['game-regions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['world-history', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['countries', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['country', gameId] }),
      ]);
    },
  });
  const createFeature = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return api.createMapFeature(gameId, {
        name: String(data.get('name')),
        featureType: data.get('featureType') as 'city' | 'capital' | 'battalion' | 'custom',
        nationCode: String(data.get('nationCode')) || null,
        regionId: String(data.get('regionId')),
        coords: [Number(data.get('x')), Number(data.get('y'))],
        symbol: String(data.get('symbol')) || '•',
        color: String(data.get('color')),
      });
    },
    onSuccess: async () => {
      setFeatureOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['map-features', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['world-history', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['countries', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['country', gameId] }),
      ]);
    },
  });
  const removeFeature = useMutation({
    mutationFn: (id: string) => api.deleteMapFeature(gameId, id),
    onSuccess: async () => {
      setDeleteFeature(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['map-features', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['world-history', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['countries', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['country', gameId] }),
      ]);
    },
  });
  const nationNames = useMemo(
    () => new Map(nations.map((nation) => [nation.code, nation.name])),
    [nations],
  );
  const displayedRegions = useMemo(() => {
    const needle = regionFilter.trim().toLocaleLowerCase();
    if (!needle) return regions.data ?? [];
    return (regions.data ?? []).filter((region) =>
      [
        region.name,
        region.regionId,
        region.ownerNationCode,
        region.controllerNationCode,
        ...region.claimNationCodes,
      ].some((value) => value?.toLocaleLowerCase().includes(needle)),
    );
  }, [regionFilter, regions.data]);

  return (
    <div className={styles.pageStack}>
      <PageHeader
        eyebrow="WORLD · EDITOR"
        title={t('world.title')}
        description={t('world.description')}
        action={
          <button className={styles.primaryButton} onClick={() => setFeatureOpen(true)}>
            <Plus size={17} />
            {t('world.addFeature')}
          </button>
        }
      />
      <div className={styles.worldSummary}>
        <article>
          <MapPin size={19} />
          <strong>{features.data?.length ?? 0}</strong>
          <span>{t('world.features')}</span>
        </article>
        <article>
          <Flag size={19} />
          <strong>{regions.data?.length ?? 0}</strong>
          <span>{t('world.regions')}</span>
        </article>
        <article>
          <History size={19} />
          <strong>{history.data?.length ?? 0}</strong>
          <span>{t('world.mutations')}</span>
        </article>
      </div>
      <section className={styles.panel}>
        <div className={styles.subsectionTitle}>
          <Flag size={18} />
          <h2>{t('world.regions')}</h2>
        </div>
        <label>
          <span>{t('world.filter')}</span>
          <input
            value={regionFilter}
            onChange={(event) => setRegionFilter(event.target.value)}
            placeholder={t('world.filterPlaceholder')}
          />
        </label>
        <div className={`${styles.dataTable} ${styles.worldRegionTable}`}>
          <div className={styles.dataTableHead}>
            <span>{t('world.region')}</span>
            <span>{t('world.owner')}</span>
            <span>{t('world.controller')}</span>
            <span>{t('world.claims')}</span>
            <span>{t('world.type')}</span>
          </div>
          {displayedRegions.map((region) => (
            <div key={region.regionId}>
              <strong>{region.name}</strong>
              <select
                value={region.ownerNationCode ?? ''}
                aria-label={`${t('world.owner')}: ${region.name}`}
                onChange={(event) =>
                  updateRegion.mutate({
                    regionId: region.regionId,
                    input: { ownerNationCode: event.target.value || null },
                  })
                }
              >
                <option value="">—</option>
                {nations.map((nation) => (
                  <option key={nation.code} value={nation.code}>
                    {nation.name}
                  </option>
                ))}
              </select>
              <select
                value={region.controllerNationCode ?? ''}
                aria-label={`${t('world.controller')}: ${region.name}`}
                onChange={(event) =>
                  updateRegion.mutate({
                    regionId: region.regionId,
                    input: { controllerNationCode: event.target.value || null },
                  })
                }
              >
                <option value="">—</option>
                {nations.map((nation) => (
                  <option key={nation.code} value={nation.code}>
                    {nation.name}
                  </option>
                ))}
              </select>
              <input
                key={region.claimNationCodes.join(',')}
                defaultValue={region.claimNationCodes.join(', ')}
                aria-label={`${t('world.claims')}: ${region.name}`}
                onBlur={(event) =>
                  updateRegion.mutate({
                    regionId: region.regionId,
                    input: {
                      claimNationCodes: event.target.value
                        .split(',')
                        .map((value) => value.trim().toUpperCase())
                        .filter(Boolean),
                    },
                  })
                }
              />
              <select
                value={region.regionType}
                aria-label={`${t('world.type')}: ${region.name}`}
                onChange={(event) =>
                  updateRegion.mutate({
                    regionId: region.regionId,
                    input: { regionType: event.target.value as GameRegion['regionType'] },
                  })
                }
              >
                {regionTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`world.regionTypes.${type}`)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.subsectionTitle}>
          <MapPin size={18} />
          <h2>{t('world.features')}</h2>
        </div>
        <div className={styles.featureGrid}>
          {features.data?.map((feature) => (
            <article key={feature.id}>
              <span style={{ color: feature.color }}>{feature.symbol}</span>
              <div>
                <strong>{feature.name}</strong>
                <small>
                  {t(`world.featureTypes.${feature.featureType}`)}
                  {feature.nationCode
                    ? ` · ${nationNames.get(feature.nationCode) ?? feature.nationCode}`
                    : ''}
                </small>
              </div>
              <button
                className={styles.iconButton}
                aria-label={t('common.delete')}
                onClick={() => setDeleteFeature(feature.id)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <Modal
        open={featureOpen}
        onOpenChange={setFeatureOpen}
        title={t('world.addFeature')}
        description={t('world.addFeatureDescription')}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            createFeature.mutate(event.currentTarget);
          }}
        >
          <label>
            <span>{t('world.name')}</span>
            <input name="name" maxLength={120} required autoFocus />
          </label>
          <div className={styles.formRow}>
            <label>
              <span>{t('world.type')}</span>
              <select name="featureType" defaultValue="custom">
                {(['city', 'capital', 'battalion', 'custom'] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`world.featureTypes.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('world.nation')}</span>
              <select name="nationCode" defaultValue="">
                <option value="">—</option>
                {nations.map((nation) => (
                  <option key={nation.code} value={nation.code}>
                    {nation.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>{t('world.region')}</span>
            <select name="regionId" defaultValue="" required>
              <option value="">—</option>
              {regions.data?.map((region) => (
                <option key={region.regionId} value={region.regionId}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.formRow}>
            <label>
              <span>X</span>
              <input name="x" type="number" min={0} max={1440} defaultValue={720} required />
            </label>
            <label>
              <span>Y</span>
              <input name="y" type="number" min={0} max={650} defaultValue={325} required />
            </label>
            <label>
              <span>{t('world.symbol')}</span>
              <input name="symbol" defaultValue="◆" maxLength={8} required />
            </label>
            <label>
              <span>{t('world.color')}</span>
              <input name="color" type="color" defaultValue="#f0c56a" required />
            </label>
          </div>
          <footer className={styles.dialogActions}>
            <button className={styles.primaryButton} disabled={createFeature.isPending}>
              {t('common.create')}
            </button>
          </footer>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteFeature)}
        onOpenChange={(open) => !open && setDeleteFeature(undefined)}
        title={t('world.deleteFeatureTitle')}
        description={t('world.deleteFeatureDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteFeature) await removeFeature.mutateAsync(deleteFeature);
        }}
      />
    </div>
  );
}
