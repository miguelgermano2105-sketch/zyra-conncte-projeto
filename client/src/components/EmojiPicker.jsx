import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { uploadFile } from '../lib/api.js';
import { fileSize } from '../lib/format.js';

const QUICK = ['😀', '😂', '🥰', '😎', '🤔', '😭', '😡', '🥳', '👍', '👎', '🔥', '💜', '✨', '🎉', '🚀', '👀', '✅', '❌', '🙏', '💡', '🕹️', '🎧', '📌', '⚡'];
const GROUPS = {
  Rostos: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮', '😲', '😴', '🤤', '😪', '😵', '🤯', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '😱', '😨', '😰', '😥', '😓'],
  Gestos: ['👍', '👎', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '💪', '🫶', '👏', '🙌', '🫰', '🤝'],
  Objetos: ['🔥', '💜', '💙', '💚', '❤️', '🧡', '💛', '✨', '⭐', '🌟', '💫', '⚡', '🎉', '🎊', '🎁', '🎧', '🎮', '🕹️', '💻', '📱', '📌', '📎', '🔗', '🔔', '🔕', '💡', '🚀', '🛰️', '🏆', '🥇', '🎯', '🧩', '🛡️', '⚙️', '🔒', '🔑', '📊', '📈', '✅', '❌', '⏱️', '🎵', '🎤', '📷', '🖥️'],
};

export default function EmojiPicker({ serverId, onPick, onSticker, onClose }) {
  const app = useApp();
  const [tab, setTab] = useState('Rostos');
  const [custom, setCustom] = useState({ emojis: [], stickers: [] });

  useEffect(() => {
    if (!serverId) return;
    app.request(`/servers/${serverId}/emojis`)
      .then((data) => {
        if (!data) return;
        setCustom({ emojis: data.emojis || [], stickers: data.stickers || [] });
      })
      .catch(() => {});
  }, [serverId, app]);

  return (
    <div className="picker" role="dialog" aria-label="Emojis e stickers">
      <div className="picker__tabs">
        {[...Object.keys(GROUPS), 'Servidor', 'Stickers'].map((name) => (
          <button
            key={name} type="button" className={tab === name ? 'is-active' : ''}
            onClick={() => setTab(name)}
          >{name}</button>
        ))}
        <button type="button" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</button>
      </div>

      {GROUPS[tab] && (
        <div className="picker__grid">
          {GROUPS[tab].map((emoji) => (
            <button key={emoji} type="button" onClick={() => onPick(emoji)}>{emoji}</button>
          ))}
        </div>
      )}

      {tab === 'Servidor' && (
        custom.emojis.length === 0
          ? <p className="picker__empty">Nenhum emoji personalizado. Envie emojis em Configurações do servidor.</p>
          : (
            <div className="picker__grid">
              {custom.emojis.map((emoji) => (
                <button key={emoji.id} type="button" title={`:${emoji.name}:`} onClick={() => onPick(`:${emoji.name}:`)}>
                  <img src={emoji.url} alt={emoji.name} />
                </button>
              ))}
            </div>
          )
      )}

      {tab === 'Stickers' && (
        custom.stickers.length === 0
          ? <p className="picker__empty">Nenhum sticker disponível. Adicione stickers em Configurações do servidor.</p>
          : (
            <div className="picker__grid">
              {custom.stickers.map((sticker) => (
                <button key={sticker.id} type="button" title={sticker.name} onClick={() => onSticker(sticker)}>
                  {/^https?:/.test(sticker.url) ? <img src={sticker.url} alt={sticker.name} /> : <span>{sticker.url}</span>}
                </button>
              ))}
            </div>
          )
      )}
    </div>
  );
}

export { QUICK };
