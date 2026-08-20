/* ============================================================
   حلقات المندق — عامل الخدمة (Service Worker)
   يتيح عمل التطبيق بلا إنترنت ويجعل الفتحات التالية أسرع.
   لا يُعدَّل يدويًا إلا برفع رقم النسخة أدناه عند كل تحديث.
   ============================================================ */
const SW_VERSION = 'hq-v1';
const SHELL_CACHE = SW_VERSION + '-shell';   /* الملفات الأساسية */
const QURAN_CACHE = 'hq-quran';              /* المصحف — يبقى بين التحديثات */
const FONT_CACHE  = 'hq-fonts';              /* الخطوط */

/* ما يُحمَّل فور التثبيت */
const SHELL = ['./', './index.html', './icon.png', './HafsSmart.woff2'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) {
      /* addAll يفشل كليًا إن سقط ملف واحد، فنضيف كل ملف على حدة */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    })
  );
});

/* حذف نسخ القشرة القديمة فقط — المصحف والخطوط تبقى */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k === SHELL_CACHE || k === QURAN_CACHE || k === FONT_CACHE) return null;
        if (k.indexOf('hq-') !== 0) return null;
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* حفظ نسخة في مخزن محدَّد */
function putIn(cacheName, req, res) {
  if (!res || !res.ok) return res;
  const copy = res.clone();
  caches.open(cacheName).then(function (c) { c.put(req, copy); });
  return res;
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = (url.origin === self.location.origin);

  /* ١) ملفات المصحف: من الذاكرة أولاً (أسرع بكثير) ثم الشبكة */
  if (sameOrigin && (/\/quran\/\d+\.json$/.test(url.pathname) || /quran_hafs\.json$/.test(url.pathname))) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) { return putIn(QURAN_CACHE, req, res); });
      })
    );
    return;
  }

  /* ٢) الخطوط (محلية أو من Google): من الذاكرة أولاً */
  if (/\.(woff2?|ttf|otf)$/.test(url.pathname) || url.host.indexOf('fonts.g') === 0 ||
      url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { return putIn(FONT_CACHE, req, res); })
                          .catch(function () { return hit; });
      })
    );
    return;
  }

  /* ٣) صفحة التطبيق: الشبكة أولاً ليصل التحديث، والذاكرة عند انقطاعها */
  if (req.mode === 'navigate' || (sameOrigin && /\.html$/.test(url.pathname)) || url.pathname === '/') {
    e.respondWith(
      fetch(req).then(function (res) { return putIn(SHELL_CACHE, req, res); })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html') || caches.match('./');
          });
        })
    );
    return;
  }

  /* ٤) بقية ملفات الموقع (الأيقونة وغيرها): الذاكرة ثم الشبكة */
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { return putIn(SHELL_CACHE, req, res); });
      })
    );
    return;
  }

  /* ٥) الطلبات الخارجية (Firebase وغيرها): تمرّ للشبكة كما هي بلا تخزين */
});

/* تحميل المصحف كاملاً بطلب من الصفحة، مع تقرير التقدّم */
self.addEventListener('message', function (e) {
  const d = e.data || {};
  if (d.type !== 'CACHE_QURAN') return;

  e.waitUntil((async function () {
    const cache = await caches.open(QURAN_CACHE);
    let done = 0, failed = 0;
    const total = 114;
    for (let s = 1; s <= total; s++) {
      const url = './quran/' + s + '.json';
      try {
        const hit = await cache.match(url);
        if (!hit) {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) await cache.put(url, res.clone()); else failed++;
        }
      } catch (err) { failed++; }
      done++;
      if (done % 3 === 0 || done === total) {
        const cs = await self.clients.matchAll();
        cs.forEach(function (c) { c.postMessage({ type: 'QURAN_PROGRESS', done: done, total: total, failed: failed }); });
      }
    }
    const cs = await self.clients.matchAll();
    cs.forEach(function (c) { c.postMessage({ type: 'QURAN_DONE', total: total, failed: failed }); });
  })());
});
