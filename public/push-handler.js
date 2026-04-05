/* Loaded via workbox importScripts — runs on incoming push only; does not schedule by time (that must be server-side). */
self.addEventListener("push", (event) => {
  let payload = { title: "Gothenburg Parking Guardian", body: "" };
  try {
    if (event.data) {
      const json = event.data.json();
      payload = { ...payload, ...json };
    }
  } catch {
    try {
      payload.body = event.data?.text() ?? "";
    } catch {
      /* ignore */
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: payload.data ?? {},
      tag: payload.tag ?? "parking-guardian",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
