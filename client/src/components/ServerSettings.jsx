import React, { useEffect, useMemo, useState } from 'react';
import { api, uploadFile } from '../lib/api.js';
import { useApp } from '../store.jsx';
import { Avatar, Empty, Field, Spinner, Toggle } from './ui.jsx';
import { fullDate } from '../lib/format.js';

const PERM_BITS = [
  ['ADMIN', 'Administrador', 0],
  ['MANAGE_SERVER', 'Gerenciar servidor', 1],
  ['MANAGE_CHANNELS', 'Gerenciar canais', 2],
  ['MANAGE_ROLES', 'Gerenciar cargos', 3],
  ['KICK_MEMBERS', 'Expulsar membros', 4],
  ['BAN_MEMBERS', 'Banir membros', 5],
  ['TIMEOUT_MEMBERS', 'Silenciar temporariamente', 6],
  ['MANAGE_MESSAGES', 'Gerenciar mensagens', 7],
  ['SEND_MESSAGES', 'Enviar mensagens', 8],
  ['VIEW_CHANNELS', 'Ver canais', 9],
  ['ATTACH_FILES', 'Anexar arquivos', 10],
  ['ADD_REACTIONS', 'Adicionar reações', 11],
  ['MENTION_EVERYONE', 'Mencionar @todos', 12],
  ['MANAGE_WEBHOOKS', 'Gerenciar webhooks', 13],
  ['CREATE_INVITES', 'Criar convites', 14],
  ['VOICE_CONNECT', 'Conectar em voz', 15],
  ['VOICE_SPEAK', 'Falar em voz', 16],
  ['VIEW_AUDIT_LOG', 'Ver auditoria', 17],
  ['MANAGE_BOTS', 'Gerenciar bots', 18],
  ['PIN_MESSAGES', 'Fixar mensagens', 19],
  ['CHANGE_NICKNAME', 'Alterar apelido', 20],
  ['MANAGE_EMOJIS', 'Gerenciar emojis', 21],
];

const TABS = [
  ['geral', 'Geral'],
  ['canais', 'Canais'],
  ['cargos', 'Cargos'],
  ['emojis', 'Emojis'],
  ['stickers', 'Stickers'],
  ['bans', 'Banimentos'],
  ['convites', 'Convites'],
  ['integracoes', 'Bots e webhooks'],
  ['auditoria', 'Auditoria'],
];

