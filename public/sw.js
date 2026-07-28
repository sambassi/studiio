const CACHE_NAME = 'studiio-v3';
const STATIC_ASSETS = [
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
];

// Une reponse n'est stockable dans l'API Cache que si :
//  - la requete est un GET (Cache.put rejette les autres methodes)
//  - le status est exactement 200 (206 Partial Content est refuse par Cache.put :
//    "Partial response (status code 206) is unsupported")
//  - le type n'est ni 'opaque' (no-cors, status 0) ni 'opaqueredirect'
function isCacheable(request, response) {
  if (!request || request.method !== 'GET') return false;
  if (!response) return false;
  if (response.status !== 200) return false;
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return false;
  return true;
}

// Stockage defensif : on ne clone/pose en cache que si c'est autorise,
// et on avale les erreurs pour ne jamais casser la reponse reseau.
function putInCache(request, response) {
  if (!isCacheable(request, response)) return;
  const clone = response.clone();
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, clone))
    .catch(() => {});
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate event - clean up ALL old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests from our origin
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // NEVER intercept navigation requests or API calls — let the browser handle them directly
  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    return;
  }

  // NEVER intercept media : le Calendrier telecharge le meme fichier en
  // streaming (<video src>) ET en blob (fetch) puis bascule le src sur le
  // blob. La bascule annule la requete en vol ; le SW voyait un fetch rejete
  // et fabriquait un « 408 » visible en console alors que rien n'avait
  // echoue. Ces reponses sont de toute facon incachables (206 Partial).
  // Le proxy MinIO gere correctement les Range : on le laisse faire.
  if (
    url.pathname.startsWith('/storage/') ||
    request.destination === 'video' ||
    request.destination === 'audio' ||
    request.headers.has('range')
  ) {
    return;
  }

  // Cache-first ONLY for static icon assets
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          putInCache(request, response);
          return response;
        });
      })
    );
    return;
  }

  // For everything else (JS, CSS, images) — network-first, no offline fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        putInCache(request, response);
        return response;
      })
      .catch((err) => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Pas de reponse fabriquee : un « 408 » invente masquait la vraie
          // cause (souvent une simple annulation) et polluait la console.
          // On relaie l'echec reseau reel au navigateur.
          throw err;
        });
      })
  );
});
