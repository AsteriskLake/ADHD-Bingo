/**
 * ADHD Bingo — Service Worker
 * 策略：Cache First（离线优先）
 * 更新：修改 CACHE_VERSION 版本号即可触发重新缓存
 */

const CACHE_VERSION = 'adhd-bingo-v1';

// ── 预缓存资源（App Shell）─────────────────────────────────────────────────────
// 这些是应用离线运行所需的最核心资源。
// 外部字体/CDN 资源采用「运行时缓存」策略（见下方），不在此列。
const PRECACHE_URLS = [
  './',          // index.html（根路径）
  './index.html' // 明确缓存 index.html
];

// ── Install：预缓存 App Shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // 跳过等待，立即激活新 SW（首次安装时很关键）
      return self.skipWaiting();
    })
  );
});

// ── Activate：清理旧版本缓存 ───────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_VERSION)
          .map(name => caches.delete(name))
      );
    }).then(() => {
      // 立即接管所有已打开的页面
      return self.clients.claim();
    })
  );
});

// ── Fetch：Cache First，回退到网络 ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 只处理 GET 请求
  if (req.method !== 'GET') return;

  // Google Analytics / GTM：直接走网络，失败时静默忽略（不影响离线体验）
  if (
    url.hostname === 'www.googletagmanager.com' ||
    url.hostname === 'www.google-analytics.com'
  ) {
    event.respondWith(
      fetch(req).catch(() => new Response('', { status: 204 }))
    );
    return;
  }

  // Google Fonts CSS：Network First（优先拿最新），离线回退缓存
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(networkFirstThenCache(req, 'adhd-bingo-fonts'));
    return;
  }

  // Google Fonts 字体文件：Cache First（字体文件几乎不变，长期缓存）
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstThenNetwork(req, 'adhd-bingo-fonts'));
    return;
  }

  // 同源资源（主应用 HTML/CSS/JS）：Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstThenNetwork(req, CACHE_VERSION));
    return;
  }
});

// ── 策略函数 ───────────────────────────────────────────────────────────────────

/**
 * Cache First：先查缓存，命中则直接返回；未命中则请求网络并缓存结果。
 * 适用于：主应用资源、字体文件
 */
async function cacheFirstThenNetwork(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // 只缓存成功的响应（状态码 200，且非 opaque 响应的基本检查）
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 网络彻底不通时，返回离线兜底页（即 index.html）
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    return new Response('离线状态，无法加载资源。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
  }
}

/**
 * Network First：先尝试网络（带超时），超时或失败则回退缓存。
 * 适用于：需要尽量保持新鲜度的资源（字体 CSS）
 */
async function networkFirstThenCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, 4000);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('', { status: 503 });
  }
}

/** 带超时的 fetch 封装（毫秒） */
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    fetch(request).then(res => { clearTimeout(timer); resolve(res); })
                  .catch(err => { clearTimeout(timer); reject(err); });
  });
}
