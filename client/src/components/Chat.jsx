import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { groupMessages, timeOf } from '../lib/format.js';
import MessageRow from './MessageRow.jsx';
import Composer from './Composer.jsx';
import { Empty, Spinner } from './ui.jsx';

export default function Chat({ scopeType, scopeId, channel, dm, server, header }) {
  const app = useApp();
  const key = `${scopeType}:${scopeId}`;
  const bucket = app.messages[key];
  const [loading, setLoading] = useState(!bucket);
  const [reply, setReply] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scroller = useRef(null);
  const bottom = useRef(null);
  const stick = useRef(true);

  useEffect(() => {
    let alive = true;
    if (!app.messages[key]) {
      setLoading(true);
      app.loadMessages(scopeType, scopeId)
        .catch((error) => app.toast(error.message, 'error'))
        .finally(() => { if (alive) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeType, scopeId]);

  const items = bucket?.items || [];

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [items.length, scopeId]);

  const onScroll = async (event) => {
    const el = event.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80 && bucket?.hasMore && !loadingMore && items.length) {
      setLoadingMore(true);
      const before = items[0].id;
      const previousHeight = el.scrollHeight;
      try {
        await app.loadMessages(scopeType, scopeId, { before });
        requestAnimationFrame(() => {
          if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight - previousHeight;
        });
      } catch (error) {
        app.toast(error.message, 'error');
      } finally {
        setLoadingMore(false);
      }
    }
  };

  const groups = useMemo(() => groupMessages(items), [items]);
  const typingUsers = (app.typing[key] || []).filter((name) => name !== app.user.username);
  const canSend = scopeType === 'dm' ? true : (channel?.canSend ?? true);

  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
        <div className="chat__intro">
          <div className="chat__intro-icon">{scopeType === 'dm' ? (dm?.type === 'group' ? '◍' : '@') : '#'}</div>
          <h2>{scopeType === 'dm' ? header.title : `Bem-vindo a #${channel?.name}`}</h2>
          <p>
            {scopeType === 'dm'
              ? (dm?.type === 'group' ? `Grupo com ${dm.members.length} participantes.` : 'Este é o início da conversa.')
              : (channel?.topic || `Este é o começo do canal #${channel?.name}.`)}
          </p>
          {scopeType === 'channel' && channel?.slowmode > 0 && (
            <p className="chat__slowmode">Modo lento ativo: 1 mensagem a cada {channel.slowmode}s.</p>
          )}
        </div>

        {loading && <Spinner label="Carregando mensagens" />}
        {loadingMore && <Spinner label="Buscando anteriores" />}
        {!loading && items.length === 0 && (
          <Empty title="Nenhuma mensagem ainda">Envie a primeira mensagem para começar.</Empty>
        )}

        {groups.map((group) => {
          if (group.kind === 'day') return <div key={group.key} className="day"><span>{group.label}</span></div>;
          return (
            <div key={group.key} className="msg-group">
              {group.items.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  compact={index > 0}
                  replyMessage={message.replyTo ? byId.get(message.replyTo) : null}
                  onReply={() => setReply(message)}
                  onEdit={() => setEditing(message)}
                  channel={channel}
                  server={server}
                />
              ))}
            </div>
          );
        })}
        <div ref={bottom} className="chat__bottom" />
      </div>

      {typingUsers.length > 0 && (
        <div className="typing">
          <i className="typing__dots"><b /><b /><b /></i>
          {typingUsers.length === 1
            ? `${typingUsers[0]} está digitando…`
            : `${typingUsers.slice(0, 3).join(', ')} estão digitando…`}
        </div>
      )}

      <Composer
        scopeType={scopeType}
        scopeId={scopeId}
        channel={channel}
        server={server}
        canSend={canSend}
        reply={reply}
        onCancelReply={() => setReply(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
      />
    </div>
  );
}
