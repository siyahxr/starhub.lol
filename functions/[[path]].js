// Yönlendirme Fonksiyonu
// - /dashboard.html?code=... gelirse → auth/callback.js'e devret
// - /slug → profile.html sun

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const code = url.searchParams.get('code');

  // Dashboard'a code ile geliniyorsa OAuth callback'i çalıştır
  if (pathname === '/dashboard.html' && code) {
    const { onRequest: handleAuth } = await import('./auth/callback.js');
    return handleAuth(context);
  }

  // Statik dosya/sayfaları doğrudan sun
  const staticPaths = [
    '/', '/index.html', '/login.html', '/dashboard.html',
    '/profile.html', '/style.css', '/logo.png', '/bg.png',
    '/riot.txt', '/schema.sql', '/favicon.ico'
  ];

  if (
    staticPaths.includes(pathname) ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/functions/') ||
    pathname.startsWith('/auth/') ||
    pathname.includes('.')
  ) {
    return env.ASSETS.fetch(request);
  }

  // Slug bazlı profil sayfası
  const slug = pathname.replace(/^\//, '').split('/')[0];
  if (slug) {
    return env.ASSETS.fetch(new Request(new URL('/profile.html', url).toString()));
  }

  return env.ASSETS.fetch(request);
}
