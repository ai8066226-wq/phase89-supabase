// تخزين ملفات التطبيق العامة فقط؛ لا تُحفظ استجابات الحسابات أو واجهات البيانات.
const CACHE = 'masar-static-v127';
const CORE=["./","./index.html","./driver.html","./admin.html","./services.html","./masar-motion.css?v=127","./masar-motion.js?v=127","./masar-glow-3d.css?v=127","./masar-glow-3d.js?v=127","./masar-nav.js?v=127","./first-run.css?v=124","./first-run.js?v=124","./iraq-governorates.js?v=117","./portal.css?v=85","./app.js?v=124","./supabase-compat.js?v=120","./driver.js?v=124","./admin.js?v=120","./services.js?v=124","./device-binding.js?v=120","./service-themes.js?v=85","./pwa.js?v=125","./precise-location.js?v=85","./app-dialogs.js?v=117","./native-notifications.js?v=117","./karwa-icon-192.png","./karwa-icon-512.png","./manifest.webmanifest","./karwa-icon.svg","./service-themes-manifest.json?v=85","./theme-ac.webp?v=85","./theme-bakery.webp?v=85","./theme-cafe.webp?v=85","./theme-carwash.webp?v=85","./theme-cleaning.webp?v=85","./theme-clinic.webp?v=85","./theme-delivery.webp?v=85","./theme-dessert.webp?v=85","./theme-electrical.webp?v=85","./theme-fastfood.webp?v=85","./theme-fitness.webp?v=85","./theme-grocery.webp?v=85","./theme-maintenance.webp?v=85","./theme-parcel.webp?v=85","./theme-pest.webp?v=85","./theme-pets.webp?v=85","./theme-pharmacy.webp?v=85","./theme-pizza.webp?v=85","./theme-plumbing.webp?v=85","./theme-retail.webp?v=85","./theme-salon.webp?v=85","./theme-spa.webp?v=85","./theme-taxi.webp?v=85","./theme-travel.webp?v=85","./service-image-library.js?v=89","./service-library/barber.webp?v=89","./service-library/biryani.webp?v=89","./service-library/burger.webp?v=89","./service-library/car-repair.webp?v=89","./service-library/coffee.webp?v=89","./service-library/dairy.webp?v=89","./service-library/decor.webp?v=89","./service-library/delivery.webp?v=89","./service-library/desserts.webp?v=89","./service-library/eggs.webp?v=89","./service-library/electrical.webp?v=89","./service-library/falafel-plate.webp?v=89","./service-library/falafel-wrap.webp?v=89","./service-library/fitness.webp?v=89","./service-library/fries.webp?v=89","./service-library/fruit.webp?v=89","./service-library/gardening.webp?v=89","./service-library/grilled-chicken.webp?v=89","./service-library/grilled-fish.webp?v=89","./service-library/home-cleaning.webp?v=89","./service-library/ice-cream.webp?v=89","./service-library/kebab.webp?v=89","./service-library/kunafa.webp?v=89","./service-library/laundry.webp?v=89","./service-library/mango-juice.webp?v=89","./service-library/meat-shawarma.webp?v=89","./service-library/medical.webp?v=89","./service-library/orange-juice.webp?v=89","./service-library/pasta.webp?v=89","./service-library/pastries.webp?v=89","./service-library/pet-care.webp?v=89","./service-library/photography.webp?v=89","./service-library/pizza.webp?v=89","./service-library/plumbing.webp?v=89","./service-library/salad.webp?v=89","./service-library/samosa.webp?v=89","./service-library/sandwich.webp?v=89","./service-library/shawarma.webp?v=89","./service-library/soft-drink.webp?v=89","./service-library/soup.webp?v=89","./service-library/tailoring.webp?v=89","./service-library/tea.webp?v=89","./service-library/tutoring.webp?v=89","./service-library/vegetables.webp?v=89","./service-library/water.webp?v=89","./privacy.html","./delete-account.html","./delete-account.js?v=123","./amrni-design.css?v=118","./driver-offers.css?v=119","./monthly-subscription.js?v=120","./monthly-subscription.css?v=120","./native-notifications.css?v=81"];
const STATIC_PATHS = new Set(CORE.map(file => new URL(file, self.registration.scope).pathname));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(CORE.map(file => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key =>
      key !== CACHE && (key.startsWith('masar-static-') || key.startsWith('amrni-static-') || key.startsWith('karwa-phase'))
    ).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !STATIC_PATHS.has(url.pathname)) return;
  const canonical = new Request(url.origin + url.pathname);
  event.respondWith(fetch(request, { cache: 'no-store' })
    .then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(canonical, copy)));
      }
      return response;
    })
    .catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(canonical, { ignoreSearch: true })) || Response.error();
    }));
});
