// Avisos push (lo carga el service worker de la app con importScripts).
self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(datos.titulo || 'Lecturas de medidores', {
      body: datos.cuerpo || '',
      icon: '/icons/lecturas-192.png',
      tag: datos.tag || 'aviso',
      renotify: true,
      lang: 'es-AR',
      data: { url: datos.url || '/operador' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/operador', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const v of ventanas) {
        if ('focus' in v) {
          await v.focus();
          if ('navigate' in v) return v.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
