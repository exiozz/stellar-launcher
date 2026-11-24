'use strict';
// Roblox chat (apis.roblox.com/platform-chat-api) — loaded after app.js, shares its globals.
// Response shapes are parsed defensively (snake_case and camelCase both accepted).

const CHAT_API = 'https://apis.roblox.com/platform-chat-api/v1/';
const chat = { convos: [], open: null, msgs: [], users: new Map(), timer: null, unreadTimer: null, loading: false };

const pickKey = (o, ...keys) => {
  for (const k of keys) if (o && o[k] != null) return o[k];
  return undefined;
};

function normMsg(m) {
  if (!m) return null;
  return {
    id: String(pickKey(m, 'id', 'message_id', 'messageId') ?? ''),
    text: String(pickKey(m, 'content', 'text', 'body') ?? ''),
    sender: Number(pickKey(m, 'sender_user_id', 'senderUserId', 'sender_target_id', 'senderTargetId', 'sender_id') || 0),
    at: Date.parse(pickKey(m, 'created_at', 'createdAt', 'sent') || 0) || 0,
  };
}

function normConvo(c) {
  const parts = pickKey(c, 'participant_user_ids', 'participantUserIds') ||
    (pickKey(c, 'participants', 'members') || []).map((p) => (typeof p === 'object' ? pickKey(p, 'target_id', 'targetId', 'user_id', 'userId', 'id') : p));
  const msgs = pickKey(c, 'messages') || [];
  const title = pickKey(c, 'name', 'title');
  return {
    id: String(pickKey(c, 'id', 'conversation_id', 'conversationId') ?? ''),
    type: String(pickKey(c, 'type', 'conversation_type', 'conversationType') || ''),
    title: typeof title === 'string' ? title : pickKey(title || {}, 'title_for_viewer', 'titleForViewer') || '',
    users: (parts || []).map(Number).filter(Boolean),
    unread: Number(pickKey(c, 'unread_message_count', 'unreadMessageCount') || 0),
    last: normMsg(msgs[0] || pickKey(c, 'last_message', 'lastMessage')),
    updated: Date.parse(pickKey(c, 'updated_at', 'updatedAt', 'last_updated', 'lastUpdated') || 0) || 0,
  };
}

const chatCall = (path, body) =>
  orbit.api(CHAT_API + path, body ? { method: 'POST', body, auth: true } : { auth: true });

function chatUnavailable(e) {
  const m = errMsg(e);
  if (/HTTP 40[13]/.test(m)) return "Le chat Roblox n'est pas disponible pour ce compte (âge, vérification ou paramètres de confidentialité).";
  return 'Impossible de charger le chat : ' + m;
}

async function knowUsers(ids) {
  const acc = activeAccount();
  if (acc) chat.users.set(acc.id, { name: acc.name, displayName: acc.displayName });
  for (const f of friendsList) chat.users.set(f.id, { name: f.name, displayName: friendName(f) });
  const missing = [...new Set(ids)].filter((id) => id && !chat.users.has(id));
  for (const part of chunk(missing, 100)) {
    try {
      const r = await orbit.api('https://users.roblox.com/v1/users', { method: 'POST', body: { userIds: part, excludeBannedUsers: false } });
      for (const u of r.data || []) chat.users.set(u.id, { name: u.name, displayName: u.displayName });
    } catch {
      /* names are cosmetic */
    }
  }
  await loadHeadshots([...new Set(ids)].filter(Boolean));
}

const userLabel = (id) => {
  const f = friendsList.find((x) => x.id === id);
  if (f) return friendName(f);
  const u = chat.users.get(id);
  return u?.displayName || u?.name || 'Joueur';
};
const otherUser = (c) => c.users.find((id) => id !== activeAccount()?.id) || c.users[0];
const convoTitle = (c) => c.title || (c.users.length > 2 ? c.users.filter((id) => id !== activeAccount()?.id).map(userLabel).join(', ') : userLabel(otherUser(c)));
const headImg = (id, cls = 'avatar') => `<img class="${cls}" data-head="${id}" src="${headCache.get(String(id)) || BLANK}" alt="" />`;

function updateMsgBadge() {
  const n = chat.convos.reduce((s, c) => s + (c.id === chat.open && document.hasFocus() ? 0 : c.unread), 0);
  const b = $('#msgBadge');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : n;
}

