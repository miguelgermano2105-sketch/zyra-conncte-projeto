import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar } from './ui.jsx';

const ICE = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

export default function VoiceRoom({ channel, server }) {
  const app = useApp();
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [remotes, setRemotes] = useState({});

  const localStream = useRef(null);
  const screenStream = useRef(null);
  const peers = useRef(new Map());
  const localVideo = useRef(null);
  const screenVideo = useRef(null);
  const joinedRef = useRef(false);

  const participants = app.voiceStates[channel.id]
    || (app.voice.channelId === channel.id ? app.voice.participants : []);

  const emitSignal = useCallback((targetId, data) => {
    app.socket.current?.emit('webrtc:signal', { channelId: channel.id, targetId, data });
  }, [app.socket, channel.id]);

  const isInitiator = (peerId) => String(app.user.id) > String(peerId);

  const offerTo = useCallback(async (peerId) => {
    const entry = peers.current.get(peerId);
    if (!entry) return;
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      emitSignal(peerId, { type: 'offer', sdp: entry.pc.localDescription });
    } catch { /* reconexão tentará novamente */ }
  }, [emitSignal]);

  const ensurePeer = useCallback((peerId, name) => {
    if (!peerId || peerId === app.user.id) return null;
    if (peers.current.has(peerId)) return peers.current.get(peerId);
    const pc = new RTCPeerConnection(ICE);
    const entry = { pc, name, stream: new MediaStream() };
    peers.current.set(peerId, entry);

    localStream.current?.getTracks().forEach((track) => pc.addTrack(track, localStream.current));
    const screenTrack = screenStream.current?.getVideoTracks?.()[0];
    if (screenTrack) pc.addTrack(screenTrack, screenStream.current);

    pc.onicecandidate = (event) => {
      if (event.candidate) emitSignal(peerId, { type: 'candidate', candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      entry.stream.addTrack(event.track);
      setRemotes((current) => ({ ...current, [peerId]: { stream: entry.stream, name: entry.name } }));
    };
    pc.onnegotiationneeded = () => {
      if (isInitiator(peerId)) offerTo(peerId);
      else emitSignal(peerId, { type: 'renegotiate' });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        peers.current.delete(peerId);
        setRemotes((current) => {
          const next = { ...current };
          delete next[peerId];
          return next;
        });
      }
    };
    return entry;
  }, [app.user.id, emitSignal, offerTo]);

  const renegotiateAll = useCallback(() => {
    for (const [peerId] of peers.current) {
      if (isInitiator(peerId)) offerTo(peerId);
      else emitSignal(peerId, { type: 'renegotiate' });
    }
  }, [emitSignal, offerTo]);

  /* sinalização recebida */
  useEffect(() => {
    const socket = app.socket.current;
    if (!socket) return undefined;

    const onSignal = async ({ channelId, fromId, fromUsername, data }) => {
      if (channelId !== channel.id || !joinedRef.current) return;
      const entry = ensurePeer(fromId, fromUsername);
      if (!entry) return;
      try {
        if (data.type === 'offer') {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          emitSignal(fromId, { type: 'answer', sdp: entry.pc.localDescription });
        } else if (data.type === 'answer') {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.type === 'candidate' && data.candidate) {
          await entry.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else if (data.type === 'renegotiate' && isInitiator(fromId)) {
          await offerTo(fromId);
        }
      } catch { /* descarta SDP inválido */ }
    };

    socket.on('webrtc:signal', onSignal);
    return () => socket.off('webrtc:signal', onSignal);
  }, [app.socket, channel.id, ensurePeer, emitSignal, offerTo]);

  /* novos participantes */
  useEffect(() => {
    if (!joined) return;
    const present = new Set(participants.map((peer) => peer.userId));
    for (const peer of participants) {
      if (peer.userId !== app.user.id) ensurePeer(peer.userId, peer.name);
    }
    for (const [peerId, entry] of peers.current) {
      if (!present.has(peerId)) {
        entry.pc.close();
        peers.current.delete(peerId);
        setRemotes((current) => {
          const next = { ...current };
          delete next[peerId];
          return next;
        });
      }
    }
  }, [participants, joined, ensurePeer, app.user.id]);

  const attachLocal = (node) => {
    localVideo.current = node;
    if (node && localStream.current) node.srcObject = localStream.current;
  };

  const join = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStream.current = stream;
      joinedRef.current = true;
      setJoined(true);
      app.socket.current?.emit('voice:join', { channelId: channel.id });
      setTimeout(renegotiateAll, 400);
    } catch {
      setError('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const leave = useCallback(() => {
    joinedRef.current = false;
    setJoined(false);
    app.socket.current?.emit('voice:leave', { channelId: channel.id });
    for (const [, entry] of peers.current) entry.pc.close();
    peers.current.clear();
    setRemotes({});
    localStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    screenStream.current = null;
    setVideoOn(false);
    setSharing(false);
    setMuted(false);
  }, [app.socket, channel.id]);

  useEffect(() => () => {
    if (joinedRef.current) leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStream.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    app.socket.current?.emit('voice:update', { channelId: channel.id, muted: next });
  };

  const toggleVideo = async () => {
    if (!localStream.current) return;
    if (videoOn) {
      localStream.current.getVideoTracks().forEach((track) => {
        track.stop();
        localStream.current.removeTrack(track);
      });
      setVideoOn(false);
      renegotiateAll();
      return;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = cam.getVideoTracks()[0];
      localStream.current.addTrack(track);
      setVideoOn(true);
      if (localVideo.current) localVideo.current.srcObject = localStream.current;
      renegotiateAll();
    } catch {
      setError('Não foi possível acessar a câmera.');
    }
  };

  const toggleShare = async () => {
    if (sharing) {
      screenStream.current?.getTracks().forEach((track) => track.stop());
      screenStream.current = null;
      setSharing(false);
      app.socket.current?.emit('voice:update', { channelId: channel.id, screen: false });
      renegotiateAll();
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStream.current = screen;
      setSharing(true);
      screen.getVideoTracks()[0].addEventListener('ended', () => {
        screenStream.current = null;
        setSharing(false);
        app.socket.current?.emit('voice:update', { channelId: channel.id, screen: false });
      });
      app.socket.current?.emit('voice:update', { channelId: channel.id, screen: true });
      renegotiateAll();
    } catch {
      setError('Compartilhamento de tela cancelado ou não suportado neste navegador.');
    }
  };

  return (
    <div className="voice">
      <h2 className="voice__title">🔊 {channel.name}</h2>
      <p className="voice__sub">
        {channel.topic || 'Chamada de voz do servidor. O áudio é transmitido diretamente entre os participantes (WebRTC).'}
      </p>
      {error && <div className="auth__error">{error}</div>}

      {!joined ? (
        <>
          <button type="button" className="btn btn--primary" onClick={join}>Entrar na chamada</button>
          {participants.length > 0 && (
            <div className="voice__peers">
              {participants.map((peer) => (
                <span key={peer.userId} className="chip">
                  <Avatar user={{ displayName: peer.name, id: peer.userId }} size={20} /> {peer.name}
                  {peer.muted ? ' 🔇' : ''}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="voice__stage">
            <div className={`voice__tile ${videoOn ? 'is-speaking' : ''}`}>
              <video ref={attachLocal} autoPlay playsInline muted />
              <span>Você {muted ? '· microfone desativado' : ''}</span>
            </div>
            {Object.entries(remotes).map(([peerId, remote]) => (
              <div key={peerId} className="voice__tile">
                <video
                  autoPlay playsInline
                  ref={(node) => { if (node) node.srcObject = remote.stream; }}
                />
                <span>{remote.name || 'Participante'}</span>
              </div>
            ))}
          </div>

          {sharing && (
            <video
              className="voice__screen"
              autoPlay
              playsInline
              muted
              ref={(node) => { screenVideo.current = node; if (node && screenStream.current) node.srcObject = screenStream.current; }}
            />
          )}

          <div className="voice__controls">
            <button type="button" className={`btn ${muted ? 'btn--danger' : ''}`} onClick={toggleMute}>
              {muted ? '🔇 Microfone desativado' : '🎤 Microfone ativo'}
            </button>
            <button type="button" className={`btn ${videoOn ? 'btn--primary' : ''}`} onClick={toggleVideo}>
              {videoOn ? '📹 Câmera ligada' : '📷 Ligar câmera'}
            </button>
            <button type="button" className={`btn ${sharing ? 'btn--primary' : ''}`} onClick={toggleShare}>
              {sharing ? '🖥 Compartilhando' : '🖥 Compartilhar tela'}
            </button>
            <button type="button" className="btn btn--danger" onClick={leave}>Sair da chamada</button>
          </div>
          <p className="voice__sub">{participants.length} participante(s) nesta chamada · servidor {server?.name}</p>
        </>
      )}
    </div>
  );
}
