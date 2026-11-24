import React, { useMemo } from 'react';
import { useApp } from '../store.jsx';
import Chat from './Chat.jsx';
import FriendsHome from './FriendsHome.jsx';
import VoiceRoom from './VoiceRoom.jsx';
import { Avatar } from './ui.jsx';

export default function MainArea() {
  const app = useApp();
  const { view, servers, dms, channelId, user } = app;

  const server = view.kind === 'server' ? servers.find((s) => s.id === view.id) : null;
  const channel = server?.channels.find((c) => c.id === channelId) || null;
  const dm = view.kind === 'dm' ? dms.find((d) => d.id === view.id) : null;

  const header = useMemo(() => {
    if (dm) {
      const other = dm.type === 'direct' ? dm.members.find((m) => m.id !== user.id) : null;
      return {
        icon: dm.type === 'group' ? '◍' : '@',
        title: dm.type === 'group' ? dm.name : (other?.displayName || other?.username || 'Conversa'),
        topic: dm.type === 'group'
          ? `${dm.members.length} participantes`
          : (other ? `@${other.username}` : ''),
        members: dm.members,
      };
    }
    if (channel) {
      return {
        icon: channel.type === 'voice' ? '🔊' : '#',
        title: channel.name,
        topic: channel.topic || '',
      };
    }
    return { icon: '◍', title: 'Amigos', topic: '' };
  }, [dm, channel, user.id]);

  return (
    <main className="main">
      <header className="topbar">
        <button
          type="button" className="icon-btn topbar__burger" aria-label="Abrir menu"
          onClick={() => app.dispatch({ type: 'drawer', open: true })}
        >☰</button>
        <div className="topbar__title">
          <span className="topbar__icon">{header.icon}</span>
          <strong>{header.title}</strong>
          {header.topic && <span className="topbar__topic">{header.topic}</span>}
        </div>
        <div className="topbar__actions">
          {channel && (
            <button type="button" className="icon-btn" title="Mensagens fixadas" onClick={() => app.openModal({ type: 'pins', channelId: channel.id })}>📌</button>
          )}
          {dm && dm.type === 'group' && (
            <button type="button" className="icon-btn" title="Participantes" onClick={() => app.openModal({ type: 'groupMembers', dmId: dm.id })}>👥</button>
          )}
          <button type="button" className="icon-btn" title="Buscar" onClick={() => app.openModal({ type: 'search' })}>⌕</button>
          {server && (
            <button
              type="button" className="icon-btn" title="Lista de membros"
              onClick={() => app.dispatch({ type: 'members:toggle' })}
            >👥</button>
          )}
          {server && (
            <button type="button" className="icon-btn" title="Convite" onClick={() => app.openModal({ type: 'invite', serverId: server.id })}>🔗</button>
          )}
        </div>
      </header>

      <div className="main__body">
        {view.kind === 'home' && <FriendsHome />}
        {view.kind === 'dm' && dm && (
          <Chat key={`dm:${dm.id}`} scopeType="dm" scopeId={dm.id} dm={dm} header={header} />
        )}
        {view.kind === 'server' && channel && channel.type === 'text' && (
          <Chat key={`ch:${channel.id}`} scopeType="channel" scopeId={channel.id} channel={channel} server={server} header={header} />
        )}
        {view.kind === 'server' && channel && channel.type === 'voice' && (
          <VoiceRoom channel={channel} server={server} />
        )}
        {view.kind === 'server' && !channel && (
          <div className="empty empty--center">
            <strong>Selecione um canal</strong>
            <p>Escolha um canal de texto ou voz na barra lateral.</p>
          </div>
        )}
      </div>
    </main>
  );
}
