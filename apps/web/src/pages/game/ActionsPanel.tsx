import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Pencil,
  ScrollText,
  Send,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import type { Action, ActionPreview } from '@what-if-history/contracts';
import { api, ApiError } from '../../api';
import { ConfirmDialog, Modal } from '../../components/Dialogs';
import type { MapSelection } from '../../components/MapView';
import { Panel } from './Dashboard';
import styles from '../../styles/App.module.css';

export function ActionsPanel({
  gameId,
  actions,
  mapSelection,
  onClose,
}: {
  gameId: string;
  actions: Action[];
  mapSelection?: MapSelection;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [type, setType] = useState<Action['actionType']>('general');
  const [suggestions, setSuggestions] = useState('');
  const [deleteId, setDeleteId] = useState<string>();
  const [editAction, setEditAction] = useState<Action>();
  const [lawConfirmationOpen, setLawConfirmationOpen] = useState(false);
  const [preview, setPreview] = useState<ActionPreview>();
  const [previewContext, setPreviewContext] = useState<{
    regionId?: string;
    nationCode?: string;
  }>({});
  const createMutation = useMutation({
    mutationFn: (confirmed: ActionPreview) =>
      api.createAction(gameId, {
        actionText: text,
        actionType: type,
        effects: confirmed.effects,
        previewWorldRevision: confirmed.worldRevision,
      }),
    onSuccess: async () => {
      setText('');
      setPreview(undefined);
      setPreviewContext({});
      await queryClient.invalidateQueries({ queryKey: ['actions', gameId] });
    },
  });
  const previewMutation = useMutation({
    mutationFn: ({
      actionType,
      context,
    }: {
      actionType: Action['actionType'];
      context: { regionId?: string; nationCode?: string };
    }) =>
      api.previewAction(gameId, {
        actionText: text,
        actionType,
        context: {
          ...(mapSelection?.regionId ? { regionId: mapSelection.regionId } : {}),
          ...context,
        },
      }),
    onSuccess: setPreview,
  });
  const previewFor = async (actionType: Action['actionType'], context = previewContext) => {
    const result = await previewMutation.mutateAsync({ actionType, context });
    setPreviewContext(context);
    return result;
  };
  const brainstormMutation = useMutation({
    mutationFn: () => api.brainstorm(gameId),
    onSuccess: (result) => setSuggestions(result.suggestions),
  });
  const enhanceMutation = useMutation({
    mutationFn: () => api.enhanceAction(gameId, text),
    onSuccess: (result) => {
      setText(result.actionText);
      setPreview(undefined);
    },
  });
  const updateMutation = useMutation({
    mutationFn: async (input: { actionText: string; actionType: Action['actionType'] }) => {
      const resolved = await api.previewAction(gameId, input);
      if (resolved.ambiguities.length) throw new Error(t('actions.ambiguity'));
      return api.updateAction(gameId, editAction!.id, {
        ...input,
        effects: resolved.effects,
        previewWorldRevision: resolved.worldRevision,
      });
    },
    onSuccess: async () => {
      setEditAction(undefined);
      await queryClient.invalidateQueries({ queryKey: ['actions', gameId] });
    },
  });
  const lawMutation = useMutation({
    mutationFn: (confirmed: ActionPreview) =>
      api.promulgateLaw(gameId, {
        actionText: text,
        effects: confirmed.effects,
        previewWorldRevision: confirmed.worldRevision,
      }),
    onSuccess: async () => {
      setText('');
      setPreview(undefined);
      setPreviewContext({});
      setLawConfirmationOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['actions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['countries', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['country', gameId] }),
      ]);
    },
  });
  const suggestionItems = suggestions
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((item) => item.length > 12);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAction(gameId, id),
    onSuccess: async () => {
      setDeleteId(undefined);
      await queryClient.invalidateQueries({ queryKey: ['actions', gameId] });
    },
  });
  return (
    <div className={styles.pageStack}>
      <header className={`${styles.workspaceHeader} ${styles.surfaceHeader}`}>
        <div>
          <p className={styles.eyebrow}>ORDERS · QUEUE</p>
          <h1>{t('actions.title')}</h1>
          <p>{t('actions.description')}</p>
        </div>
        <div className={styles.surfaceHeaderActions}>
          <button
            className={`${styles.button} ${styles.compactHeaderAction}`}
            aria-label={t('actions.brainstorm')}
            title={t('actions.brainstorm')}
            onClick={() => brainstormMutation.mutate()}
          >
            <Sparkles size={18} />
            <span>{t('actions.brainstormShort')}</span>
          </button>
          <button
            type="button"
            className={styles.surfaceClose}
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <form
        className={styles.commandForm}
        onSubmit={(event) => {
          event.preventDefault();
          void previewFor(type).then((confirmed) => {
            if (!confirmed.ambiguities.length) createMutation.mutate(confirmed);
          });
        }}
      >
        {mapSelection ? (
          <div className={styles.mapContextCard}>
            <MapPin size={18} aria-hidden="true" />
            <span>
              <strong>{mapSelection.name}</strong>
              {t('map.selectionContext', {
                nation: mapSelection.nationCode,
                detail: mapSelection.detail,
              })}
            </span>
            <button
              type="button"
              onClick={() =>
                setText((current) => {
                  const context = t('actions.mapContext', {
                    name: mapSelection.name,
                    nation: mapSelection.nationCode,
                  });
                  return current ? `${current}\n\n${context}` : context;
                })
              }
            >
              {t('map.useForAction')}
            </button>
          </div>
        ) : null}
        <textarea
          data-action-composer
          maxLength={4_000}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(undefined);
            setPreviewContext({});
          }}
          placeholder={t('actions.placeholder')}
          required
        />
        <div className={styles.commandFooter}>
          <label className={styles.commandTypeField}>
            <span>{t('actions.type')}</span>
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as Action['actionType']);
                setPreview(undefined);
              }}
            >
              {(['general', 'military', 'diplomatic', 'economic'] as const).map((value) => (
                <option value={value} key={value}>
                  {t(`actions.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.commandActions} data-testid="action-buttons">
            <button
              type="button"
              className={styles.button}
              disabled={!text.trim() || previewMutation.isPending}
              onClick={() => void previewFor(type)}
            >
              <Search size={17} />
              <span>{t('actions.preview')}</span>
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label={t('actions.enhance')}
              title={t('actions.enhance')}
              disabled={!text.trim() || enhanceMutation.isPending}
              onClick={() => enhanceMutation.mutate()}
            >
              <WandSparkles size={17} />
              <span>{t('actions.enhanceShort')}</span>
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.lawButton}`}
              aria-label={t('actions.promulgate')}
              title={t('actions.promulgate')}
              disabled={!text.trim() || lawMutation.isPending || createMutation.isPending}
              onClick={() => {
                void previewFor('law').then((confirmed) => {
                  if (!confirmed.ambiguities.length) setLawConfirmationOpen(true);
                });
              }}
            >
              <ScrollText size={17} />
              <span>{t('actions.promulgateShort')}</span>
            </button>
            <button
              className={styles.primaryButton}
              aria-label={t('actions.submit')}
              title={t('actions.submit')}
              disabled={!text.trim() || createMutation.isPending || lawMutation.isPending}
            >
              <Send size={17} />
              <span>{t('actions.submitShort')}</span>
            </button>
          </div>
        </div>
      </form>
      {createMutation.isError || previewMutation.isError || lawMutation.isError ? (
        <p role="alert" className={styles.errorMessage}>
          {(() => {
            const error =
              createMutation.error ?? previewMutation.error ?? lawMutation.error ?? undefined;
            return error instanceof ApiError ? error.problem.detail : t('common.error');
          })()}
        </p>
      ) : null}
      {preview ? (
        <section className={styles.actionPreview} aria-live="polite">
          <strong>{t('actions.understoodEffects')}</strong>
          {preview.effects.length ? (
            <ul>
              {preview.effects.map((effect, index) => (
                <li key={`${effect.kind}-${index}`}>
                  {effect.kind === 'territory'
                    ? t('actions.effectTerritory', {
                        operation: t(`actions.operations.${effect.operation}`),
                        region: effect.regionId,
                        nation: effect.nationCode,
                      })
                    : `${effect.kind} · ${effect.operation}`}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('actions.noGuaranteedEffect')}</p>
          )}
          {preview.warnings.map((warning) => (
            <small key={warning}>{warning}</small>
          ))}
          {preview.ambiguities.length ? (
            <div role="alert">
              <p>{t('actions.ambiguity')}</p>
              {preview.ambiguities.map((ambiguity) => (
                <div className={styles.previewCandidates} key={ambiguity.field}>
                  {ambiguity.candidates.map((candidate) => (
                    <button
                      type="button"
                      key={candidate.id}
                      onClick={() => {
                        const context = {
                          ...previewContext,
                          ...(ambiguity.field === 'region'
                            ? { regionId: candidate.id }
                            : ambiguity.field === 'nation'
                              ? { nationCode: candidate.id }
                              : {}),
                        };
                        void previewFor(preview.actionType as Action['actionType'], context);
                      }}
                    >
                      {candidate.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          <small>
            Monde r{'\u00e9'}v. {preview.worldRevision}
          </small>
        </section>
      ) : null}
      {suggestions ? (
        <Panel title={t('actions.suggestions')} icon={<Sparkles size={18} />}>
          <div className={styles.suggestionGrid}>
            {suggestionItems.length > 0 ? (
              suggestionItems.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setText(suggestion);
                    globalThis.document
                      .querySelector<HTMLTextAreaElement>('[data-action-composer]')
                      ?.focus();
                  }}
                >
                  <Sparkles size={15} />
                  <span>{suggestion}</span>
                </button>
              ))
            ) : (
              <ReactMarkdown>{suggestions}</ReactMarkdown>
            )}
          </div>
        </Panel>
      ) : null}
      <div className={styles.listCards}>
        {actions.map((action) => (
          <article key={action.id}>
            <header>
              <span>
                {t(
                  `actions.${
                    action.actionType === 'law'
                      ? action.status === 'pending'
                        ? 'enacted'
                        : 'enactedProcessed'
                      : action.status
                  }`,
                )}
              </span>
              <span>{t(`actions.${action.actionType}`)}</span>
            </header>
            <p>{action.actionText}</p>
            {action.effects.length ? (
              <ul className={styles.actionEffectList}>
                {action.effects.map((effect, index) => (
                  <li key={`${effect.kind}-${index}`}>
                    {effect.kind === 'territory'
                      ? t('actions.effectTerritory', {
                          operation: t(`actions.operations.${effect.operation}`),
                          region: effect.regionId,
                          nation: effect.nationCode,
                        })
                      : `${effect.kind} · ${effect.operation}`}
                  </li>
                ))}
              </ul>
            ) : (
              <small>{t('actions.noGuaranteedEffect')}</small>
            )}
            {action.aiResponse ? <small>{action.aiResponse}</small> : null}
            {action.status === 'pending' && action.actionType !== 'law' ? (
              <footer className={styles.cardActions}>
                <button className={styles.button} onClick={() => setEditAction(action)}>
                  <Pencil size={15} />
                  {t('common.edit')}
                </button>
                <button className={styles.textDanger} onClick={() => setDeleteId(action.id)}>
                  <Trash2 size={15} />
                  {t('common.delete')}
                </button>
              </footer>
            ) : null}
          </article>
        ))}
      </div>
      <ConfirmDialog
        open={lawConfirmationOpen}
        onOpenChange={setLawConfirmationOpen}
        title={t('actions.promulgateTitle')}
        description={t('actions.promulgateDescription')}
        confirmLabel={t('actions.promulgateConfirm')}
        onConfirm={async () => {
          const confirmed =
            preview?.actionType === 'law' && preview.actionText === text
              ? preview
              : await previewFor('law');
          if (!confirmed.ambiguities.length) await lawMutation.mutateAsync(confirmed);
        }}
      />
      <Modal
        open={Boolean(editAction)}
        onOpenChange={(open) => !open && setEditAction(undefined)}
        title={t('actions.editTitle')}
        description={t('actions.editDescription')}
      >
        {editAction ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              updateMutation.mutate({
                actionText: String(data.get('actionText')),
                actionType: data.get('actionType') as Action['actionType'],
              });
            }}
          >
            <label>
              <span>{t('actions.type')}</span>
              <select name="actionType" defaultValue={editAction.actionType}>
                {(['general', 'military', 'diplomatic', 'economic'] as const).map((value) => (
                  <option value={value} key={value}>
                    {t(`actions.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('actions.order')}</span>
              <textarea
                name="actionText"
                defaultValue={editAction.actionText}
                maxLength={4_000}
                rows={8}
                required
              />
            </label>
            <footer className={styles.dialogActions}>
              <button className={styles.primaryButton}>{t('common.save')}</button>
            </footer>
          </form>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(undefined)}
        title={t('common.delete')}
        description={t('home.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteId) await deleteMutation.mutateAsync(deleteId);
        }}
      />
    </div>
  );
}
