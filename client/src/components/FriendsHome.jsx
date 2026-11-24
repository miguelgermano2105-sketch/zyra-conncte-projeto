import React, { useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar, Empty } from './ui.jsx';

export default function FriendsHome() {
  const app = useApp();
  const [tab, setTab] = useState('todos');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const { friends, incoming, outgoing, blocked } = app.friends;

  const pendingCount = incoming.length;

  const refresh = async () => {
    const data = await app.request('/friends');
    if (data) app.dispatch({ type: 'friends', friends: data });
  };

  const act = async (path, options, successMessage) => {
    setBusy(true);
    try {
      await app.request(path, options);
      await refresh();
      if (successMessage) app.toast(successMessage, 'success');
    } catch (error) {
      app.toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendRequest = async (event) => {
    event.preventDefault();
    const value = username.trim().replace(/^@/, '');
    if (!value) return;
    setBusy(true);
    try {
      const data = await app.request('/friends/request', { method: 'POST', body: { username: value } });
      setUsername('');
      await refresh();
      app.toast(data?.status === 'accepted' ? 'Pedido aceito automaticamente: agora são amigos.' : 'Pedido de amizade enviado.', 'success');
    } catch (error) {
      app.toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openDm = async (userId) => {
    try {
      const data = await app.request('/dms', { method: 'POST', body: { userId } });
      if (data?.dm) {
        app.dispatch({ type: 'dm:upsert', dm: data.dm });
        app.selectDm(data.dm.id);
      }
    } catch (error) {
      app.toast(error.message, 'error');
    }
  };

  return (
    <div className="friends">
      <div className="friends__tabs">
        <button type="button" className={`friends__tab ${tab === 'todos' ? 'is-active' : ''}`} onClick={() => setTab('todos')}>
          Todos
        </button>
        <button type="button" className={`friends__tab ${tab === 'pendentes' ? 'is-active' : ''}`} onClick={() => setTab('pendentes')}>
          Pendentes {pendingCount > 0 && <b>{pendingCount}</b>}
        </button>
        <button type="button" className={`friends__tab ${tab === 'adicionar' ? 'is-active' : ''}`} onClick={() => setTab('adicionar')}>
          Adicionar amigo
        </button>
        <button type="button" className={`friends__tab ${tab === 'bloqueados' ? 'is-active' : ''}`} onClick={() => setTab('bloqueados')}>
          Bloqueados
        </button>
      </div>

      {tab === 'adicionar' && (
        <form className="friends__add" onSubmit={sendRequest}>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Nome de usuário (ex.: zyra.dev)"
            aria-label="Nome de usuário"
          />
          <button type="submit" className="btn btn--primary" disabled={busy || !username.trim()}>
            Enviar pedido
          </button>
        </form>
      )}

      {tab === 'todos' && (
        <>
          <div className="friends__section-title">Amigos — {friends.length}</div>
          {friends.length === 0 && (
            <Empty title="Nenhum amigo ainda">Use “Adicionar amigo” para enviar um pedido pelo nome de usuário.</Empty>
          )}
          {friends.map((friend) => (
            <div key={friend.id} className="friend">
              <Avatar user={friend} size={38} status={app.online.includes(friend.id) ? 'online' : 'offline'} />
              <div className="friend__text">
                <strong>{friend.displayName || friend.username}</strong>
                <small>@{friend.username} · {app.online.includes(friend.id) ? 'online' : 'offline'}</small>
              </div>
              <div className="friend__actions">
                <button type="button" className="icon-btn" title="Mensagem" onClick={() => openDm(friend.id)}>💬</button>
                <button
                  type="button" className="icon-btn" title="Remover amigo"
                  onClick={() => act(`/friends/${friend.id}`, { method: 'DELETE' }, 'Amigo removido.')}
                >✕</button>
                <button
                  type="button" className="icon-btn" title="Bloquear"
                  onClick={() => act('/friends/block', { method: 'POST', body: { userId: friend.id } }, 'Usuário bloqueado.')}
                >⛔</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'pendentes' && (
        <>
          <div className="friends__section-title">Recebidos — {incoming.length}</div>
          {incoming.length === 0 && <Empty title="Nada por aqui">Nenhum pedido de amizade recebido.</Empty>}
          {incoming.map((person) => (
            <div key={person.id} className="friend">
              <Avatar user={person} size={38} />
              <div className="friend__text">
                <strong>{person.displayName || person.username}</strong>
                <small>@{person.username} quer ser seu amigo</small>
              </div>
              <div className="friend__actions">
                <button
                  type="button" className="btn btn--primary" disabled={busy}
                  onClick={() => act('/friends/accept', { method: 'POST', body: { userId: person.id } }, 'Pedido aceito.')}
                >Aceitar</button>
                <button
                  type="button" className="btn btn--ghost" disabled={busy}
                  onClick={() => act('/friends/decline', { method: 'POST', body: { userId: person.id } }, 'Pedido recusado.')}
                >Recusar</button>
              </div>
            </div>
          ))}

          <div className="friends__section-title">Enviados — {outgoing.length}</div>
          {outgoing.length === 0 && <Empty title="Sem pedidos enviados">Você não tem pedidos pendentes de saída.</Empty>}
          {outgoing.map((person) => (
            <div key={person.id} className="friend">
              <Avatar user={person} size={38} />
              <div className="friend__text">
                <strong>{person.displayName || person.username}</strong>
                <small>Aguardando resposta</small>
              </div>
              <div className="friend__actions">
                <button
                  type="button" className="btn btn--ghost" disabled={busy}
                  onClick={() => act(`/friends/${person.id}`, { method: 'DELETE' }, 'Pedido cancelado.')}
                >Cancelar</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'bloqueados' && (
        <>
          <div className="friends__section-title">Bloqueados — {blocked.length}</div>
          {blocked.length === 0 && <Empty title="Ninguém bloqueado">Você não bloqueou nenhum usuário.</Empty>}
          {blocked.map((person) => (
            <div key={person.id} className="friend">
              <Avatar user={person} size={38} />
              <div className="friend__text">
                <strong>{person.displayName || person.username}</strong>
                <small>@{person.username}</small>
              </div>
              <div className="friend__actions">
                <button
                  type="button" className="btn btn--ghost" disabled={busy}
                  onClick={() => act(`/friends/block/${person.id}`, { method: 'DELETE' }, 'Usuário desbloqueado.')}
                >Desbloquear</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
