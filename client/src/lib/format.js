export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function timeOf(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Hoje';
  if (same(d, yesterday)) return 'Ontem';
  return `${String(d.getDate()).padStart(2, '0')} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

export function relative(ts) {
  if (!ts) return 'agora';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} d`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

export function fullDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function initials(name = '?') {
  const clean = String(name).trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s_.-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const PALETTE = ['#6d5efc', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#818cf8', '#fb7185', '#2dd4bf'];
export function colorFor(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return PALETTE[hash % PALETTE.length];
}

export function groupMessages(messages) {
  const groups = [];
  let lastDay = null;
  for (const message of messages) {
    const day = new Date(message.createdAt).toDateString();
    if (day !== lastDay) {
      groups.push({ kind: 'day', key: `day-${day}-${message.id}`, label: dayLabel(message.createdAt) });
      lastDay = day;
    }
    const previous = groups[groups.length - 1];
    const compact = previous && previous.kind === 'msg'
      && previous.author.id === message.author.id
      && message.createdAt - previous.lastAt < 5 * 60_000
      && !message.replyTo;
    if (compact) {
      previous.items.push(message);
      previous.lastAt = message.createdAt;
    } else {
      groups.push({
        kind: 'msg', key: `msg-${message.id}`, author: message.author,
        createdAt: message.createdAt, lastAt: message.createdAt, items: [message],
      });
    }
  }
  return groups;
}

export const STATUS_LABEL = {
  online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline', invisible: 'Invisível',
};

export function fileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function slugChannel(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_ ]/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 32);
}
