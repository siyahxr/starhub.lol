// functions/[[path]].js
// Bilinmeyen slug'ları (starhub.lol/siyah gibi) profile.html'e yönlendir
// Statik dosyalara dokunma

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Statik dosyalar ve bilinen sayfalar — doğrudan sun
  const staticExact = [
    '/', '/index.html', '/login.html', '/dashboard.html',
    '/profile.html', '/style.css', '/logo.png', '/bg.png',
    '/riot.txt', '/schema.sql', '/favicon.ico',
  ];

  if (
    staticExact.includes(pathname) ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.match(/\.[a-z0-9]+$/i) // uzantılı dosyalar
  ) {
    return env.ASSETS.fetch(request);
  }

  // Slug bazlı profil sayfası: /siyah → profile.html
  const slug = pathname.replace(/^\//, '').split('/')[0];
  if (slug) {
    const profileReq = new Request(new URL('/profile.html', url).toString(), request);
    return env.ASSETS.fetch(profileReq);
  }

  return env.ASSETS.fetch(request);
}
