/* ============================================================
   KT 텔나라네트웍 괴산점 개통장부 — Service Worker
   ------------------------------------------------------------
   · 앱 셸(index.html, manifest, 아이콘)을 미리 캐싱 → 두 번째 실행부터 즉시 뜸
   · 화면(HTML)은 네트워크 우선 → 수정한 파일이 바로 반영됨
   · 나머지 리소스는 캐시 우선 + 뒤에서 갱신(stale-while-revalidate)
   · 새 버전이 설치되면 skipWaiting + clients.claim 으로 즉시 교체
   · v78(#18345): 화면(HTML)은 HTTP 캐시까지 건너뛰고(cache:'no-store') 항상 네트워크에서 새로 받는다.
     GitHub Pages 가 index.html 을 10분(max-age=600) 캐시해, 예전에는 한참 전 화면이 떠서
     "수정이 바로 반영되지 않는다"고 느껴졌다. 오프라인일 때만 캐시로 넘어간다.
   · 데이터는 localStorage 에 있으므로 캐시를 지워도 장부는 그대로입니다.

   배포 후 파일을 수정했다면 아래 CACHE_VERSION 을 올려 주세요.
   ============================================================ */

var CACHE_VERSION = 'v85-g1';
var CACHE_PREFIX = 'kt-goesan-ledger-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
var SHEETJS_CACHE = CACHE_PREFIX + 'sheetjs';

/* 오프라인에서도 앱이 뜨는 데 필요한 최소 파일 (앱 셸) */
var APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

/* 엑셀(SheetJS) CDN — 한 번 받아두면 오프라인에서도 .xlsx 내보내기가 됩니다 */
var SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

/* ---------------- install ---------------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      var cache = await caches.open(CACHE_NAME);
      // 파일 하나가 없어도 설치는 끝나도록 개별 처리
      await Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
            return null;
          });
        })
      );
      // SheetJS 는 실패해도 앱 동작에 지장 없음 (CSV 폴백)
      try {
        var sheet = await caches.open(SHEETJS_CACHE);
        if (!(await sheet.match(SHEETJS_URL))) {
          var res = await fetch(new Request(SHEETJS_URL, { mode: 'cors' }));
          if (res && res.ok) await sheet.put(SHEETJS_URL, res);
        }
      } catch (err) {
        /* 오프라인 설치 등 — 무시 */
      }
      await self.skipWaiting();
    })()
  );
});

/* ---------------- activate ---------------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      var keys = await caches.keys();
      await Promise.all(
        keys.map(function (key) {
          if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME && key !== SHEETJS_CACHE) {
            return caches.delete(key);
          }
          return null;
        })
      );
      await self.clients.claim();
    })()
  );
});

/* ---------------- fetch ---------------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }

  // SheetJS CDN: 캐시 우선
  if (url.href === SHEETJS_URL) {
    event.respondWith(cacheFirst(req, SHEETJS_CACHE));
    return;
  }

  // 외부 도메인은 그대로 네트워크로
  if (url.origin !== self.location.origin) return;

  // 화면 이동·index.html·'/' 요청: 네트워크 우선(HTTP 캐시 무시 → 항상 최신) → 실패 시 캐시
  if (isDocRequest(req, url)) {
    event.respondWith(networkFirstPage(req));
    return;
  }

  // 그 밖의 앱 파일: 캐시 우선 + 뒤에서 갱신
  event.respondWith(staleWhileRevalidate(req));
});

/* ---------------- strategies ---------------- */
/* 화면(HTML) 요청인지 — 주소 이동 / index.html / '/' / text/html */
function isDocRequest(req, url) {
  if (req.mode === 'navigate') return true;
  if (url.pathname === '/' || /\/index\.html$/.test(url.pathname)) return true;
  return (req.headers.get('accept') || '').indexOf('text/html') !== -1;
}

async function networkFirstPage(req) {
  var cache = await caches.open(CACHE_NAME);
  try {
    var fresh = await fetch(req, { cache: 'no-store' });
    if (fresh && fresh.ok) {
      cache.put('./index.html', fresh.clone()).catch(function () {});
      return fresh;
    }
    throw new Error('bad status ' + (fresh && fresh.status));
  } catch (err) {
    var hit =
      (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));
    if (hit) return hit;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>오프라인</title>' +
        '<body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#334155">' +
        '<h1 style="font-size:18px">오프라인 상태입니다</h1>' +
        '<p style="font-size:14px;line-height:1.7">인터넷에 연결한 뒤 다시 열어 주세요.<br>장부 데이터는 이 기기에 그대로 저장되어 있습니다.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function staleWhileRevalidate(req) {
  var cache = await caches.open(CACHE_NAME);
  var cached = await cache.match(req, { ignoreSearch: true });
  var network = fetch(req)
    .then(function (res) {
      if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
      return res;
    })
    .catch(function () {
      return null;
    });
  return cached || (await network) || Response.error();
}

async function cacheFirst(req, cacheName) {
  var cache = await caches.open(cacheName);
  var hit = await cache.match(req);
  if (hit) return hit;
  var res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
  return res;
}

/* ---------------- 메시지 (즉시 업데이트 요청 등) ---------------- */
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------------- v84 — 알람함 상단 알림을 누르면 앱으로 ---------------- */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    (async function () {
      var list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf(self.location.origin) === 0) {
          try { await c.focus(); return; } catch (e) {}
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow('./');
    })()
  );
});
