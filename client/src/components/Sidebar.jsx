import React, { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar } from './ui.jsx';
import { STATUS_LABEL, colorFor, initials } from '../lib/format.js';

function ChannelIcon({ type }) {
  return type === 'voice'
    ? <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M17 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>
    : <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M10 4 8 20M16 4l-2 16M4 9h16M3 15h16" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>;
}

export default function Sidebar() {
  const app = useApp();
  const { view, servers, dms, unread, user, channelId, voiceStates } = app;
  const server = view.kind === 'server' ? servers.find((s) => s.id === view.id) : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const grouped = useMemo(() => {
    if (!server) return [];
    const map = new Map();
    for (const channel of server.channels) {
      const key = channel.category || 'Canais';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(channel);
    }
    return [...map.entries()];
  }, [server]);

  const canManage = server && ((server.myPermissions & (1 << 1)) || server.isOwner);

  const setStatus = async (status) => {
    setStatusOpen(false);
    try {
      await app.request('/users/me', { method: 'PATCH', body: { status } });
      app.dispatch({ type: 'user', user: { ...user, status } });
      app.socket.current?.emit('status:set', { status });
    } catch (error) { app.toast(error.message, 'error'); }
  };

  return (
    <aside className="sidebar" aria-label="Navegação">
      {server ? (
        <header className="sidebar__head">
          <button type="button" className="sidebar__title" onClick={() => setMenuOpen((v) => !v)}>
            <span>{server.name}</span>
            <i>⌄</i>
          </button>
          {menuOpen && (
            <>
              <button type="button" className="menu-backdrop" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />
              <div className="menu">
                {canManage && (
                  <button type="button" onClick={() => { setMenuOpen(false); app.openModal({ type: 'serverSettings', serverId: server.id }); }}>
                    Configurações do servidor
                  </button>
                )}
                <button type="button" onClick={() => { setMenuOpen(false); app.openModal({ type: 'invite', serverId: server.id }); }}>
                  Convidar pessoas
                </button>
                {canManage && (
                  <button type="button" onClick={() => { setMenuOpen(false); app.openModal({ type: 'createChannel', serverId: server.id }); }}>
                    Criar canal
                  </button>
                )}
                {canManage && (
                  <button type="button" onClick={() => { setMenuOpen(false); app.openModal({ type: 'roles', serverId: server.id }); }}>
                    Cargos e permissões
                  </button>
                )}
                <button type="button" onClick={() => { setMenuOpen(false); app.openModal({ type: 'bans', serverId: server.id }); }}>
                  Banimentos
                </button>
                {canManage && (
                  <button type="button" onClick={() => { setMenuOpen(false); app.openModal({ type: 'integrations', serverId: server.id }); }}>
                    Bots e webhooks
                  </button>
                )}
                <button type="button" className="is-danger" onClick={() => { setMenuOpen(false); app.openModal({ type: 'leaveServer', serverId: server.id }); }}>
                  Sair do servidor
                </button>
              </div>
            </>
          )}
        </header>
      ) : (
        <header className="sidebar__head sidebar__head--home">
          <span className="sidebar__title">Mensagens diretas</span>
          <button
            type="button" className="icon-btn" title="Nova conversa"
            onClick={() => app.openModal({ type: 'newDm' })}
          >+</button>
        </header>
      )}

      <div className="sidebar__body">
        {server ? (
          <>
            <button type="button" className="nav-item" onClick={() => app.openModal({ type: 'search' })}>
              <span className="nav-item__icon">⌕</span> Buscar mensagens
            </button>
            {grouped.map(([category, channels]) => (
              <section key={category} className="cat">
                <div className="cat__head">
                  <span className="cat__label">{category}</span>
                  {canManage && (
                    <button
                      type="button" className="cat__btn" title="Criar canal"
                      onClick={() => app.openModal({ type: 'createChannel', serverId: server.id, category: category === 'Canais' ? '' : category })}
                    >+</button>
                  )}
                </div>
                {channels.map((channel) => {
                  const active = channelId === channel.id;
                  const badge = unread[`channel:${channel.id}`] || 0;
                  const inVoice = voiceStates[channel.id] || [];
                  return (
                    <div key={channel.id}>
                      <button
                        type="button"
                        className={`chan ${active ? 'is-active' : ''} ${badge ? 'has-unread' : ''}`}
                        onClick={() => app.selectChannel(channel)}
                      >
                        <span className="chan__icon"><ChannelIcon type={channel.type} /></span>
                        <span className="chan__name">{channel.name}</span>
                        {channel.slowmode > 0 && <span className="chan__meta" title="Modo lento">⏱</span>}
                        {badge > 0 && <span className="chan__badge">{badge > 99 ? '99+' : badge}</span>}
                      </button>
                      {channel.type === 'voice' && inVoice.length > 0 && (
                        <ul className="voice-peers">
                          {inVoice.map((peer) => (
                            <li key={peer.userId}>
                              <Avatar user={{ displayName: peer.name, id: peer.userId }} size={20} />
                              <span>{peer.name}</span>
                              {peer.muted && <i title="Microfone desativado">🔇</i>}
                              {peer.screen && <i title="Compartilhando tela">🖥</i>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </>
        ) : (
          <>
            <button type="button" className="nav-item" onClick={() => app.dispatch({ type: 'view', view: { kind: 'home', id: null } })}>
              <span className="nav-item__icon">◍</span> Amigos
            </button>
            <button type="button" className="nav-item" onClick={() => app.dispatch({ type: 'view', view: { kind: 'home', id: null } })}>
              <span className="nav-item__icon">⌕</span> Buscar mensagens
            </button>
            <div className="cat__head cat__head--dm">
              <span className="cat__label">Conversas</span>
              <button type="button" className="cat__btn" title="Nova conversa" onClick={() => app.openModal({ type: 'newDm' })}>+</button>
            </div>
            {dms.length === 0 && <p className="sidebar__empty">Nenhuma conversa ainda. Adicione amigos e comece a conversar.</p>}
            {dms.map((dm) => {
              const active = view.kind === 'dm' && view.id === dm.id;
              const other = dm.type === 'direct' ? dm.members.find((m) => m.id !== user.id) : null;
              const label = dm.type === 'group' ? dm.name : (other?.displayName || other?.username || 'Conversa');
              const badge = unread[`dm:${dm.id}`] || 0;
              return (
                <button
                  key={dm.id}
                  type="button"
                  className={`chan chan--dm ${active ? 'is-active' : ''}`}
                  onClick={() => app.selectDm(dm.id)}
                >
                  {dm.type === 'group' ? (
                    <span className="dm-icon" style={{ background: colorFor(dm.id) }}>{initials(label)}</span>
                  ) : (
                    <Avatar user={other} size={28} status={app.online.includes(other?.id) ? 'online' : 'offline'} />
                  )}
                  <span className="chan__name">
                    {label}
                    {dm.lastMessage && <small>{dm.lastMessage.slice(0, 38)}</small>}
                  </span>
                  {badge > 0 && <span className="chan__badge">{badge > 99 ? '99+' : badge}</span>}
                </button>
              );
            })}
          </>
        )}
      </div>

      <footer className="sidebar__foot">
        <button type="button" className="me" onClick={() => setStatusOpen((v) => !v)}>
          <Avatar user={user} size={32} status={app.online.includes(user.id) ? (user.status === 'invisible' ? 'offline' : user.status) : 'offline'} />
          <span className="me__text">
            <strong>{user.displayName}</strong>
            <small>{STATUS_LABEL[user.status] || 'Online'}</small>
          </span>
        </button>
        <div className="me__actions">
          <button type="button" className="icon-btn" title="Configurações" onClick={() => app.openModal({ type: 'settings' })}>⚙</button>
          <button type="button" className="icon-btn" title="Sair" onClick={app.signOut}>⏻</button>
        </div>
        {statusOpen && (
          <>
            <button type="button" className="menu-backdrop" aria-label="Fechar" onClick={() => setStatusOpen(false)} />
            <div className="menu menu--up">
              <span className="menu__label">Status</span>
              {['online', 'idle', 'dnd', 'invisible'].map((status) => (
                <button key={status} type="button" onClick={() => setStatus(status)}>
                  <i className={`status-dot status-dot--${status}`} /> {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </>
        )}
      </footer>
    </aside>
  );
}
