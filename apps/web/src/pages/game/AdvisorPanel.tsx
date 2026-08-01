import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { api } from '../../api';
import { ConfirmDialog } from '../../components/Dialogs';
import type { MapSelection } from '../../components/MapView';
import styles from '../../styles/App.module.css';

export function AdvisorPanel({
  gameId,
  mapSelection,
  onClose,
}: {
  gameId: string;
  mapSelection?: MapSelection;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const messages = useQuery({
    queryKey: ['advisor-messages', gameId],
    queryFn: () => api.advisorMessages(gameId),
  });
  const mutation = useMutation({
    mutationFn: (prompt: string) => api.advisor(gameId, prompt),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ['advisor-messages', gameId] }),
  });
  const clearMutation = useMutation({
    mutationFn: () => api.clearAdvisor(gameId),
    onSuccess: async () => {
      setClearOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['advisor-messages', gameId] });
    },
  });
  const promptKeys = ['priorities', 'risks', 'diplomacy', 'economy'] as const;
  return (
    <div className={styles.pageStack}>
      <header className={`${styles.workspaceHeader} ${styles.surfaceHeader}`}>
        <div>
          <p className={styles.eyebrow}>ADVISOR · ANALYSIS</p>
          <h1>{t('advisor.title')}</h1>
          <p>{t('advisor.description')}</p>
        </div>
        <div className={styles.surfaceHeaderActions}>
          {messages.data?.length ? (
            <button className={styles.button} onClick={() => setClearOpen(true)}>
              <Trash2 size={16} />
              {t('advisor.clear')}
            </button>
          ) : null}
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
      <section
        className={styles.advisorConsole}
        data-empty={!messages.isLoading && messages.data?.length === 0}
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
                setQuestion(
                  t('advisor.mapQuestion', {
                    name: mapSelection.name,
                    nation: mapSelection.nationCode,
                  }),
                )
              }
            >
              {t('map.askAdvisor')}
            </button>
          </div>
        ) : null}
        <div className={styles.messages} aria-live="polite">
          {messages.data?.map((message) => (
            <article
              className={`${styles.advisorMessage} ${
                message.role === 'user' ? styles.messagePlayer : ''
              }`}
              key={message.id}
            >
              {message.role === 'advisor' ? (
                <ReactMarkdown>{message.messageText}</ReactMarkdown>
              ) : (
                <p>{message.messageText}</p>
              )}
            </article>
          ))}
          {!messages.isLoading && messages.data?.length === 0 ? (
            <>
              <p className={styles.muted}>{t('advisor.empty')}</p>
              <div className={styles.promptChips}>
                {promptKeys.map((key) => (
                  <button key={key} type="button" onClick={() => setQuestion(t(`advisor.${key}`))}>
                    {t(`advisor.${key}`)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <form
          className={styles.messageForm}
          onSubmit={(event) => {
            event.preventDefault();
            const sent = question;
            mutation.mutate(sent);
            setQuestion('');
          }}
        >
          <textarea
            maxLength={4_000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('advisor.placeholder')}
            required
          />
          <button
            className={styles.primaryButton}
            aria-label={t('advisor.ask')}
            title={t('advisor.ask')}
            disabled={mutation.isPending}
          >
            <Sparkles size={17} />
            {t('advisor.askShort')}
          </button>
        </form>
      </section>
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t('advisor.clearTitle')}
        description={t('advisor.clearDescription')}
        confirmLabel={t('advisor.clear')}
        onConfirm={async () => clearMutation.mutateAsync()}
      />
    </div>
  );
}
