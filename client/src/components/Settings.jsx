import React, { useEffect, useState } from 'react';
import { api, uploadFile } from '../lib/api.js';
import { useApp } from '../store.jsx';
import { fullDate } from '../lib/format.js';
import { Avatar, Field, Modal, Spinner, Toggle } from './ui.jsx';

const STATUSES = [['online', 'Disponível'], ['idle', 'Ausente'], ['dnd', 'Não perturbe'], ['invisible', 'Invisível']];

export default function Settings({ onClose }) {
  const app = useApp();
  const user = app.user;
  const [tab, setTab] = useState('perfil');
  const [form, setForm] = useState({
    displayName: user.displayName || '',
    bio: user.bio || '',
    customStatus: user.customStatus || '',
    bannerColor: user.bannerColor || '#8b7cf6',
    status: user.status || 'online',
    avatarUrl: user.avatarUrl || '',
  });
  const [prefs, setPrefs] = useState(() => ({ compact: false, calm: false, ...(user.preferences || {}) }));
  const [sessions, setSessions] = useState([]);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.dataset.compact = prefs.compact ? '1' : '';
    document.documentElement.dataset.calm = prefs.calm ? '1' : '';
  }, [prefs.compact, prefs.calm]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const data = await api('/users/me/sessions');
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    if (tab === 'sessoes' && !sessions.length) loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const patch = async (body, message = 'Alterações salvas.') => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/users/me', { method: 'PATCH', body });
      if (data?.user) app.dispatch({ type: 'user', user: data.user });
      app.toast(message, 'ok');
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = () => patch({
    displayName: form.displayName,
    bio: form.bio,
    customStatus: form.customStatus,
    bannerColor: form.bannerColor,
    status: form.status,
  }, 'Perfil atualizado.');

  const changeAvatar = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const data = await uploadFile(file);
      const url = data?.upload?.url;
      if (!url) throw new Error('Falha no upload da imagem.');
      setForm((current) => ({ ...current, avatarUrl: url }));
      await patch({ avatarUrl: url }, 'Avatar atualizado.');
    } catch (err) {
      setError(err.message || 'Não foi possível enviar a imagem.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/users/me/password', { method: 'PUT', body: passwords });
      setPasswords({ currentPassword: '', newPassword: '' });
      app.toast('Senha alterada. Outras sessões foram encerradas.', 'ok');
      loadSessions();
    } catch (err) {
      setError(err.message || 'Não foi possível alterar a senha.');
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async (next) => {
    setPrefs(next);
    await patch({ preferences: next }, 'Preferências salvas.');
  };

  return (
    <Modal title="Configurações" subtitle={`@${user.username}`} onClose={onClose} wide
      footer={<button type="button" className="btn btn--primary" onClick={onClose}>Concluir</button>}
    >
      <div className="settings">
        <nav className="settings__nav">
          {[['perfil', 'Meu perfil'], ['seguranca', 'Senha e segurança'], ['sessoes', 'Sessões ativas'], ['aparencia', 'Aparência'], ['sobre', 'Sobre']].map(([id, label]) => (
            <button key={id} type="button" className={`settings__tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>

        <div className="settings__body">
          {error && <div className="auth__error">{error}</div>}

          {tab === 'perfil' && (
            <>
              <div className="profile-preview" style={{ background: form.bannerColor }}>
                <Avatar user={{ ...user, avatarUrl: form.avatarUrl }} size={64} status={form.status} />
                <div>
                  <strong>{form.displayName || user.username}</strong>
                  <span>@{user.username}</span>
                </div>
              </div>
              <Field label="Foto de perfil" hint="JPG, PNG, GIF ou WebP até 10 MB.">
                <input type="file" accept="image/*" onChange={(e) => changeAvatar(e.target.files?.[0])} />
              </Field>
              <Field label="Nome de exibição">
                <input className="input" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </Field>
              <Field label="Sobre mim" hint={`${form.bio.length}/300`}>
                <textarea className="input" rows={3} maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
              </Field>
              <Field label="Status personalizado" hint="Aparece ao lado do seu nome.">
                <input className="input" maxLength={80} value={form.customStatus} onChange={(e) => setForm({ ...form, customStatus: e.target.value })} />
              </Field>
              <Field label="Cor do perfil">
                <input type="color" value={form.bannerColor} onChange={(e) => setForm({ ...form, bannerColor: e.target.value })} />
              </Field>
              <Field label="Status de presença">
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={saveProfile}>Salvar perfil</button>
            </>
          )}

          {tab === 'seguranca' && (
            <>
              <Field label="Senha atual">
                <input className="input" type="password" autoComplete="current-password" value={passwords.currentPassword}
                  onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} />
              </Field>
              <Field label="Nova senha" hint="Mínimo de 8 caracteres. Outras sessões serão encerradas.">
                <input className="input" type="password" autoComplete="new-password" value={passwords.newPassword}
                  onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} />
              </Field>
              <button type="button" className="btn btn--primary" disabled={busy || !passwords.currentPassword || !passwords.newPassword} onClick={changePassword}>
                Alterar senha
              </button>
              <p className="muted">As senhas são armazenadas com hash e nunca aparecem em texto puro. O acesso usa token de sessão revogável.</p>
            </>
          )}

          {tab === 'sessoes' && (
            <>
              {loadingSessions ? <Spinner label="Carregando sessões" /> : (
                <ul className="rows rows--compact">
                  {sessions.map((s) => (
                    <li key={s.id} className="rows__item">
                      <div className="rows__main">
                        <strong>{s.current ? 'Este dispositivo' : (s.device || s.userAgent || 'Sessão')}</strong>
                        <span className="muted">Iniciada em {fullDate(s.createdAt)}{s.ip ? ` · ${s.ip}` : ''}</span>
                      </div>
                      {!s.current && (
                        <button type="button" className="btn btn--sm btn--danger"
                          onClick={async () => { await api(`/users/me/sessions/${s.id}`, { method: 'DELETE' }); loadSessions(); }}>
                          Encerrar
                        </button>
                      )}
                    </li>
                  ))}
                  {!sessions.length && <li className="muted">Nenhuma sessão registrada.</li>}
                </ul>
              )}
              <button type="button" className="btn" onClick={async () => {
                await api('/users/me/sessions', { method: 'DELETE' });
                app.toast('Todas as outras sessões foram encerradas.', 'ok');
                loadSessions();
              }}>Encerrar todas as outras sessões</button>
            </>
          )}

          {tab === 'aparencia' && (
            <>
              <div className="toggle-row">
                <div><strong>Densidade compacta</strong><span className="muted">Mais mensagens visíveis na tela.</span></div>
                <Toggle checked={Boolean(prefs.compact)} onChange={(v) => savePrefs({ ...prefs, compact: v })} label="Densidade compacta" />
              </div>
              <div className="toggle-row">
                <div><strong>Reduzir animações</strong><span className="muted">Menos movimento na interface.</span></div>
                <Toggle checked={Boolean(prefs.calm)} onChange={(v) => savePrefs({ ...prefs, calm: v })} label="Reduzir animações" />
              </div>
              <p className="muted">O tema escuro ZYRA é o padrão da plataforma e se adapta a celular e computador.</p>
            </>
          )}

          {tab === 'sobre' && (
            <>
              <h3>ZYRA CONNECT</h3>
              <p className="muted">
                Plataforma de comunidades e comunicação em tempo real. Todos os recursos são gratuitos:
                sem planos pagos, assinaturas ou recursos bloqueados.
              </p>
              <ul className="rows rows--compact">
                <li className="rows__item"><div className="rows__main"><strong>Versão</strong><span className="muted">{app.version || '1.0.0'}</span></div></li>
                <li className="rows__item"><div className="rows__main"><strong>Conta criada em</strong><span className="muted">{fullDate(user.createdAt)}</span></div></li>
                <li className="rows__item"><div className="rows__main"><strong>Identificador</strong><span className="muted">{user.id}</span></div></li>
              </ul>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
