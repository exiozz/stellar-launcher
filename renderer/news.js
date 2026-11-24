'use strict';
// "Nouveautés" page: official Roblox announcements (DevForum), rising games, newest catalog items.
// Loaded after app.js; shares its globals.

const NEWS_FEED = 'https://devforum.roblox.com/c/updates/announcements/36.json';
const news = { posts: null, at: 0 };

const newsImg = (u) => {
  const url = typeof u === 'string' && u.startsWith('//') ? 'https:' + u : u;
  return typeof url === 'string' && /^https:\/\/devforum-uploads\.s3\.dualstack\.us-east-2\.amazonaws\.com\//.test(url) ? url : '';
};
const plain = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '';
const newsDate = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days < 1) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
};

async function fetchNews() {
  if (news.posts && Date.now() - news.at < 10 * 60e3) return news.posts;
  const r = await orbit.api(NEWS_FEED);
  news.posts = (r.topic_list?.topics || [])
    .filter((t) => !t.pinned && t.id && t.slug)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 12)
    .map((t) => ({
      id: Number(t.id),
      url: `https://devforum.roblox.com/t/${encodeURIComponent(decodeURIComponent(t.slug))}/${Number(t.id)}`,
      title: plain(t.title),
      excerpt: plain(t.excerpt).replace(/\s+/g, ' ').trim(),
      img: newsImg(t.image_url),
      at: t.created_at,
      likes: t.like_count || 0,
    }));
  news.at = Date.now();
  return news.posts;
}

function markNewsSeen() {
  try {
    if (news.posts?.[0]) localStorage.setItem('newsSeen', news.posts[0].at);
  } catch {
    /* badge is cosmetic */
  }
  $('#newsBadge').hidden = true;
}

async function renderNews() {
  const box = $('#newsPosts');
  if (!news.posts) box.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:240px"></div>').join('');
  try {
    const posts = await fetchNews();
    box.innerHTML = posts
      .map(
        (p) => `<button class="news-card" type="button" data-news="${esc(p.url)}">
          <div class="news-thumb">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" />` : '<span>ROBLOX</span>'}</div>
          <div class="news-body">
            <div class="news-date">${esc(newsDate(p.at))}${p.likes ? ` · ♥ ${fmt(p.likes)}` : ''}</div>
            <div class="news-title">${esc(p.title)}</div>
            <div class="news-excerpt">${esc(p.excerpt)}</div>
          </div>
        </button>`
      )
      .join('');
    markNewsSeen();
  } catch (e) {
    box.innerHTML = `<div class="empty">Impossible de charger les annonces (${esc(errMsg(e))}).</div>`;
  }

  // rising games, from the same explore sorts as the home page
  try {
    const sorts = await getSorts();
    const rising = sorts['up-and-coming'] || sorts['top-trending'];
    $('#newsGames').innerHTML = rising ? renderRow('Jeux qui montent', rising.games.slice(0, 30).map(fromExplore), rising.sortDisplayName) : '';
    loadGameIcons($('#newsGames'));
  } catch {
    $('#newsGames').innerHTML = '';
  }

  // newest catalog items (catalog sort 3 = "Récents")
  try {
    const r = await orbit.api('https://catalog.roblox.com/v2/search/items/details?Category=1&SortType=3&Limit=30');
    const items = (r.data || []).slice(0, 18);
    $('#newsItems').innerHTML = items.map(itemCard).join('') || '<div class="empty">Rien de neuf pour le moment.</div>';
    loadItemThumbs($('#newsItems'), items);
  } catch (e) {
    $('#newsItems').innerHTML = `<div class="empty">Catalogue indisponible (${esc(errMsg(e))}).</div>`;
  }
}

$('#newsPosts').addEventListener('click', (e) => {
  const c = e.target.closest('[data-news]');
  if (c) orbit.openUrl(c.dataset.news).catch((err) => toast(errMsg(err), 'error'));
});
$('#newsMoreItems').addEventListener('click', () => {
  cat.sort = 3;
  $('#catalogSort').value = '3';
  showView('catalog');
  searchCatalog(true);
});

// Red dot on the rail when Roblox posted something since the last visit.
setTimeout(async () => {
  try {
    const posts = await fetchNews();
    let seen = null;
    try {
      seen = localStorage.getItem('newsSeen');
    } catch {
      /* ignore */
    }
    if (posts[0] && (!seen || Date.parse(posts[0].at) > Date.parse(seen))) $('#newsBadge').hidden = false;
  } catch {
    /* offline */
  }
}, 6000);