async function fetchConvos() {
  const r = await chatCall('get-user-conversations?cursor=&pageSize=50&include_user_data=true');
  const list = (pickKey(r, 'conversations', 'data') || []).map(normConvo).filter((c) => c.id);
  list.sort((a, b) => (b.last?.at || b.updated) - (a.last?.at || a.updated));
  chat.convos = list;
  updateMsgBadge();
  return list;
}

function renderConvos() {
  const box = $('#chatConvos');
  if (!chat.convos.length) {
    box.innerHTML = '<div class="side-empty">Aucune conversation. Clique sur « Nouveau » pour écrire à un ami.</div>';
    return;
  }
  box.innerHTML = chat.convos
    .map((c) => {
      const lead = otherUser(c);
      return `<button class="convo ${c.id === chat.open ? 'active' : ''}" data-convo="${esc(c.id)}">
        ${headImg(lead)}
        <span class="convo-meta"><span class="convo-name">${esc(convoTitle(c))}</span>
        <span class="convo-last">${esc(c.last?.text || '')}</span></span>
        ${c.unread ? `<span class="unread">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
      </button>`;
    })
    .join('');
  fillHeadshots(box);
}

async function openMessages() {
  clearInterval(chat.timer);
  const acc = activeAccount();
  if (!acc) {
    $('#chatConvos').innerHTML = `<div class="side-empty">Connecte ton compte Roblox pour discuter avec tes amis.<br /><br /><button class="btn primary small" data-menu="add">Se connecter</button></div>`;
    showChatPane(null);
    return;
  }
  if (!chat.convos.length) $('#chatConvos').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:44px;margin:4px 0"></div>').join('');
  try {
    await fetchConvos();
    await knowUsers(chat.convos.flatMap((c) => c.users));
    renderConvos();
    if (chat.open) loadMessages();
    else showChatPane(null);
  } catch (e) {
    $('#chatConvos').innerHTML = `<div class="side-empty">${esc(chatUnavailable(e))}</div>`;
    return;
  }
  chat.timer = setInterval(chatTick, 6000);
}

function closeMessages() {
  clearInterval(chat.timer);
  chat.timer = null;
}

async function chatTick() {
  if (document.hidden) return;
  try {
    await fetchConvos();
    await knowUsers(chat.convos.flatMap((c) => c.users));
    renderConvos();
    if (chat.open) await loadMessages(true);
  } catch {
    /* transient: retry next tick */
  }
}

function showChatPane(c) {
  const form = $('#chatForm');
  if (!c) {
    $('#chatHead').innerHTML = '<span class="muted">Sélectionne une conversation</span>';
    $('#chatMsgs').innerHTML = '';
    form.hidden = true;
    return;
  }
  $('#chatHead').innerHTML = `${headImg(otherUser(c))}<span>${esc(convoTitle(c))}</span>`;
  fillHeadshots($('#chatHead'));
  form.hidden = false;
  $('#chatText').placeholder = `Envoyer un message à ${convoTitle(c)}`;
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const msgTime = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return (new Date().toDateString() === d.toDateString() ? "Aujourd'hui à " : dayFmt.format(d) + ' à ') + timeFmt.format(d);
};

function renderMessages() {
  const box = $('#chatMsgs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  let prev = null;
  box.innerHTML = chat.msgs
    .map((m) => {
      const cont = prev && prev.sender === m.sender && m.at - prev.at < 5 * 60e3;
      prev = m;
      if (cont) return `<div class="msg cont"><div class="msg-text">${esc(m.text)}</div></div>`;
      return `<div class="msg">${headImg(m.sender)}<div class="msg-head"><b>${esc(userLabel(m.sender))}</b><time>${msgTime(m.at)}</time></div><div class="msg-text">${esc(m.text)}</div></div>`;
    })
    .join('') || '<div class="side-empty">Aucun message pour le moment. Dis bonjour !</div>';
  fillHeadshots(box);
  if (atBottom || !box.dataset.convo || box.dataset.convo !== chat.open) box.scrollTop = box.scrollHeight;
  box.dataset.convo = chat.open || '';
}

async function loadMessages(quiet = false) {
  const id = chat.open;
  const c = chat.convos.find((x) => x.id === id);
  if (!c) return;
  showChatPane(c);
  if (!quiet) $('#chatMsgs').innerHTML = '<div class="side-empty">Chargement…</div>';
  try {
    const r = await chatCall(`get-conversation-messages?conversation_id=${encodeURIComponent(id)}&cursor=&pageSize=50`);
    if (chat.open !== id) return;
    const msgs = (pickKey(r, 'messages', 'data') || []).map(normMsg).filter((m) => m && m.text);
    msgs.sort((a, b) => a.at - b.at);
    const pending = chat.msgs.filter((m) => m.pending && !msgs.some((x) => x.text === m.text && x.sender === m.sender));
    chat.msgs = [...msgs, ...pending];
    await knowUsers(msgs.map((m) => m.sender));
    renderMessages();
    if (c.unread) {
      c.unread = 0;
      updateMsgBadge();
      renderConvos();
      chatCall('mark-conversations', { conversation_ids: [id] }).catch(() => {});
    }
  } catch (e) {
    if (!quiet) $('#chatMsgs').innerHTML = `<div class="side-empty">${esc(chatUnavailable(e))}</div>`;
  }
}

function selectConvo(id) {
  if (chat.open !== id) chat.msgs = [];
  chat.open = id;
  renderConvos();
  loadMessages();
}

$('#chatConvos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-convo]');
  if (b) selectConvo(b.dataset.convo);
});

$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatText');
  const text = input.value.trim();
  if (!text || !chat.open) return;
  const acc = activeAccount();
  input.value = '';
  const local = { id: 'local-' + Date.now(), text, sender: acc?.id || 0, at: Date.now(), pending: true };
  chat.msgs.push(local);
  renderMessages();
  $('#chatMsgs').scrollTop = $('#chatMsgs').scrollHeight;
  try {
    await chatCall('send-messages', { conversation_id: chat.open, messages: [{ content: text }] });
    setTimeout(() => loadMessages(true), 600);
  } catch (err) {
    chat.msgs = chat.msgs.filter((m) => m !== local);
    renderMessages();
    input.value = text;
    toast("Message non envoyé : " + (/HTTP 40[13]/.test(errMsg(err)) ? 'Roblox a refusé (filtre ou paramètres de confidentialité).' : errMsg(err)), 'error');
  }
});

// New conversation: pick a friend.
$('#chatNew').addEventListener('click', () => {
  if (!activeAccount()) return toast('Connecte-toi d’abord', 'error');
  chat.open = null;
  renderConvos();
  $('#chatForm').hidden = true;
  $('#chatHead').innerHTML = '<span>Nouvelle conversation</span>';
  const friends = [...friendsList].sort((a, b) => friendName(a).localeCompare(friendName(b)));
  $('#chatMsgs').innerHTML = friends.length
    ? `<div class="chat-pick">${friends.map((f) => `<button class="convo" data-chatfriend="${f.id}">${headImg(f.id)}<span class="convo-meta"><span class="convo-name">${esc(friendName(f))}</span><span class="convo-last">@${esc(f.name)}</span></span></button>`).join('')}</div>`
    : '<div class="side-empty">Tes amis apparaîtront ici une fois chargés.</div>';
  fillHeadshots($('#chatMsgs'));
});

async function chatWith(userId) {
  userId = Number(userId);
  if (!chat.convos.length) await fetchConvos().catch(() => {});
  const existing = chat.convos.find((c) => c.users.length <= 2 && c.users.includes(userId) && !/group/i.test(c.type));
  if (existing) return selectConvo(existing.id);
  try {
    const r = await chatCall('create-conversations', { conversations: [{ type: 'one_to_one', participant_user_ids: [userId] }] });
    const created = (pickKey(r, 'conversations', 'data') || []).map(normConvo).find((c) => c.id);
    await fetchConvos();
    if (created && !chat.convos.some((c) => c.id === created.id)) chat.convos.unshift(created);
    await knowUsers([userId]);
    const target = created || chat.convos.find((c) => c.users.includes(userId));
    if (!target) throw new Error('conversation introuvable');
    selectConvo(target.id);
  } catch (e) {
    toast(chatUnavailable(e), 'error');
  }
}

$('#chatMsgs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chatfriend]');
  if (b) chatWith(b.dataset.chatfriend);
});

// Unread badge in the rail, even when the Messages page is closed.
async function pollUnread() {
  if (!activeAccount() || chat.timer || document.hidden) return;
  try {
    await fetchConvos();
  } catch {
    /* chat may be unavailable for this account */
  }
}
setTimeout(pollUnread, 4000);
chat.unreadTimer = setInterval(pollUnread, 30000);
