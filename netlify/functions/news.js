const https = require('https');

// RSS-ленты по теме КМНС
const FEEDS = [
  'https://raipon.info/feed/',
  'https://news.google.com/rss/search?q=%D0%9A%D0%9C%D0%9D%D0%A1+%D0%BA%D0%BE%D1%80%D0%B5%D0%BD%D0%BD%D1%8B%D0%B5+%D0%BD%D0%B0%D1%80%D0%BE%D0%B4%D1%8B+%D1%81%D0%B5%D0%B2%D0%B5%D1%80%D0%B0&hl=ru&gl=RU&ceid=RU:ru',
  'https://news.google.com/rss/search?q=%D0%BD%D0%B0%D1%80%D0%BE%D0%B4%D1%8B+%D1%81%D0%B5%D0%B2%D0%B5%D1%80%D0%B0+%D1%8F%D0%BC%D0%B0%D0%BB+%D1%82%D0%B0%D0%B9%D0%BC%D1%8B%D1%80+%D1%8F%D0%BA%D1%83%D1%82%D0%B8%D1%8F&hl=ru&gl=RU&ceid=RU:ru',
];

exports.handler = async function () {
  let items = [];

  for (const url of FEEDS) {
    try {
      const xml = await fetchRaw(url);
      items = items.concat(parseRSS(xml));
    } catch (e) {
      console.error('Feed error:', url, e.message);
    }
  }

  // Дедупликация по заголовку
  const seen = new Set();
  const news = items
    .filter(i => {
      if (!i.title || seen.has(i.title)) return false;
      seen.add(i.title);
      return true;
    })
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
    .slice(0, 12);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=1800', // кеш 30 минут
    },
    body: JSON.stringify(news),
  };
};

// Загрузка URL с поддержкой редиректов
function fetchRaw(url, depth = 0) {
  if (depth > 3) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EtnoNovostiBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    }, res => {
      // Обрабатываем редиректы
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchRaw(res.headers.location, depth + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Парсинг RSS XML в массив объектов
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRe.exec(xml)) !== null) {
    const s = match[1];

    const getTag = tag => {
      // Поддерживаем CDATA и обычный текст
      const re = new RegExp(
        `<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, 'i'
      );
      const m = s.match(re);
      if (!m) return '';
      return m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    };

    const title = getTag('title');
    if (!title) continue;

    // Google News прячет ссылку в <link> или <guid>
    let link = getTag('link');
    if (!link) {
      const guidMatch = s.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
      if (guidMatch) link = guidMatch[1].trim();
    }

    items.push({
      title,
      description: getTag('description').slice(0, 300),
      link,
      pubDate: getTag('pubDate'),
      author: getTag('author') || getTag('dc:creator') || '',
    });
  }

  return items;
}
