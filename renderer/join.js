'use strict';
// Join by ID: a player (@pseudo or user id) or a server (job id), plus search shortcuts
// in the top search bar: gameid:, placeid:, userid:, @pseudo, join:@pseudo, jobid:… placeid:…
// Loaded after app.js; shares its globals.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function userFrom(text) {
  const t = String(text).trim().replace(/^@/, '');
  if (/^\d{1,15}$/.test(t)) {
    const u = await orbit.api(`https://users.roblox.com/v1/users/${t}`);
    return { id: u.id, name: u.name, displayName: u.displayName };
  }
  if (!/^[A-Za-z0-9_]{3,20}$/.test(t)) throw new Error('Pseudo invalide');
  const r = await orbit.api('https://users.roblox.com/v1/usernames/users', { method: 'POST', body: { usernames: [t], excludeBannedUsers: true } });
  const u = r.data?.[0];
  if (!u) throw new Error(`Aucun joueur « ${t} »`);
  return { id: u.id, name: u.name, displayName: u.displayName };
}

async function universeOfPlace(placeId) {
  const r = await orbit.api(`https://apis.roblox.com/universes/v1/places/${Number(placeId)}/universe`);
  if (!r.universeId) throw new Error('Jeu introuvable');
  return r.universeId;
}

/** Follow a player into their server (Roblox checks their "who can join me" setting). */
async function joinPlayer(text) {
  const u = await userFrom(text);
  // where are they? (only visible if they allow it)
  let where = '';
  try {
    const p = await orbit.api('https://presence.roblox.com/v1/presence/users', { method: 'POST', body: { userIds: [u.id] }, auth: !!activeAccount() });
    const x = p.userPresences?.[0];
    if (x?.userPresenceType !== 2) toast(`${u.displayName} n'a pas l'air en jeu (ou cache sa partie). On essaie quand même…`);
    where = x?.lastLocation || '';
  } catch {
    /* presence is a bonus */
  }
  await joinFriend({ id: u.id, displayName: u.displayName, location: where });
}

/** Join an exact server of a game. */
async function joinServer(placeId, jobId) {
  if (!UUID_RE.test(jobId)) throw new Error("ID de serveur invalide (format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)");
  const universeId = await universeOfPlace(placeId).catch(() => null);
  await play({ placeId: Number(placeId), universeId, name: currentGame?.placeId === Number(placeId) ? currentGame.name : 'Serveur' }, jobId);
}

// ---------- in the game window: "Rejoindre…" field ----------
$('#gmJoinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#gmJoinInput').value.trim();
  if (!v) return;
  try {
    if (UUID_RE.test(v)) {
      if (!currentGame?.placeId) throw new Error('Jeu pas encore chargé');
      await joinServer(currentGame.placeId, v);
    } else {
      await joinPlayer(v);
    }
  } catch (err) {
    toast(errMsg(err), 'error');
  }
});

// ---------- search shortcuts ----------
const SEARCH_HELP = 'gameid:123 · placeid:123 · userid:123 · @pseudo · join:@pseudo · jobid:ID placeid:123';

async function smartSearch(q) {
  const tokens = Object.fromEntries(
    [...q.matchAll(/(\w+):\s*(@?[\w-]+)/g)].map((m) => [m[1].toLowerCase(), m[2]])
  );
  if (tokens.jobid) {
    const place = tokens.placeid || currentGame?.placeId;
    if (!place) throw new Error('Ajoute placeid:… avec jobid:');
    await joinServer(place, tokens.jobid);
    return true;
  }
  if (tokens.join) {
    await joinPlayer(tokens.join);
    return true;
  }
  if (tokens.gameid || tokens.universeid) {
    openGame(Number(tokens.gameid || tokens.universeid));
    return true;
  }
  if (tokens.placeid) {
    openGame(await universeOfPlace(tokens.placeid));
    return true;
  }
  if (tokens.userid || tokens.user) {
    const u = await userFrom(tokens.userid || tokens.user);
    showPlayer(u.name);
    return true;
  }
  if (/^@[A-Za-z0-9_]{3,20}$/.test(q)) {
    showPlayer(q.slice(1));
    return true;
  }
  return false;
}

// runs before the normal "search a game" handler and stops it for shortcuts
$('#quickSearch').addEventListener(
  'submit',
  async (e) => {
    const q = $('#quickSearchInput').value.trim();
    if (!/^@|\b\w+:/.test(q)) return; // a plain game search
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      if (!(await smartSearch(q))) toast(`Raccourcis : ${SEARCH_HELP}`);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  },
  true
);
$('#quickSearchInput').title = `Raccourcis : ${SEARCH_HELP}`;
$('#quickSearchInput').placeholder = 'Rechercher un jeu, @pseudo, gameid:…';
