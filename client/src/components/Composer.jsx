import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { uploadFile } from '../lib/api.js';
import { fileSize } from '../lib/format.js';
import EmojiPicker from './EmojiPicker.jsx';

export default function Composer({
  scopeType, scopeId, channel, server, canSend, reply, onCancelReply, editing, onCancelEdit,
}) {
  const app = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const area = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (editing) {
      setText(editing.content || '');
      area.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    setText('');
    setFiles([]);
    setPicker(false);
  }, [scopeId, scopeType]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!area.current) return;
    area.current.style.height = 'auto';
    area.current.style.height = `${Math.min(area.current.scrollHeight, 200)}px`;
  }, [text]);

  const addFiles = async (event) => {
    const picked = [...(event.target.files || [])];
    event.target.value = '';
    if (!picked.length) return;
    setUploading(true);
    try {
      for (const file of picked) {
        const data = await uploadFile(file);
        const stored = data?.upload || data?.attachment;
        if (stored) {
          const attachment = {
            url: stored.url,
            name: stored.filename || stored.name || file.name,
            size: stored.size ?? file.size,
            mime: stored.mime || file.type,
          };
          setFiles((current) => [...current, { local: file, attachment }]);
        }
      }
    } catch (error) {
      app.toast(error.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event) => {
    event?.preventDefault();
    if (sending || uploading) return;
    const content = text.trim();

    if (editing) {
      if (!content) return;
      setSending(true);
      try {
        await app.editMessage(editing.id, content);
        setText('');
        onCancelEdit?.();
      } catch (error) {
        app.toast(error.message, 'error');
      } finally {
        setSending(false);
      }
      return;
    }

    if (!content && files.length === 0) return;
    if (!canSend) {
      app.toast('Você não tem permissão para enviar mensagens neste canal.', 'error');
      return;
    }

    setSending(true);
    try {
      await app.sendMessage({
        content,
        attachments: files.map((file) => file.attachment),
        replyTo: reply?.id || null,
      });
      setText('');
      setFiles([]);
      onCancelReply?.();
      if (channel?.slowmode > 0) setCooldown(channel.slowmode);
    } catch (error) {
      app.toast(error.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape' && editing) {
      setText('');
      onCancelEdit?.();
      return;
    }
    app.notifyTyping();
  };

  const sendSticker = async (sticker) => {
    setPicker(false);
    try {
      await app.sendMessage({ content: '', attachments: [], stickerId: sticker.id });
    } catch (error) {
      app.toast(error.message, 'error');
    }
  };

  const blocked = cooldown > 0;

  return (
    <div className="composer" style={{ position: 'relative' }}>
      {!canSend && !editing && (
        <p className="composer__warn">Você não tem permissão para enviar mensagens neste canal.</p>
      )}
      <form className="composer__box" onSubmit={submit}>
        {(reply || editing) && (
          <div className="composer__preview">
            <span>
              {editing ? 'Editando mensagem…' : `Respondendo ${reply.author.displayName || reply.author.username}`}
            </span>
            <button
              type="button"
              onClick={() => { if (editing) { setText(''); onCancelEdit?.(); } else onCancelReply?.(); }}
              aria-label="Cancelar"
            >✕</button>
          </div>
        )}

        {files.length > 0 && (
          <div className="composer__files">
            {files.map((file, index) => (
              <span key={`${file.attachment.url}-${index}`} className="composer__file">
                {/^image\//.test(file.attachment.mime || '') && <img src={file.attachment.url} alt={file.attachment.name} />}
                {file.attachment.name} · {fileSize(file.attachment.size)}
                <button
                  type="button" aria-label="Remover anexo"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >✕</button>
              </span>
            ))}
          </div>
        )}

        <div className="composer__row">
          <button
            type="button" className="icon-btn" title="Anexar arquivo"
            onClick={() => input.current?.click()} disabled={uploading}
          >📎</button>
          <input ref={input} type="file" multiple hidden onChange={addFiles} />
          <textarea
            ref={area}
            value={text}
            rows={1}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              editing ? 'Editar mensagem…'
                : blocked ? `Aguarde ${cooldown}s (modo lento)…`
                  : `Enviar mensagem em ${scopeType === 'dm' ? 'conversa' : `#${channel?.name || ''}`}`
            }
            aria-label="Mensagem"
          />
          <button
            type="button" className="icon-btn" title="Emojis e stickers"
            onClick={() => setPicker((value) => !value)}
          >😊</button>
          <button
            type="submit" className="icon-btn" title="Enviar"
            disabled={sending || uploading || blocked || (!text.trim() && files.length === 0)}
            style={{ color: 'var(--accent-2)' }}
          >➤</button>
        </div>
        {uploading && <span className="composer__preview">Enviando arquivo…</span>}
      </form>

      {picker && (
        <EmojiPicker
          serverId={server?.id}
          onPick={(emoji) => { setText((value) => value + emoji); area.current?.focus(); }}
          onSticker={sendSticker}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}
