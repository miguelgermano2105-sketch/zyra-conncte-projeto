import React, { useEffect } from 'react';
import { api, getToken, setToken } from './lib/api.js';
import { useApp } from './store.jsx';
import Auth from './components/Auth.jsx';
import ServerRail from './components/ServerRail.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainArea from './components/MainArea.jsx';
import MemberList from './components/MemberList.jsx';
import Modals from './components/Modals.jsx';
import { Spinner, Toasts } from './components/ui.jsx';

export default function App() {
  const app = useApp();
  const { dispatch, toast, refreshBootstrap } = app;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        dispatch({ type: 'ready' });
        return;
      }
      try {
        const data = await api('/me');
        if (!alive) return;
        dispatch({
          type: 'boot',
          payload: {
            user: data.user, servers: data.servers, dms: data.dms, friends: data.friends,
            notifications: data.notifications, unread: data.unread,
          },
        });
      } catch {
        setToken('');
        if (alive) dispatch({ type: 'ready' });
      }
    })();
    return () => { alive = false; };
  }, [dispatch]);

  /* convite por link: /?invite=CODIGO */
  useEffect(() => {
    if (!app.user) return;
    const code = new URLSearchParams(window.location.search).get('invite');
    if (!code) return;
    (async () => {
      try {
        const data = await api(`/invites/${code}`, { method: 'POST' });
        await refreshBootstrap();
        if (data?.server) {
          dispatch({ type: 'server:upsert', server: data.server });
          dispatch({ type: 'view', view: { kind: 'server', id: data.server.id } });
          toast(`Você entrou em ${data.server.name}.`, 'success');
        }
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        window.history.replaceState({}, '', window.location.pathname);
      }
    })();
  }, [app.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app.ready) {
    return <div className="boot"><Spinner label="Iniciando ZYRA" /></div>;
  }

  if (!app.user) return <Auth />;

  const showMembers = app.view.kind === 'server' && app.memberListOpen;

  return (
    <div className="shell">
      <div className={`nav ${app.drawer ? 'is-open' : ''}`}>
        <ServerRail />
        <Sidebar />
      </div>
      {app.drawer && (
        <button
          type="button" className="drawer-backdrop" aria-label="Fechar menu"
          onClick={() => dispatch({ type: 'drawer', open: false })}
        />
      )}
      <MainArea />
      {showMembers && <MemberList />}
      <Toasts toasts={app.toasts} onClose={(id) => dispatch({ type: 'toast:drop', id })} />
      <Modals />
    </div>
  );
}
