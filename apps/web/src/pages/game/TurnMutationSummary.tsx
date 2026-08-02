import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppliedMutation } from '@what-if-history/contracts';
import { formatCalendarDate, isIsoCalendarDate } from '../../dateFormatting';
import styles from '../../styles/App.module.css';

export function TurnMutationSummary({
  mutations,
  onFocus,
}: {
  mutations: AppliedMutation[];
  onFocus: (mutation: AppliedMutation) => void;
}) {
  const { t } = useTranslation();
  const groups = [
    {
      key: 'decisions',
      title: t('turnSummary.decisions'),
      items: mutations.filter((mutation) => mutation.source === 'player_action'),
    },
    {
      key: 'consequences',
      title: t('turnSummary.consequences'),
      items: mutations.filter((mutation) => mutation.source !== 'player_action'),
    },
  ].filter((group) => group.items.length);
  return (
    <div className={styles.turnMutationSummary}>
      {groups.map((group) => (
        <section key={group.key}>
          <h3>{group.title}</h3>
          {group.items.map((mutation) => (
            <div className={styles.mutationCard} key={mutation.id}>
              <div>
                <strong>
                  {t(`turnSummary.types.${mutation.mutationType}`)} ·{' '}
                  {mutationTargetLabel(mutation, t)}
                </strong>
                <MutationDelta mutation={mutation} />
              </div>
              {mutation.mutationType === 'region' ? (
                <button className={styles.button} onClick={() => onFocus(mutation)}>
                  <MapPin size={15} />
                  {t('events.showOnMap')}
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function MutationDelta({ mutation }: { mutation: AppliedMutation }) {
  const { i18n, t } = useTranslation();
  const before = mutation.beforeValue as Record<string, unknown> | null;
  const after = mutation.afterValue as Record<string, unknown> | null;
  const hiddenKeys = new Set([
    'id',
    'gameId',
    'game_id',
    'createdAt',
    'updatedAt',
    'updated_at',
    'centroid',
    'coordinates',
    'capitalFeatureId',
    'capital_feature_id',
  ]);
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((key) => !hiddenKeys.has(key))
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .slice(0, 6);
  if (!keys.length) return null;
  return (
    <dl className={styles.mutationDelta}>
      {keys.map((key) => (
        <div key={key}>
          <dt>
            {t(`turnSummary.fields.${key}`, {
              defaultValue: humanizeIdentifier(key),
            })}
          </dt>
          <dd>
            {formatMutationValue(before?.[key], i18n.language, t)} →{' '}
            {formatMutationValue(after?.[key], i18n.language, t)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function mutationTargetLabel(mutation: AppliedMutation, t: ReturnType<typeof useTranslation>['t']) {
  const before = mutation.beforeValue as Record<string, unknown> | null;
  const after = mutation.afterValue as Record<string, unknown> | null;
  const namedValue = after?.name ?? before?.name ?? after?.title ?? before?.title;
  if (typeof namedValue === 'string' && namedValue.trim()) return namedValue;
  if (mutation.mutationType === 'unit') return t('turnSummary.genericUnit');
  return humanizeIdentifier(mutation.targetId);
}

function humanizeIdentifier(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatMutationValue(
  value: unknown,
  locale: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === 'boolean') return value ? '✓' : '—';
  if (Array.isArray(value)) {
    return value.map((item) => formatMutationValue(item, locale, t)).join(' · ');
  }
  if (typeof value === 'string') {
    if (isIsoCalendarDate(value)) return formatCalendarDate(value, locale, 'medium');
    return t(`turnSummary.values.${value}`, { defaultValue: humanizeIdentifier(value) });
  }
  return '…';
}
