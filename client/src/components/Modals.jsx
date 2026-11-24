import React, { useEffect, useState } from 'react';
import { api, uploadFile } from '../lib/api.js';
import { useApp } from '../store.jsx';
import { Avatar, Empty, Field, Modal, Spinner } from './ui.jsx';
import { fileSize, fullDate, timeOf } from '../lib/format.js';
import Settings from './Settings.jsx';
import ServerSettings from './ServerSettings.jsx';
import AdminPanel from './AdminPanel.jsx';

function copy(text) {
  try { navigator.clipboard?.writeText(text); } catch { /* clipboard bloqueado */ }
}

/* ----------------------------- servidores ----------------------------- */

function CreateServer({ onClose }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/servers', { method: 'POST', body: { name, iconUrl: iconUrl || undefined } });
      await app.refreshBootstrap();
      if (data?.server?.id) app.selectServer(data.server.id);
      app.toast('Servidor criado.', 'ok');
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível criar o servidor.');
    } finally {
      setBusy(false);
    }
  };

  const pickIcon = async (file) => {
    if (!file) return;
    try {
      const data = await uploadFile(file);
      setIconUrl(data?.upload?.url || '');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title="Criar servidor" subtitle="Seu espaço para comunidades, canais e cargos." onClose={onClose}
      footer={<button type="button" className="btn btn--primary" disabled={busy || name.trim().length < 2} onClick={submit}>Criar</button>}
    >
      {error && <div className="auth__error">{error}</div>}
      <Field label="Nome do servidor" hint="De 2 a 60 caracteres.">
        <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Comunidade ZYRA" />
      </Field>
      <Field label="Ícone (opcional)">
        <input type="file" accept="image/*" onChange={(e) => pickIcon(e.target.files?.[0])} />
      </Field>
    </Modal>
  );
}

