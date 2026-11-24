import React, { useEffect } from 'react';
import { colorFor, initials, STATUS_LABEL } from '../lib/format.js';

export function Avatar({ user, size = 40, status, className = '' }) {
  const name = user?.displayName || user?.username || '?';
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return (
    <span className={`avatar ${className}`} style={style}>
      {user?.avatarUrl
        ? <img src={user.avatarUrl} alt="" loading="lazy" />
        : <span className="avatar__initials" style={{ background: colorFor(user?.id || name) }}>{initials(name)}</span>}
      {status && <i className={`status-dot status-dot--${status}`} title={STATUS_LABEL[status] || status} />}
    </span>
  );
}

export function ServerIcon({ server, size = 48 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.32) };
  return (
    <span className="server-icon" style={style}>
      {server?.iconUrl
        ? <img src={server.iconUrl} alt="" loading="lazy" />
        : <span className="server-icon__initials" style={{ background: colorFor(server?.id || server?.name) }}>{initials(server?.name || '?')}</span>}
    </span>
  );
}

export function Modal({ title, subtitle, children, footer, onClose, wide }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal__backdrop" aria-label="Fechar" onClick={onClose} />
      <div className={`modal__card ${wide ? 'modal__card--wide' : ''}`}>
        <header className="modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label}
      className={`switch ${checked ? 'switch--on' : ''}`} onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

export function Spinner({ label = 'Carregando' }) {
  return <div className="spinner" role="status" aria-label={label}><i /><span>{label}…</span></div>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Toast({ text, tone, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4200);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={`toast toast--${tone}`} role="status">
      <span>{text}</span>
      <button type="button" onClick={onClose} aria-label="Fechar">✕</button>
    </div>
  );
}

export function Toasts({ toasts, onClose }) {
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => <Toast key={toast.id} {...toast} onClose={() => onClose(toast.id)} />)}
    </div>
  );
}
