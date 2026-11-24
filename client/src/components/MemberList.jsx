import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar } from './ui.jsx';

export default function MemberList() {
  const app = useApp();
  const server = app.servers.find((s) => s.id === app.view.id);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!server) return;
    let alive = true;
    app.loadMembers(server.id)?.finally?.(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = app.members[server?.id] || [];

  const groups = useMemo(() => {
    const online = [];
    const offline = [];
    for (const member of members) {
      const isOnline = app.online.includes(member.id);
      (isOnline ? online : offline).push(member);
    }
    const byName = (a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username);
    return [
      { key: 'online', label: `Online — ${online.length}`, items: online.sort(byName) },
      { key: 'offline', label: `Offline — ${offline.length}`, items: offline.sort(byName) },
    ];
  }, [members, app.online]);

  if (!server) return null;

  return (
    <aside className="members" aria-label="Membros">
      {loading && members.length === 0 && <p className="sidebar__empty">Carregando membros…</p>}
      {groups.map((group) => (
        group.items.length === 0 ? null : (
          <section key={group.key} className="members__group">
            <div className="members__label">{group.label}</div>
            {group.items.map((member) => {
              const role = member.roles?.[0];
              return (
                <button
                  key={member.id}
                  type="button"
                  className="member"
                  title={`@${member.username}`}
                  onClick={() => app.openModal({ type: 'memberProfile', serverId: server.id, userId: member.id })}
                >
                  <Avatar
                    user={member}
                    size={32}
                    status={app.online.includes(member.id) ? (member.status || 'online') : 'offline'}
                  />
                  <span className="member__text">
                    <strong style={role?.color ? { color: role.color } : undefined}>
                      {member.nickname || member.displayName || member.username}
                    </strong>
                    {role?.name && <small>{role.name}</small>}
                  </span>
                  <span className="member__tags">
                    {member.isBot && <i className="tag tag--bot">BOT</i>}
                    {member.isOwner && <i className="tag tag--owner">DONO</i>}
                  </span>
                </button>
              );
            })}
          </section>
        )
      ))}
      {!loading && members.length === 0 && <p className="sidebar__empty">Nenhum membro carregado.</p>}
    </aside>
  );
}
