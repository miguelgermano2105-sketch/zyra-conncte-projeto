import React, { useState } from 'react';
import { useApp } from '../store.jsx';
import { fullDate, timeOf } from '../lib/format.js';
import { Avatar } from './ui.jsx';

function renderText(text) {
  const escaped = String(text);
  const nodes = [];
  const pattern = /(https?:\/\/[^\s<]+|@[a-z0-9_.-]{2,24}|#[a-z0-9-]{1,32}|\*\*[^*]+\*\*|`[^`]+`|:[a-z0-9_+-]{2,24}:)/gi;
  let last = 0;
  let match;
  let index = 0;
  while ((match = pattern.exec(escaped)) !== null) {
    if (match.index > last) nodes.push(escaped.slice(last, match.index));
    const token = match[0];
    index += 1;
    if (token.startsWith('http')) {
      nodes.push(<a key={`l${index}`} href={token} target="_blank" rel="noreferrer noopener">{token}</a>);
    } else if (token.startsWith('@')) {
      nodes.push(<span key={`m${index}`} className="mention">{token}</span>);
    } else if (token.startsWith('#')) {
      nodes.push(<span key={`c${index}`} className="mention mention--channel">{token}</span>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`b${index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`k${index}`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<span key={`e${index}`} className="inline-emoji">{token}</span>);
    }
    last = match.index + token.length;
  }
  if (last < escaped.length) nodes.push(escaped.slice(last));
  return nodes;
}

export default function MessageRow({ message, compact, replyMessage, onReply, onEdit, channel, server }) {
  const app = useApp();
  const [hover, setHover] = useState(false);
  const [picker, setPicker] = useState(false);
  const mine = message.author.id === app.user.id;
  const canManage = mine || (server ? ((server.myPermissions & (1 << 7)) || server.isOwner) : false);

  const react = async (emoji) => {
    setPicker(false);
    try { await app.reactTo(message, emoji); } catch (error) { app.toast(error.message, 'error'); }
  };

  const remove = async () => {
    try { await app.deleteMessage(message); } catch (error) { app.toast(error.message, 'error'); }
  };

  const togglePin = async () => {
    try {
      await app.request(`/messages/${message.id}/pin`, { method: 'POST' });
      app.toast(message.pinned ? 'Mensagem desafixada.' : 'Mensagem fixada.', 'success');
    } catch (error) { app.toast(error.message, 'error'); }
  };

  return (
    <article
      className={`msg ${compact ? 'msg--compact' : ''} ${message.system ? 'msg--system' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPicker(false); }}
    >
      {!compact && (
        <Avatar user={message.author} size={40} className="msg__avatar" />
      )}
      <div className="msg__content">
        {!compact && (
          <header className="msg__head">
            <strong className="msg__name">{message.author.displayName || message.author.username}</strong>
            {message.author.isBot && <span className="tag tag--bot">BOT</span>}
            <time className="msg__time" title={fullDate(message.createdAt)}>{timeOf(message.createdAt)}</time>
            {message.pinned && <span className="tag" title="Fixada">📌</span>}
          </header>
        )}

        {replyMessage && (
          <div className="msg__reply">
            <span>↩ {replyMessage.author.displayName}: {replyMessage.content.slice(0, 90)}</span>
          </div>
        )}

        {message.sticker && (
          <div className="msg__sticker">
            {String(message.sticker.url || '').match(/\.(png|jpe?g|webp|gif)$/i)
              ? <img src={message.sticker.url} alt={message.sticker.name || 'sticker'} />
              : <span className="msg__sticker-emoji">{message.sticker.url}</span>}
          </div>
        )}

        {message.content && (
          <p className="msg__text">{renderText(message.content)}</p>
        )}

        {message.attachments?.length > 0 && (
          <div className="msg__attachments">
            {message.attachments.map((file) => {
              const isImage = /^image\//.test(file.mime || '') || /\.(png|jpe?g|gif|webp|avif)$/i.test(file.url);
              const isVideo = /^video\//.test(file.mime || '') || /\.(mp4|webm|mov)$/i.test(file.url);
              const isAudio = /^audio\//.test(file.mime || '') || /\.(mp3|ogg|wav|m4a)$/i.test(file.url);
              return (
                <div key={file.url} className="attach">
                  {isImage && <img src={file.url} alt={file.name} loading="lazy" />}
                  {isVideo && <video src={file.url} controls preload="metadata" />}
                  {isAudio && <audio src={file.url} controls preload="metadata" />}
                  <a href={file.url} target="_blank" rel="noreferrer noopener" className="attach__link">
                    📎 {file.name}
                  </a>
                </div>
              );
            })}
          </div>
        )}

        {message.reactions?.length > 0 && (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={`reaction ${reaction.me ? 'reaction--me' : ''}`}
                onClick={() => react(reaction.emoji)}
                title={`${reaction.count} reação(ões)`}
              >
                <span>{reaction.emoji}</span> {reaction.count}
              </button>
            ))}
          </div>
        )}

        {message.editedAt && <span className="msg__edited">editada</span>}
      </div>

      {hover && (
        <div className="msg__actions">
          {['👍', '🔥', '😂', '❤️'].map((emoji) => (
            <button key={emoji} type="button" title={`Reagir ${emoji}`} onClick={() => react(emoji)}>{emoji}</button>
          ))}
          <button type="button" title="Responder" onClick={onReply}>↩</button>
          {mine && <button type="button" title="Editar" onClick={onEdit}>✎</button>}
          {canManage && <button type="button" title="Fixar" onClick={togglePin}>📌</button>}
          {canManage && <button type="button" title="Excluir" onClick={remove}>🗑</button>}
        </div>
      )}
    </article>
  );
}