function JoinServer({ onClose }) {
  const app = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    const parsed = code.includes('/') ? code.split('/').filter(Boolean).pop() : code.trim();
    try {
      const data = await api(`/invites/${parsed}`, { method: 'POST' });
      await app.refreshBootstrap();
      if (data?.server?.id) app.selectServer(data.server.id);
      app.toast('Você entrou no servidor.', 'ok');
      onClose();
    } catch (err) {
      setError(err.message || 'Convite inválido ou expirado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Entrar em um servidor" subtitle="Cole o código ou o link do convite." onClose={onClose}
      footer={<button type="button" className="btn btn--primary" disabled={busy || !code.trim()} onClick={submit}>Entrar</button>}
    >
      {error && <div className="auth__error">{error}</div>}
      <Field label="Convite">
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc123 ou https://…/?invite=abc123" />
      </Field>
    </Modal>
  );
}

function InviteModal({ onClose, serverId, channelId }) {
  const app = useApp();
  const [invites, setInvites] = useState([]);
  const [created, setCreated] = useState('');
  const [maxUses, setMaxUses] = useState(0);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!serverId) return;
    try {
      const data = await api(`/servers/${serverId}/invites`);
      setInvites(data.invites || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [serverId]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const target = channelId || app.channelId;
      if (!target) throw new Error('Selecione um canal para gerar o convite.');
      const data = await api(`/channels/${target}/invites`, { method: 'POST', body: { maxUses: Number(maxUses), expiresInHours: Number(hours) } });
      const code = data?.invite?.code;
      if (code) {
        const link = `${window.location.origin}/?invite=${code}`;
        setCreated(link);
        copy(link);
        app.toast('Convite criado e copiado.', 'ok');
      }
      load();
    } catch (err) {
      setError(err.message || 'Não foi possível criar o convite.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Convites" subtitle="Qualquer pessoa com o link pode entrar." onClose={onClose} wide>
      {error && <div className="auth__error">{error}</div>}
      <div className="invite-row">
        <Field label="Usos máximos" hint="0 = ilimitado">
          <input className="input" type="number" min={0} max={1000} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </Field>
        <Field label="Expira em (horas)" hint="0 = nunca">
          <input className="input" type="number" min={0} max={720} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={create}>Gerar convite</button>
      </div>
      {created && (
        <div className="invite-created">
          <code>{created}</code>
          <button type="button" className="btn btn--sm" onClick={() => { copy(created); app.toast('Link copiado.', 'ok'); }}>Copiar</button>
        </div>
      )}
      {loading ? <Spinner label="Carregando convites" /> : (
        <ul className="rows rows--compact">
          {invites.map((invite) => (
            <li key={invite.code} className="rows__item">
              <div className="rows__main">
                <strong>{invite.code}</strong>
                <span className="muted">
                  {invite.uses || 0}{invite.maxUses ? `/${invite.maxUses}` : ''} usos ·
                  {invite.expiresAt ? ` expira ${fullDate(invite.expiresAt)}` : ' sem expiração'}
                </span>
              </div>
              <button type="button" className="btn btn--sm" onClick={() => { copy(`${window.location.origin}/?invite=${invite.code}`); app.toast('Link copiado.', 'ok'); }}>Copiar</button>
              <button type="button" className="btn btn--sm btn--danger" onClick={async () => {
                await api(`/invites/${invite.code}`, { method: 'DELETE' });
                load();
              }}>Revogar</button>
            </li>
          ))}
          {!invites.length && <li className="muted">Nenhum convite ativo.</li>}
        </ul>
      )}
    </Modal>
  );
}

function CreateChannel({ onClose, serverId, category }) {
  const app = useApp();
  const [form, setForm] = useState({ name: '', type: 'text', category: category || 'Texto', topic: '', userLimit: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api(`/servers/${serverId}/channels`, { method: 'POST', body: form });
      await app.refreshBootstrap();
      if (data?.channel?.id) app.selectChannel(data.channel.id);
      app.toast('Canal criado.', 'ok');
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível criar o canal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Criar canal" onClose={onClose}
      footer={<button type="button" className="btn btn--primary" disabled={busy || !form.name.trim()} onClick={submit}>Criar canal</button>}
    >
      {error && <div className="auth__error">{error}</div>}
      <Field label="Tipo">
        <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="text">Texto</option>
          <option value="voice">Voz</option>
        </select>
      </Field>
      <Field label="Nome do canal">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="geral" />
      </Field>
      <Field label="Categoria">
        <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
      </Field>
      {form.type === 'text' ? (
        <Field label="Tópico" hint="Opcional, até 200 caracteres.">
          <input className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
        </Field>
      ) : (
        <Field label="Limite de participantes" hint="0 = sem limite.">
          <input className="input" type="number" min={0} max={99} value={form.userLimit} onChange={(e) => setForm({ ...form, userLimit: e.target.value })} />
        </Field>
      )}
    </Modal>
  );
}

function LeaveServer({ onClose, serverId }) {
  const app = useApp();
  const server = app.servers.find((s) => s.id === serverId);
  const [error, setError] = useState('');

  const leave = async () => {
    try {
      await api(`/servers/${serverId}/leave`, { method: 'POST' });
      await app.refreshBootstrap();
      app.dispatch({ type: 'view', view: { kind: 'home', id: null } });
      app.toast('Você saiu do servidor.', 'ok');
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível sair do servidor.');
    }
  };

  return (
    <Modal title="Sair do servidor" onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--danger" onClick={leave}>Sair</button>
        </>
      )}
    >
      {error && <div className="auth__error">{error}</div>}
      <p>Tem certeza que deseja sair de <strong>{server?.name || 'servidor'}</strong>? Você poderá voltar apenas com um novo convite.</p>
    </Modal>
  );
}

/* ------------------------------- mensagens ------------------------------ */

function SearchModal({ onClose }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [scopeAll, setScopeAll] = useState(true);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (q.trim().length < 2) { setResults([]); return; }
    setBusy(true);
    setError('');
    try {
      const scopeType = app.view.kind === 'dm' ? 'dm' : 'channel';
      const scopeId = scopeAll ? '' : (app.view.id || '');
      const data = await api(`/search?q=${encodeURIComponent(q.trim())}&scopeType=${scopeType}${scopeId ? `&scopeId=${scopeId}` : ''}`);
      setResults(data.results || []);
    } catch (err) {
      setError(err.message || 'Falha na busca.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Buscar mensagens" subtitle="Pesquisa nas conversas que você pode acessar." onClose={onClose} wide>
      <div className="invite-row">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} placeholder="Digite ao menos 2 caracteres" />
        <button type="button" className="btn btn--primary" disabled={busy} onClick={run}>Buscar</button>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
        <span>Buscar em todos os meus canais e conversas</span>
      </label>
      {error && <div className="auth__error">{error}</div>}
      {busy ? <Spinner label="Buscando" /> : (
        <ul className="rows rows--compact">
          {results.map((message) => (
            <li key={message.id} className="rows__item">
              <div className="rows__main">
                <strong>{message.authorName || message.author?.displayName || 'Mensagem'} <span className="muted">{timeOf(message.createdAt)}</span></strong>
                <span className="muted">{message.content}</span>
              </div>
              <button type="button" className="btn btn--sm" onClick={() => {
                if (message.scopeType === 'dm' || message.scope_type === 'dm') app.selectDm(message.scopeId || message.scope_id);
                else app.selectChannel(message.scopeId || message.scope_id);
                onClose();
              }}>Abrir</button>
            </li>
          ))}
          {!results.length && !busy && <li className="muted">Nenhum resultado encontrado.</li>}
        </ul>
      )}
    </Modal>
  );
}

function PinsModal({ onClose, channelId }) {
  const app = useApp();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/channels/${channelId}/pins`);
        setMessages(data.messages || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [channelId]);

  return (
    <Modal title="Mensagens fixadas" onClose={onClose} wide>
      {error && <div className="auth__error">{error}</div>}
      {loading ? <Spinner label="Carregando" /> : (
        <ul className="rows rows--compact">
          {messages.map((m) => (
            <li key={m.id} className="rows__item">
              <div className="rows__main">
                <strong>{m.authorName || m.author?.displayName || 'Mensagem'}</strong>
                <span className="muted">{m.content}</span>
              </div>
              <button type="button" className="btn btn--sm" onClick={async () => {
                await api(`/messages/${m.id}/pin`, { method: 'POST', body: { pinned: false } });
                setMessages((current) => current.filter((item) => item.id !== m.id));
                app.toast('Mensagem desafixada.', 'ok');
              }}>Desafixar</button>
            </li>
          ))}
          {!messages.length && <li className="muted">Nenhuma mensagem fixada neste canal.</li>}
        </ul>
      )}
    </Modal>
  );
}

/* --------------------------------- DMs --------------------------------- */

function NewDm({ onClose }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (q.trim().length < 1) { setUsers([]); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/users/search?q=${encodeURIComponent(q.trim())}`);
        setUsers(data.users || []);
      } catch (err) {
        setError(err.message);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  const start = async (userId) => {
    try {
      const data = await api('/dms', { method: 'POST', body: { userId } });
      await app.refreshBootstrap();
      if (data?.dm?.id) app.selectDm(data.dm.id);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title="Nova conversa" subtitle="Encontre alguém pelo nome ou usuário." onClose={onClose}>
      <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome ou @usuario" />
      {error && <div className="auth__error">{error}</div>}
      <ul className="rows rows--compact">
        {users.map((u) => (
          <li key={u.id} className="rows__item">
            <Avatar user={u} size={32} />
            <div className="rows__main"><strong>{u.displayName}</strong><span className="muted">@{u.username}</span></div>
            <button type="button" className="btn btn--sm btn--primary" onClick={() => start(u.id)}>Conversar</button>
          </li>
        ))}
        {!users.length && q.trim() && <li className="muted">Nenhum usuário encontrado.</li>}
      </ul>
    </Modal>
  );
}

function GroupMembers({ onClose, dmId }) {
  const app = useApp();
  const dm = app.dms.find((d) => d.id === dmId);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const members = dm?.members || dm?.recipients || [];

  const add = async (userId) => {
    try {
      await api(`/dms/${dmId}/members`, { method: 'POST', body: { userId } });
      await app.refreshBootstrap();
      app.toast('Participante adicionado.', 'ok');
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (userId) => {
    try {
      await api(`/dms/${dmId}/members/${userId}`, { method: 'DELETE' });
      await app.refreshBootstrap();
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (q.trim().length < 1) { setUsers([]); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/users/search?q=${encodeURIComponent(q.trim())}`);
        setUsers(data.users || []);
      } catch (err) {
        setError(err.message);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <Modal title={`Participantes · ${dm?.name || 'grupo'}`} onClose={onClose}>
      {error && <div className="auth__error">{error}</div>}
      <ul className="rows rows--compact">
        {members.map((m) => (
          <li key={m.id || m.userId} className="rows__item">
            <Avatar user={m} size={30} />
            <div className="rows__main"><strong>{m.displayName || m.name}</strong><span className="muted">@{m.username}</span></div>
            <button type="button" className="btn btn--sm btn--danger" onClick={() => remove(m.id || m.userId)}>Remover</button>
          </li>
        ))}
      </ul>
      <Field label="Adicionar participante">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome ou @usuario" />
      </Field>
      <ul className="rows rows--compact">
        {users.map((u) => (
          <li key={u.id} className="rows__item">
            <Avatar user={u} size={28} />
            <div className="rows__main"><strong>{u.displayName}</strong><span className="muted">@{u.username}</span></div>
            <button type="button" className="btn btn--sm" onClick={() => add(u.id)}>Adicionar</button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function MemberProfile({ onClose, userId }) {
  const app = useApp();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/users/${userId}`);
        setProfile(data.user || data.profile || null);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [userId]);

  const addFriend = async () => {
    try {
      await api('/friends/request', { method: 'POST', body: { username: profile.username } });
      app.toast('Pedido de amizade enviado.', 'ok');
    } catch (err) {
      setError(err.message);
    }
  };

  const openDm = async () => {
    try {
      const data = await api('/dms', { method: 'POST', body: { userId } });
      await app.refreshBootstrap();
      if (data?.dm?.id) app.selectDm(data.dm.id);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title="Perfil" onClose={onClose}>
      {error && <div className="auth__error">{error}</div>}
      {!profile ? <Spinner label="Carregando perfil" /> : (
        <>
          <div className="profile-preview" style={{ background: profile.bannerColor || '#8b7cf6' }}>
            <Avatar user={profile} size={64} status={profile.status} />
            <div><strong>{profile.displayName}</strong><span>@{profile.username}</span></div>
          </div>
          {profile.customStatus && <p className="muted">{profile.customStatus}</p>}
          <p>{profile.bio || 'Sem descrição.'}</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--primary" onClick={openDm}>Mensagem</button>
            <button type="button" className="btn" onClick={addFriend}>Adicionar amigo</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* -------------------------------- roteador ------------------------------ */

export default function Modals() {
  const app = useApp();
  const modal = app.modal;
  if (!modal) return null;
  const close = app.closeModal;
  const serverId = modal.serverId || (app.view.kind === 'server' ? app.view.id : null);

  switch (modal.type) {
    case 'settings': return <Settings onClose={close} />;
    case 'admin': return <AdminPanel />;
    case 'serverSettings': return <ServerSettings onClose={close} serverId={serverId} initialTab={modal.tab} />;
    case 'roles': return <ServerSettings onClose={close} serverId={serverId} initialTab="cargos" />;
    case 'bans': return <ServerSettings onClose={close} serverId={serverId} initialTab="bans" />;
    case 'integrations': return <ServerSettings onClose={close} serverId={serverId} initialTab="integracoes" />;
    case 'createServer': return <CreateServer onClose={close} />;
    case 'joinServer': return <JoinServer onClose={close} />;
    case 'invite': return <InviteModal onClose={close} serverId={serverId} channelId={modal.channelId} />;
    case 'createChannel': return <CreateChannel onClose={close} serverId={serverId} category={modal.category} />;
    case 'leaveServer': return <LeaveServer onClose={close} serverId={serverId} />;
    case 'search': return <SearchModal onClose={close} />;
    case 'pins': return <PinsModal onClose={close} channelId={modal.channelId || app.channelId} />;
    case 'newDm': return <NewDm onClose={close} />;
    case 'groupMembers': return <GroupMembers onClose={close} dmId={modal.dmId || app.view.id} />;
    case 'memberProfile': return <MemberProfile onClose={close} userId={modal.userId} />;
    default:
      return (
        <Modal title="ZYRA" onClose={close}>
          <Empty title="Nada por aqui">Esta janela não está disponível.</Empty>
        </Modal>
      );
  }
}