export default function ServerSettings({ onClose, serverId, initialTab = 'geral' }) {
  const app = useApp();
  const [tab, setTab] = useState(initialTab);
  const server = app.servers.find((s) => s.id === serverId);
  const [form, setForm] = useState({ name: '', description: '', iconUrl: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (server) setForm({ name: server.name || '', description: server.description || '', iconUrl: server.iconUrl || '' });
  }, [server?.id]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/servers/${serverId}`, { method: 'PATCH', body: form });
      await app.refreshBootstrap();
      setNotice('Alterações salvas.');
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  };

  const uploadIcon = async (file) => {
    if (!file) return;
    try {
      const data = await uploadFile(file);
      setForm((current) => ({ ...current, iconUrl: data?.upload?.url || '' }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--settings" role="dialog" aria-modal="true" aria-label="Configurações do servidor">
        <header className="modal__head">
          <div>
            <h2>{server?.name || 'Servidor'}</h2>
            <p className="muted">Configurações e moderação</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="settings">
          <nav className="settings__nav">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" className={`settings__tab ${tab === key ? 'is-active' : ''}`} onClick={() => { setTab(key); setNotice(''); }}>
                {label}
              </button>
            ))}
          </nav>
          <div className="settings__body">
            {error && <div className="auth__error">{error}</div>}
            {notice && <div className="auth__ok">{notice}</div>}

            {tab === 'geral' && (
              <>
                <Field label="Nome"><input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Descrição" hint="Até 300 caracteres."><textarea className="input" rows={3} value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <Field label="Ícone"><input type="file" accept="image/*" onChange={(e) => uploadIcon(e.target.files?.[0])} /></Field>
                {form.iconUrl && <img className="settings__icon" src={form.iconUrl} alt="" />}
                <div className="settings__actions">
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>Salvar alterações</button>
                  <button type="button" className="btn btn--danger" onClick={() => app.openModal({ type: 'leaveServer', serverId })}>Sair do servidor</button>
                </div>
              </>
            )}

            {tab === 'canais' && <ChannelsTab serverId={serverId} server={server} />}
            {tab === 'cargos' && <RolesTab serverId={serverId} />}
            {tab === 'emojis' && <AssetsTab serverId={serverId} kind="emojis" />}
            {tab === 'stickers' && <AssetsTab serverId={serverId} kind="stickers" />}
            {tab === 'bans' && <BansTab serverId={serverId} />}
            {tab === 'convites' && <InvitesTab serverId={serverId} />}
            {tab === 'integracoes' && <IntegrationsTab serverId={serverId} server={server} />}
            {tab === 'auditoria' && <AuditTab serverId={serverId} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelsTab({ serverId, server }) {
  const app = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await api(`/servers/${serverId}`);
      setRows(data.server?.channels || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [serverId]);

  const rename = async (channel) => {
    const name = window.prompt('Novo nome do canal', channel.name);
    if (!name) return;
    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body: { name } });
      await app.refreshBootstrap();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (channel) => {
    if (!window.confirm(`Excluir o canal #${channel.name}?`)) return;
    try {
      await api(`/channels/${channel.id}`, { method: 'DELETE' });
      await app.refreshBootstrap();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <Spinner label="Carregando canais" />;

  return (
    <>
      {error && <div className="auth__error">{error}</div>}
      <div className="settings__actions">
        <button type="button" className="btn btn--primary" onClick={() => app.openModal({ type: 'createChannel', serverId })}>Criar canal</button>
      </div>
      <ul className="rows rows--compact">
        {rows.map((channel) => (
          <li key={channel.id} className="rows__item">
            <div className="rows__main">
              <strong>{channel.type === 'voice' ? '🔊' : '#'} {channel.name}</strong>
              <span className="muted">{channel.category || 'Sem categoria'} · {channel.type === 'voice' ? 'voz' : 'texto'}</span>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => rename(channel)}>Renomear</button>
            <button type="button" className="btn btn--sm btn--danger" onClick={() => remove(channel)}>Excluir</button>
          </li>
        ))}
        {!rows.length && <li className="muted">Nenhum canal. Crie o primeiro.</li>}
      </ul>
    </>
  );
}

function RolesTab({ serverId }) {
  const app = useApp();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ name: '', color: '#8b7cf6', permissions: 0 });

  const load = async () => {
    try {
      const data = await api(`/servers/${serverId}/roles`);
      setRoles(data.roles || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [serverId]);

  const toggleBit = (role, bit) => {
    const next = role.permissions & (1 << bit) ? role.permissions & ~(1 << bit) : role.permissions | (1 << bit);
    setRoles((current) => current.map((r) => (r.id === role.id ? { ...r, permissions: next } : r)));
  };

  const saveRole = async (role) => {
    try {
      await api(`/servers/${serverId}/roles/${role.id}`, { method: 'PATCH', body: { name: role.name, color: role.color, permissions: role.permissions } });
      app.toast('Cargo atualizado.', 'ok');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const create = async () => {
    try {
      await api(`/servers/${serverId}/roles`, { method: 'POST', body: draft });
      setDraft({ name: '', color: '#8b7cf6', permissions: 0 });
      load();
      app.toast('Cargo criado.', 'ok');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <Spinner label="Carregando cargos" />;

  return (
    <>
      {error && <div className="auth__error">{error}</div>}
      <div className="invite-row">
        <input className="input" placeholder="Nome do cargo" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="input input--color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
        <button type="button" className="btn btn--primary" disabled={!draft.name.trim()} onClick={create}>Criar cargo</button>
      </div>
      <ul className="rows">
        {roles.map((role) => (
          <li key={role.id} className="rows__item rows__item--stack">
            <div className="rows__main">
              <strong style={{ color: role.color }}>{role.name}{role.isEveryone ? ' · @everyone' : ''}</strong>
              <span className="muted">posição {role.position}</span>
            </div>
            <div className="perm-grid">
              {PERM_BITS.map(([key, label, bit]) => (
                <label key={key} className="check-row">
                  <input type="checkbox" checked={(role.permissions & (1 << bit)) !== 0} onChange={() => toggleBit(role, bit)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="settings__actions">
              <input className="input input--sm" value={role.name} onChange={(e) => setRoles((c) => c.map((r) => (r.id === role.id ? { ...r, name: e.target.value } : r)))} />
              <input className="input input--color" type="color" value={role.color} onChange={(e) => setRoles((c) => c.map((r) => (r.id === role.id ? { ...r, color: e.target.value } : r)))} />
              <button type="button" className="btn btn--sm btn--primary" onClick={() => saveRole(role)}>Salvar</button>
              {!role.isEveryone && (
                <button type="button" className="btn btn--sm btn--danger" onClick={async () => {
                  if (!window.confirm(`Excluir o cargo ${role.name}?`)) return;
                  await api(`/servers/${serverId}/roles/${role.id}`, { method: 'DELETE' });
                  load();
                }}>Excluir</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function AssetsTab({ serverId, kind }) {
  const app = useApp();
  const [data, setData] = useState({ emojis: [], stickers: [] });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const label = kind === 'emojis' ? 'emoji' : 'sticker';
  const items = kind === 'emojis' ? data.emojis : data.stickers;

  const load = async () => {
    try {
      const result = await api(`/servers/${serverId}/emojis`);
      setData({ emojis: result.emojis || [], stickers: result.stickers || [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [serverId]);

  const upload = async (file) => {
    if (!file) return;
    try {
      const result = await uploadFile(file);
      setUrl(result?.upload?.url || '');
      if (!name) setName((file.name || label).replace(/\.[^.]+$/, '').slice(0, 32));
    } catch (err) {
      setError(err.message);
    }
  };

  const create = async () => {
    try {
      await api(`/servers/${serverId}/${kind}`, { method: 'POST', body: { name, url } });
      setName('');
      setUrl('');
      load();
      app.toast(`${label === 'emoji' ? 'Emoji' : 'Sticker'} adicionado.`, 'ok');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <Spinner label="Carregando" />;

  return (
    <>
      {error && <div className="auth__error">{error}</div>}
      <div className="invite-row">
        <input className="input" placeholder={`nome do ${label}`} value={name} onChange={(e) => setName(e.target.value)} />
        <input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} />
        <button type="button" className="btn btn--primary" disabled={!name || !url} onClick={create}>Adicionar</button>
      </div>
      <div className="asset-grid">
        {items.map((item) => (
          <figure key={item.id} className="asset">
            <img src={item.url} alt={item.name} />
            <figcaption>{item.name}</figcaption>
            <button type="button" className="icon-btn" aria-label="Remover" onClick={async () => {
              await api(`/${kind}/${item.id}`, { method: 'DELETE' });
              load();
            }}>×</button>
          </figure>
        ))}
      </div>
      {!items.length && <Empty title="Nada aqui ainda">Envie uma imagem para criar o primeiro {label}.</Empty>}
    </>
  );
}

function BansTab({ serverId }) {
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await api(`/servers/${serverId}/bans`);
      setBans(data.bans || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [serverId]);

  if (loading) return <Spinner label="Carregando banimentos" />;

  return (
    <>
      {error && <div className="auth__error">{error}</div>}
      <ul className="rows rows--compact">
        {bans.map((ban) => (
          <li key={ban.userId || ban.id} className="rows__item">
            <Avatar user={ban.user || ban} size={30} />
            <div className="rows__main">
              <strong>{ban.user?.displayName || ban.displayName || ban.username}</strong>
              <span className="muted">{ban.reason || 'Sem motivo'} · {fullDate(ban.createdAt)}</span>
            </div>
            <button type="button" className="btn btn--sm" onClick={async () => {
              await api(`/servers/${serverId}/bans/${ban.userId || ban.id}`, { method: 'DELETE' });
              load();
            }}>Revogar</button>
          </li>
        ))}
        {!bans.length && <li className="muted">Nenhum membro banido.</li>}
      </ul>
    </>
  );
}

function InvitesTab({ serverId }) {
  const app = useApp();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await api(`/servers/${serverId}/invites`);
      setInvites(data.invites || []);
    } catch { /* mantém lista vazia */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [serverId]);

  if (loading) return <Spinner label="Carregando convites" />;

  return (
    <>
      <div className="settings__actions">
        <button type="button" className="btn btn--primary" onClick={() => app.openModal({ type: 'invite', serverId })}>Gerar convite</button>
      </div>
      <ul className="rows rows--compact">
        {invites.map((invite) => (
          <li key={invite.code} className="rows__item">
            <div className="rows__main">
              <strong>{invite.code}</strong>
              <span className="muted">{invite.uses || 0}{invite.maxUses ? `/${invite.maxUses}` : ''} usos</span>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => {
              navigator.clipboard?.writeText(`${window.location.origin}/?invite=${invite.code}`);
              app.toast('Link copiado.', 'ok');
            }}>Copiar</button>
            <button type="button" className="btn btn--sm btn--danger" onClick={async () => {
              await api(`/invites/${invite.code}`, { method: 'DELETE' });
              load();
            }}>Revogar</button>
          </li>
        ))}
        {!invites.length && <li className="muted">Nenhum convite ativo.</li>}
      </ul>
    </>
  );
}

function IntegrationsTab({ serverId, server }) {
  const app = useApp();
  const [bots, setBots] = useState([]);
  const [hooks, setHooks] = useState([]);
  const [owned, setOwned] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [botName, setBotName] = useState('');
  const [hookForm, setHookForm] = useState({ name: '', channelId: '' });
  const [createdHook, setCreatedHook] = useState('');
  const channels = server?.channels || [];

  const load = async () => {
    try {
      const [b, h, o] = await Promise.all([
        api(`/servers/${serverId}/bots`),
        api(`/servers/${serverId}/webhooks`),
        api('/bots'),
      ]);
      setBots(b.bots || []);
      setHooks(h.webhooks || []);
      setOwned(o.bots || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [serverId]);

  const createBot = async () => {
    try {
      await api('/bots', { method: 'POST', body: { name: botName } });
      setBotName('');
      load();
      app.toast('Bot criado.', 'ok');
    } catch (err) {
      setError(err.message);
    }
  };

  const addBot = async (botId) => {
    try {
      await api(`/servers/${serverId}/bots`, { method: 'POST', body: { botId } });
      load();
      app.toast('Bot adicionado ao servidor.', 'ok');
    } catch (err) {
      setError(err.message);
    }
  };

  const createHook = async () => {
    try {
      const data = await api(`/servers/${serverId}/webhooks`, { method: 'POST', body: hookForm });
      setCreatedHook(data?.webhook?.url ? `${window.location.origin}${data.webhook.url}` : '');
      setHookForm({ name: '', channelId: '' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <Spinner label="Carregando integrações" />;

  return (
    <>
      {error && <div className="auth__error">{error}</div>}
      <h3>Bots</h3>
      <div className="invite-row">
        <input className="input" placeholder="Nome do bot" value={botName} onChange={(e) => setBotName(e.target.value)} />
        <button type="button" className="btn btn--primary" disabled={!botName.trim()} onClick={createBot}>Criar bot</button>
      </div>
      <ul className="rows rows--compact">
        {bots.map((bot) => (
          <li key={bot.id} className="rows__item">
            <Avatar user={bot} size={28} />
            <div className="rows__main"><strong>{bot.name || bot.displayName}</strong><span className="muted">@{bot.username}</span></div>
            <button type="button" className="btn btn--sm btn--danger" onClick={async () => {
              await api(`/servers/${serverId}/bots/${bot.id}`, { method: 'DELETE' });
              load();
            }}>Remover</button>
          </li>
        ))}
        {!bots.length && <li className="muted">Nenhum bot neste servidor.</li>}
      </ul>
      {owned.length > 0 && (
        <>
          <h4>Seus bots</h4>
          <ul className="rows rows--compact">
            {owned.map((bot) => (
              <li key={bot.id} className="rows__item">
                <div className="rows__main"><strong>{bot.name || bot.displayName}</strong><span className="muted">@{bot.username}</span></div>
                <button type="button" className="btn btn--sm" onClick={() => addBot(bot.id)}>Adicionar aqui</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Webhooks</h3>
      <div className="invite-row">
        <input className="input" placeholder="Nome do webhook" value={hookForm.name} onChange={(e) => setHookForm({ ...hookForm, name: e.target.value })} />
        <select className="input" value={hookForm.channelId} onChange={(e) => setHookForm({ ...hookForm, channelId: e.target.value })}>
          <option value="">Canal…</option>
          {channels.filter((c) => c.type !== 'voice').map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
        <button type="button" className="btn btn--primary" disabled={!hookForm.channelId} onClick={createHook}>Criar</button>
      </div>
      {createdHook && (
        <div className="invite-created">
          <code>{createdHook}</code>
          <button type="button" className="btn btn--sm" onClick={() => { navigator.clipboard?.writeText(createdHook); app.toast('URL copiada.', 'ok'); }}>Copiar</button>
        </div>
      )}
      <ul className="rows rows--compact">
        {hooks.map((hook) => (
          <li key={hook.id} className="rows__item">
            <div className="rows__main"><strong>{hook.name}</strong><span className="muted">canal {hook.channelId}</span></div>
            <button type="button" className="btn btn--sm btn--danger" onClick={async () => {
              await api(`/webhooks/${hook.id}`, { method: 'DELETE' });
              load();
            }}>Excluir</button>
          </li>
        ))}
        {!hooks.length && <li className="muted">Nenhum webhook configurado.</li>}
      </ul>
    </>
  );
}

function AuditTab({ serverId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/servers/${serverId}/audit`);
        setEntries(data.entries || data.audit || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [serverId]);

  if (loading) return <Spinner label="Carregando auditoria" />;

  return (
    <>
      {error && <div className="auth__error">{error}</div>}
      <ul className="rows rows--compact">
        {entries.map((entry) => (
          <li key={entry.id} className="rows__item">
            <div className="rows__main">
              <strong>{entry.action}</strong>
              <span className="muted">{entry.actor || 'sistema'} · {entry.target || ''} · {fullDate(entry.createdAt)}</span>
            </div>
          </li>
        ))}
        {!entries.length && <li className="muted">Nenhum registro de auditoria.</li>}
      </ul>
    </>
  );
}
