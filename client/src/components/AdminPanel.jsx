import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../store.jsx';
import { fullDate } from '../lib/format.js';
import { Avatar, Spinner } from './ui.jsx';

export default function AdminPanel() {
  const app = useApp();
  const [tab, setTab] = useState('visao');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [servers, setServers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, u, sv, a] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/users'),
        api.get('/admin/servers'),
        api.get('/admin/audit'),
      ]);
      setStats(s.stats || s);
      setUsers(u.users || []);
      setServers(sv.servers || []);
      setAudit(a.entries || a.audit || a.logs || []);
    } catch (err) {
      setError(err.message || 'Falha ao carregar o painel administrativo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const act = async (path, body, method = 'post') => {
    try {
      if (method === 'delete') await api.del(path);
      else await api.post(path, body);
      app.toast('Ação aplicada.', 'ok');
      await load();
    } catch (err) {
      app.toast(err.message || 'Não foi possível concluir a ação.', 'error');
    }
  };

  const filtered = users.filter((u) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return `${u.username} ${u.displayName} ${u.email}`.toLowerCase().includes(term);
  });

  return (
    <div className="panel">
      <header className="panel__head">
        <h2>Painel administrativo</h2>
        <button type="button" className="btn btn--ghost" onClick={load}>Atualizar</button>
      </header>
      {error && <div className="auth__error">{error}</div>}

      <div className="tabs">
        {[
          ['visao', 'Visão geral'], ['usuarios', 'Usuários'], ['servidores', 'Servidores'], ['auditoria', 'Auditoria'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={`tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {loading ? <Spinner label="Carregando dados reais da plataforma…" /> : (
        <>
          {tab === 'visao' && stats && (
            <div className="stats">
              {[
                ['Usuários', stats.users], ['Online agora', stats.online], ['Servidores', stats.servers],
                ['Canais', stats.channels], ['Mensagens', stats.messages], ['Mensagens 24h', stats.messages24h],
                ['Conversas privadas', stats.dms], ['Uploads', stats.uploads], ['Bots', stats.bots],
                ['Webhooks', stats.webhooks],
              ].map(([label, value]) => (
                <div key={label} className="stats__item">
                  <span>{label}</span>
                  <strong>{value ?? 0}</strong>
                </div>
              ))}
            </div>
          )}

          {tab === 'usuarios' && (
            <>
              <input className="input" placeholder="Filtrar por nome, usuário ou e-mail" value={query} onChange={(e) => setQuery(e.target.value)} />
              <ul className="rows">
                {filtered.map((u) => (
                  <li key={u.id} className="rows__item">
                    <Avatar user={u} size={34} />
                    <div className="rows__main">
                      <strong>{u.displayName} <span className="muted">@{u.username}</span></strong>
                      <span className="muted">{u.email} · {u.servers ?? 0} servidor(es) · desde {fullDate(u.createdAt)}</span>
                    </div>
                    <div className="rows__actions">
                      {u.isAdmin && <span className="badge">admin</span>}
                      {u.suspended && <span className="badge badge--danger">suspenso</span>}
                      <button type="button" className="btn btn--sm" onClick={() => act(`/admin/users/${u.id}/suspend`, { suspended: !u.suspended })}>
                        {u.suspended ? 'Reativar' : 'Suspender'}
                      </button>
                      <button type="button" className="btn btn--sm" onClick={() => act(`/admin/users/${u.id}/admin`, { isAdmin: !u.isAdmin })}>
                        {u.isAdmin ? 'Remover admin' : 'Tornar admin'}
                      </button>
                      <button type="button" className="btn btn--sm btn--danger" onClick={() => act(`/admin/users/${u.id}`, null, 'delete')}>
                        Excluir
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === 'servidores' && (
            <ul className="rows">
              {servers.map((s) => (
                <li key={s.id} className="rows__item">
                  <div className="rows__main">
                    <strong>{s.name}</strong>
                    <span className="muted">
                      {s.memberCount ?? s.members ?? 0} membros · {s.channelCount ?? 0} canais
                      {s.ownerName ? ` · dono ${s.ownerName}` : ''}
                    </span>
                  </div>
                  <button type="button" className="btn btn--sm btn--danger" onClick={() => act(`/admin/servers/${s.id}`, null, 'delete')}>
                    Excluir servidor
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tab === 'auditoria' && (
            <ul className="rows rows--compact">
              {audit.map((entry) => (
                <li key={entry.id} className="rows__item">
                  <div className="rows__main">
                    <strong>{entry.action}</strong>
                    <span className="muted">
                      {entry.actorName || entry.username || 'sistema'} · {entry.target || ''} · {fullDate(entry.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
              {!audit.length && <li className="muted">Nenhum registro de auditoria ainda.</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
