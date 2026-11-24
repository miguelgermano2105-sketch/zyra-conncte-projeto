import React, { useState } from 'react';
import { api, setToken } from '../lib/api.js';
import { useApp } from '../store.jsx';

const Brand = () => (
  <div className="auth__brand">
    <svg viewBox="0 0 128 128" width="56" height="56" aria-hidden="true">
      <defs>
        <linearGradient id="zg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cff" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M64 10 108 35v58L64 118 20 93V35z" fill="none" stroke="url(#zg)" strokeWidth="6" strokeLinejoin="round" />
      <path d="M42 42h44L54 86h34" fill="none" stroke="url(#zg)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <div>
      <h1>ZYRA <span>CONNECT</span></h1>
      <p>Comunidades, voz e vídeo em tempo real.</p>
    </div>
  </div>
);

export default function Auth() {
  const { dispatch, toast } = useApp();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = mode === 'login'
        ? { login: form.username.trim(), password: form.password }
        : {
          username: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
          displayName: form.displayName.trim() || form.username.trim(),
        };
      const data = await api(mode === 'login' ? '/login' : '/register', { method: 'POST', body: payload });
      setToken(data.token);
      dispatch({
        type: 'boot',
        payload: {
          user: data.user, servers: data.servers, dms: data.dms, friends: data.friends,
          notifications: data.notifications, unread: data.unread,
        },
      });
      if (data.firstAdmin) toast('Conta criada como administradora da plataforma.', 'success');
      else toast('Bem-vindo à ZYRA CONNECT.', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth__aside">
        <Brand />
        <ul className="auth__features">
          <li><strong>Servidores e canais</strong><span>Texto, voz, vídeo e compartilhamento de tela.</span></li>
          <li><strong>Cargos e permissões</strong><span>Controle fino de quem faz o quê, por canal.</span></li>
          <li><strong>Amigos e conversas</strong><span>Mensagens diretas, grupos e notificações em tempo real.</span></li>
          <li><strong>Bots, webhooks e moderação</strong><span>Integrações reais com token e painel administrativo.</span></li>
        </ul>
        <p className="auth__foot">Todos os recursos são gratuitos. Sem planos pagos.</p>
      </aside>

      <main className="auth__panel">
        <form className="auth__form" onSubmit={submit}>
          <div className="auth__mobilebrand"><Brand /></div>
          <div className="auth__tabs">
            <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); }}>
              Entrar
            </button>
            <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(''); }}>
              Criar conta
            </button>
          </div>

          {mode === 'register' && (
            <>
              <label className="field">
                <span>Nome de usuário</span>
                <input
                  className="input" value={form.username} onChange={update('username')}
                  placeholder="ex: zyra_dev" autoComplete="username" required minLength={3} maxLength={24}
                />
              </label>
              <label className="field">
                <span>Nome de exibição</span>
                <input
                  className="input" value={form.displayName} onChange={update('displayName')}
                  placeholder="Como você quer ser chamado" maxLength={40}
                />
              </label>
              <label className="field">
                <span>E-mail</span>
                <input
                  className="input" type="email" value={form.email} onChange={update('email')}
                  placeholder="voce@exemplo.com" autoComplete="email" required
                />
              </label>
            </>
          )}

          {mode === 'login' && (
            <label className="field">
              <span>Usuário ou e-mail</span>
              <input
                className="input" value={form.username} onChange={update('username')}
                placeholder="usuário ou e-mail" autoComplete="username" required
              />
            </label>
          )}

          <label className="field">
            <span>Senha</span>
            <input
              className="input" type="password" value={form.password} onChange={update('password')}
              placeholder="mínimo de 8 caracteres" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required minLength={8}
            />
          </label>

          {error && <p className="auth__error" role="alert">{error}</p>}

          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar na ZYRA' : 'Criar minha conta'}
          </button>

          <p className="auth__hint">
            {mode === 'login'
              ? 'Ainda não tem conta? Use a aba "Criar conta".'
              : 'A primeira conta criada administra a plataforma.'}
          </p>
        </form>
      </main>
    </div>
  );
}
