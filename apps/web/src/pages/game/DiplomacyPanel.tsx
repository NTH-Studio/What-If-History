import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Search, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, Nation } from '@what-if-history/contracts';
import { api } from '../../api';
import { Modal } from '../../components/Dialogs';
import styles from '../../styles/App.module.css';

export function DiplomacyPanel({
  gameId,
  playerNationCode,
  chats,
  nations,
  onClose,
}: {
  gameId: string;
  playerNationCode: string;
  chats: Awaited<ReturnType<typeof api.chats>>;
  nations: Nation[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeChatId, setActiveChatId] = useState<string | undefined>(chats[0]?.id);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [nationQuery, setNationQuery] = useState('');
  const [message, setMessage] = useState('');
  const messages = useQuery({
    queryKey: ['messages', gameId, activeChatId],
    queryFn: () => api.messages(gameId, activeChatId!),
    enabled: Boolean(activeChatId),
  });
  const createMutation = useMutation({
    mutationFn: () => api.createChat(gameId, targets),
    onSuccess: async (chat) => {
      setActiveChatId(chat.id);
      setTargets([]);
      setNewChatOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['chats', gameId] });
    },
  });
  const sendMutation = useMutation({
    mutationFn: (text: string) => api.sendMessage(gameId, activeChatId!, text),
    onSuccess: async () => {
      setMessage('');
      await queryClient.invalidateQueries({ queryKey: ['messages', gameId, activeChatId] });
    },
  });
  const speakerMutation = useMutation({
    mutationFn: (nationCode: string) => api.setChatSpeaker(gameId, activeChatId!, nationCode),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['chats', gameId] }),
  });
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const availableNations = useMemo(() => {
    const query = nationQuery
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase();
    return nations.filter((nation) => {
      if (nation.code === playerNationCode) return false;
      if (!query) return true;
      const searchable = `${nation.name} ${nation.code}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [nationQuery, nations, playerNationCode]);
  useEffect(() => {
    if (!activeChatId && chats[0]) setActiveChatId(chats[0].id);
  }, [activeChatId, chats]);

  return (
    <div className={styles.pageStack}>
      <header className={`${styles.workspaceHeader} ${styles.surfaceHeader}`}>
        <div>
          <p className={styles.eyebrow}>DIPLOMACY · SECURE</p>
          <h1>{t('diplomacy.title')}</h1>
        </div>
        <div className={styles.surfaceHeaderActions}>
          {chats.length ? (
            <button
              className={`${styles.primaryButton} ${styles.compactHeaderAction}`}
              aria-label={t('diplomacy.newChat')}
              title={t('diplomacy.newChat')}
              onClick={() => setNewChatOpen(true)}
            >
              <MessageSquare size={18} />
              <span>{t('diplomacy.newChatShort')}</span>
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
      {chats.length === 0 ? (
        <section className={styles.chatEmptyState}>
          <MessageSquare size={24} />
          <strong>{t('diplomacy.noChats')}</strong>
          <p>{t('diplomacy.emptyHint')}</p>
          <button className={styles.primaryButton} onClick={() => setNewChatOpen(true)}>
            <MessageSquare size={16} />
            {t('diplomacy.newChat')}
          </button>
        </section>
      ) : (
        <div className={styles.chatLayout}>
          <aside className={styles.chatList}>
            {chats.map((chat) => (
              <button
                key={chat.id}
                className={activeChatId === chat.id ? styles.chatActive : undefined}
                onClick={() => setActiveChatId(chat.id)}
              >
                <span>
                  {chat.participants.map((participant) => participant.nationCode).join(' · ')}
                </span>
                <strong>
                  {chat.participants.map((participant) => participant.nationName).join(', ')}
                </strong>
              </button>
            ))}
          </aside>
          <section className={styles.chatWindow}>
            {activeChat ? (
              <header className={styles.chatContext}>
                <div className={styles.participantBadges}>
                  {activeChat.participants.map((participant) => (
                    <span key={participant.nationCode}>{participant.nationCode}</span>
                  ))}
                </div>
                <label>
                  <span>{t('diplomacy.nextSpeaker')}</span>
                  <select
                    value={activeChat.nextSpeakerNationCode ?? ''}
                    onChange={(event) => speakerMutation.mutate(event.target.value)}
                  >
                    {activeChat.participants.map((participant) => (
                      <option key={participant.nationCode} value={participant.nationCode}>
                        {participant.nationName}
                      </option>
                    ))}
                  </select>
                </label>
              </header>
            ) : null}
            <div className={styles.messages} aria-live="polite">
              {messages.data?.map((item) => (
                <MessageBubble
                  key={item.id}
                  message={item}
                  player={item.senderNation === playerNationCode}
                />
              ))}
              {activeChatId && messages.data?.length === 0 ? (
                <p className={styles.muted}>{t('diplomacy.noMessages')}</p>
              ) : null}
            </div>
            {activeChatId ? (
              <form
                className={styles.messageForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  sendMutation.mutate(message);
                }}
              >
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={4_000}
                  placeholder={t('diplomacy.placeholder')}
                  required
                />
                <button className={styles.primaryButton} disabled={sendMutation.isPending}>
                  <Send size={17} />
                  {t('common.send')}
                </button>
              </form>
            ) : null}
          </section>
        </div>
      )}
      <Modal open={newChatOpen} onOpenChange={setNewChatOpen} title={t('diplomacy.newChat')}>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className={styles.selectionSearch}>
            <span>{t('diplomacy.search')}</span>
            <span>
              <Search size={16} />
              <input
                type="search"
                value={nationQuery}
                onChange={(event) => setNationQuery(event.target.value)}
                placeholder={t('diplomacy.searchPlaceholder')}
                autoComplete="off"
              />
            </span>
          </label>
          <fieldset className={styles.selectionGrid}>
            <legend>{t('diplomacy.nations')}</legend>
            {availableNations.map((nation) => (
              <label key={nation.code} data-selected={targets.includes(nation.code)}>
                <input
                  type="checkbox"
                  checked={targets.includes(nation.code)}
                  onChange={() =>
                    setTargets((current) =>
                      current.includes(nation.code)
                        ? current.filter((code) => code !== nation.code)
                        : current.length < 8
                          ? [...current, nation.code]
                          : current,
                    )
                  }
                />
                <span>{nation.name}</span>
                <strong>{nation.code}</strong>
              </label>
            ))}
            {availableNations.length === 0 ? (
              <p className={styles.selectionEmpty}>{t('diplomacy.noNationResults')}</p>
            ) : null}
          </fieldset>
          <footer className={styles.dialogActions}>
            <button
              className={styles.primaryButton}
              disabled={targets.length === 0 || createMutation.isPending}
            >
              {t('diplomacy.open')}
            </button>
          </footer>
        </form>
      </Modal>
    </div>
  );
}

function MessageBubble({ message, player }: { message: ChatMessage; player: boolean }) {
  return (
    <article className={`${styles.messageBubble} ${player ? styles.messagePlayer : ''}`}>
      <header>
        <strong>{message.senderName}</strong>
        <span>{message.leaderName}</span>
      </header>
      <p>{message.messageText}</p>
    </article>
  );
}
