import React from 'react';
import { useApp } from '../store.jsx';
import { ServerIcon } from './ui.jsx';

export default function ServerRail() {
  const app = useApp();
  const { servers, view, user } = app;

  const goHome = () => {
    app.dispatch({ type: 'view', view: { kind: 'home', id: null } });
  };

  const openServer = (serverId) => app.selectServer(serverId);

  return (
    <nav className="rail" aria-label="Servidores">
      <button
        type="button"
        className={`rail__home ${view.kind === 'home' ? 'is-active' : ''}`}
        onClick={goHome}
        title="Início"
        aria-label="Início"
      >
        <svg viewBox="0 0 128 128" width="26" height="26" aria-hidden="true">
          <defs>
            <linearGradient id="railg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#c4b5fd" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <path d="M64 14 104 37v50L64 110 24 87V37z" fill="none" stroke="url(#railg)" strokeWidth="8" strokeLinejoin="round" />
          <path d="M46 46h36L56 82h30" fill="none" stroke="url(#railg)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="rail__divider" />

      <div className="rail__list">
        {servers.map((server) => {
          const active = view.kind === 'server' && view.id === server.id;
          return (
            <button
              key={server.id}
              type="button"
              className={`rail__item ${active ? 'is-active' : ''}`}
              onClick={() => openServer(server.id)}
              title={server.name}
              aria-label={server.name}
              aria-current={active ? 'page' : undefined}
            >
              <i className="rail__pill" />
              <ServerIcon server={server} />
            </button>
          );
        })}

        <button
          type="button" className="rail__item rail__add" title="Criar servidor"
          aria-label="Criar servidor" onClick={() => app.openModal({ type: 'createServer' })}
        >
          <span>+</span>
        </button>

        <button
          type="button" className="rail__item rail__join" title="Entrar com convite"
          aria-label="Entrar com convite" onClick={() => app.openModal({ type: 'joinServer' })}
        >
          <span>→</span>
        </button>
      </div>

      <div className="rail__foot">
        {user?.isAdmin && (
          <button
            type="button" className="rail__item rail__admin" title="Painel administrativo"
            aria-label="Painel administrativo" onClick={() => app.openModal({ type: 'admin' })}
          >
            <span>★</span>
          </button>
        )}
        <button
          type="button" className="rail__item rail__gear" title="Configurações"
          aria-label="Configurações" onClick={() => app.openModal({ type: 'settings' })}
        >
          <span>⚙</span>
        </button>
      </div>
    </nav>
  );
}
