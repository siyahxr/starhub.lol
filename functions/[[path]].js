export async function onRequest(context) {
  const { request, env, params } = context;
  const path = params.path;

  // Statik sayfalara dokunma
  const staticFiles = ['index', 'login', 'dashboard', 'profile', 'style', 'logo', 'bg', 'riot'];
  const slug = Array.isArray(path) ? path[0] : path;

  if (!slug || staticFiles.some(f => slug.startsWith(f))) {
    return env.ASSETS.fetch(request);
  }

  // API rotaları
  if (slug === 'api') {
    return env.ASSETS.fetch(request);
  }

  try {
    // Veritabanında bu slug'a sahip kullanıcıyı ara
    const profile = await env.DB.prepare(
      'SELECT * FROM profiles WHERE slug = ? AND is_public = 1'
    ).bind(slug).first();

    if (!profile) {
      // Kullanıcı bulunamadıysa ana sayfaya yönlendir
      return Response.redirect('https://starhub.lol/?not_found=1', 302);
    }

    // Profil sayfasını getir ve içine kullanıcı verilerini göm
    const assetResponse = await env.ASSETS.fetch(new Request('https://starhub.lol/profile.html'));
    let html = await assetResponse.text();

    // HTML içine profil verilerini göm
    html = html
      .replace('__USERNAME__', profile.username || slug)
      .replace('__SLUG__', profile.slug || slug)
      .replace('__BIO__', profile.bio || 'StarHUB Elite Creator')
      .replace('__AVATAR_URL__', profile.avatar_url || '/logo.png')
      .replace('__BANNER_URL__', profile.banner_url || '')
      .replace('__RANK_NAME__', profile.rank_name || 'Unranked')
      .replace('__RANK_RR__', profile.rank_rr || '0')
      .replace('__USER_ID__', profile.user_id || '');

    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });

  } catch (err) {
    console.error('Profile fetch error:', err);
    return env.ASSETS.fetch(request);
  }
}
