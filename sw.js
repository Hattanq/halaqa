/* ============================================================
   حلقات المندق — عامل الخدمة (Service Worker)
   يتيح عمل التطبيق بلا إنترنت ويجعل الفتحات التالية أسرع.
   لا يُعدَّل يدويًا إلا برفع رقم النسخة أدناه عند كل تحديث.
   ============================================================ */
const SW_VERSION = 'hq-v3';
const SHELL_CACHE = SW_VERSION + '-shell';   /* الملفات الأساسية */
const QURAN_CACHE = 'hq-quran';              /* المصحف — يبقى بين التحديثات */
const FONT_CACHE  = 'hq-fonts';              /* الخطوط */

/* ما يُحمَّل فور التثبيت */
const SHELL = ['./', './index.html', './icon.png', './HafsSmart.woff2'];

/* ورقة أنماط خطوط Google المستخدمة في التطبيق */
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Cairo:wght@300;400;500;600;700;900&family=Aref+Ruqaa:wght@400;700&display=swap';

/* تحميل ورقة الأنماط وكل ملفات الخطوط (woff2) التي تشير إليها */
async function cacheFonts() {
  const cache = await caches.open(FONT_CACHE);
  try {
    const res = await fetch(FONT_CSS, { mode: 'cors', cache: 'reload' });
    if (!res || !res.ok) return false;
    await cache.put(FONT_CSS, res.clone());
    const css = await res.text();
    const urls = (css.match(/https:\/\/[^)"']+\.woff2?/g) || []);
    const uniq = urls.filter(function (u, i) { return urls.indexOf(u) === i; });
    await Promise.all(uniq.map(async function (u) {
      try {
        const hit = await cache.match(u);
        if (hit) return;
        const r = await fetch(u, { mode: 'cors', cache: 'reload' });
        if (r && r.ok) await cache.put(u, r.clone());
      } catch (e) {}
    }));
    /* الخط المحلي للمصحف */
    try {
      const hf = await fetch('./HafsSmart.woff2', { cache: 'reload' });
      if (hf && hf.ok) await cache.put('./HafsSmart.woff2', hf.clone());
    } catch (e) {}
    return true;
  } catch (e) { return false; }
}

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) {
      /* addAll يفشل كليًا إن سقط ملف واحد، فنضيف كل ملف على حدة */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return cacheFonts().catch(function () {}); })
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
  if (/\.(woff2?|ttf|otf)$/.test(url.pathname) ||
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

/* تحميل المصحف كاملاً بطلب من الصفحة، مع تقرير التقدّم.
   يدعم الحالتين: ملف لكل سورة (quran/N.json) أو الملف الشامل (quran_hafs.json) */
self.addEventListener('message', function (e) {
  const d = e.data || {};
  if (d.type !== 'CACHE_QURAN') return;

  e.waitUntil((async function () {
    const cache = await caches.open(QURAN_CACHE);
    await cacheFonts().catch(function () {});   /* الخطوط أولاً لتثبت الواجهة بلا إنترنت */

    function report(type, extra) {
      return self.clients.matchAll().then(function (cs) {
        cs.forEach(function (c) { c.postMessage(Object.assign({ type: type }, extra || {})); });
      });
    }

    /* هل توجد ملفات السور المنفصلة؟ نجرّب أول سورة */
    let perSurah = false;
    try {
      const probe = await fetch('./quran/1.json', { cache: 'reload' });
      if (probe.ok) { perSurah = true; await cache.put('./quran/1.json', probe.clone()); }
    } catch (err) { perSurah = false; }

    /* الحالة (أ): ملف لكل سورة */
    if (perSurah) {
      const total = 114;
      let done = 1, failed = 0;
      await report('QURAN_PROGRESS', { done: done, total: total });
      for (let n = 2; n <= total; n++) {
        try {
          const hit = await cache.match('./quran/' + n + '.json');
          if (!hit) {
            const res = await fetch('./quran/' + n + '.json', { cache: 'reload' });
            if (res.ok) await cache.put('./quran/' + n + '.json', res.clone()); else failed++;
          }
        } catch (err) { failed++; }
        done++;
        if (done % 3 === 0 || done === total) await report('QURAN_PROGRESS', { done: done, total: total });
      }
      await report('QURAN_DONE', { total: total, failed: failed, mode: 'split' });
      return;
    }

    /* الحالة (ب): الملف الشامل — وهو المستخدَم في هذا الموقع */
    await report('QURAN_PROGRESS', { done: 1, total: 3 });
    try {
      const res = await fetch('./quran_hafs.json', { cache: 'reload' });
      await report('QURAN_PROGRESS', { done: 2, total: 3 });
      if (res.ok) {
        await cache.put('./quran_hafs.json', res.clone());
        await report('QURAN_PROGRESS', { done: 3, total: 3 });
        await report('QURAN_DONE', { total: 3, failed: 0, mode: 'full' });
      } else {
        await report('QURAN_DONE', { total: 3, failed: 1, mode: 'full' });
      }
    } catch (err) {
      await report('QURAN_DONE', { total: 3, failed: 1, mode: 'full' });
    }
  })());
});
