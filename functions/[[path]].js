// functions/[[path]].js — StarHUB Ana Router
// Tüm özel mantık burada: auth callback + profile routing

const DISCORD_API = 'https://discord.com/api/v10';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // ══════════════════════════════════════════════════════════════
  // 1. DİSCORD OAuth2 CALLBACK  →  /auth/callback?code=...
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/auth/callback') {
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error || !code) {
      return Response.redirect('https://starhub.lol/login?error=cancelled', 302);
    }

    let access_token = null;

    // ─── 1. Token Exchange ────────────────────────────────────
    try {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     '1486756004883595284',
          client_secret: env.DISCORD_CLIENT_SECRET || '',
          grant_type:    'authorization_code',
          code,
          redirect_uri:  'https://starhub.lol/auth/callback',
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error('Token exchange failed:', errText);
        return Response.redirect('https://starhub.lol/login?error=auth_failed', 302);
      }

      const tokenData = await tokenRes.json();
      access_token = tokenData.access_token;
    } catch (e) {
      console.error('Token fetch error:', e.message);
      return Response.redirect('https://starhub.lol/login?error=auth_failed', 302);
    }

    // ─── 2. Discord Kullanıcı Bilgileri ───────────────────────
    let discordUser = null;
    try {
      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!userRes.ok) {
        return Response.redirect('https://starhub.lol/login?error=user_failed', 302);
      }
      discordUser = await userRes.json();
    } catch (e) {
      console.error('User fetch error:', e.message);
      return Response.redirect('https://starhub.lol/login?error=user_failed', 302);
    }

    const userId    = discordUser.id;
    const username  = discordUser.global_name || discordUser.username;
    const disc      = discordUser.discriminator || '0';
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${discordUser.avatar}.png?size=256`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    // ─── 3. D1 Kayıt (DB yoksa atla, login yine çalışır) ─────
    try {
      if (env.DB) {
        const existing = await env.DB.prepare(
          'SELECT slug, bio, banner_url, is_public, sync_active FROM profiles WHERE user_id = ?'
        ).bind(userId).first();

        const defaultSlug = username.toLowerCase().replace(/[^a-z0-9_-]/gi, '').slice(0, 30);

        await env.DB.prepare(`
          INSERT INTO profiles (user_id, username, slug, avatar_url, banner_url, bio, is_public, sync_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            username   = excluded.username,
            avatar_url = excluded.avatar_url
        `).bind(
          userId, username,
          existing?.slug || defaultSlug,
          avatarUrl,
          existing?.banner_url || '',
          existing?.bio || '',
          existing?.is_public ?? 1,
          existing?.sync_active ?? 1
        ).run();
      } else {
        console.warn('D1 binding (DB) bulunamadı — veri kaydedilmedi.');
      }
    } catch (dbErr) {
      // DB hatası login'i engellemez, sadece logla
      console.error('D1 kayıt hatası:', dbErr.message);
    }

    // ─── 4. Session Cookie ve Dashboard Yönlendirmesi ─────────
    const session    = JSON.stringify({ id: userId, username, discriminator: disc, avatarUrl });
    const sessionB64 = btoa(unescape(encodeURIComponent(session)));

    return new Response(null, {
      status: 302,
      headers: {
        Location:    'https://starhub.lol/dashboard.html',
        'Set-Cookie': `shub_session=${sessionB64}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 2. PROFİL API  →  /api/profile
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/api/profile') {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (request.method === 'GET') {
      const slug    = url.searchParams.get('slug');
      const user_id = url.searchParams.get('user_id');
      if (!slug && !user_id) {
        return new Response(JSON.stringify({ error: 'slug veya user_id gerekli' }), { status: 400, headers: corsHeaders });
      }
      try {
        const profile = slug
          ? await env.DB.prepare('SELECT * FROM profiles WHERE slug = ? AND is_public = 1').bind(slug).first()
          : await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user_id).first();

        if (!profile) {
          return new Response(JSON.stringify({ error: 'Profil bulunamadı' }), { status: 404, headers: corsHeaders });
        }
        return new Response(JSON.stringify(profile), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (request.method === 'POST') {
      try {
        const body = await request.json();
        const { user_id, username, slug, avatar_url, banner_url, bio, is_public, sync_active } = body;

        if (!user_id || !username) {
          return new Response(JSON.stringify({ error: 'user_id ve username gerekli' }), { status: 400, headers: corsHeaders });
        }

        // Slug çakışma kontrolü
        if (slug) {
          const ex = await env.DB.prepare('SELECT user_id FROM profiles WHERE slug = ?').bind(slug).first();
          if (ex && ex.user_id !== user_id) {
            return new Response(JSON.stringify({ error: 'Bu kullanıcı adı zaten alınmış!' }), { status: 409, headers: corsHeaders });
          }
        }

        // Mevcut değerleri koru eğer yeni değer gönderilmediyse
        const current = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user_id).first();

        await env.DB.prepare(`
          INSERT INTO profiles (user_id, username, slug, avatar_url, banner_url, bio, is_public, sync_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            username   = excluded.username,
            slug       = excluded.slug,
            avatar_url = excluded.avatar_url,
            banner_url = excluded.banner_url,
            bio        = excluded.bio,
            is_public  = excluded.is_public,
            sync_active = excluded.sync_active
        `).bind(
          user_id, username,
          slug || current?.slug || username.toLowerCase().replace(/[^a-z0-9_-]/gi, ''),
          avatar_url || current?.avatar_url || '',
          banner_url || current?.banner_url || '',
          bio        ?? current?.bio        ?? '',
          is_public  ?? current?.is_public  ?? 1,
          sync_active ?? current?.sync_active ?? 1
        ).run();

        const finalSlug = slug || current?.slug || username;
        return new Response(JSON.stringify({
          success:    true,
          profileUrl: `https://starhub.lol/${finalSlug}`
        }), { headers: corsHeaders });

      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  // ══════════════════════════════════════════════════════════════
  // 3. ADMIN API (GİZLİ)  →  /api/admin/users
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/api/admin/users') {
    const cookieString = request.headers.get('Cookie') || '';
    const sessionMatch = cookieString.match(/shub_session=([^;]+)/);

    if (!sessionMatch) {
      return new Response(JSON.stringify({ error: 'Yetkisiz erişim' }), { status: 401 });
    }

    try {
      const sessionData = JSON.parse(decodeURIComponent(escape(atob(sessionMatch[1]))));
      const user_id = sessionData.id;

      // Yetki kontrolü: Sadece 'syh' ve 'winse' slug'larına sahip olanlar
      const adminUser = await env.DB.prepare('SELECT slug FROM profiles WHERE user_id = ?').bind(user_id).first();

      if (!adminUser || !['syh', 'winse'].includes(adminUser.slug)) {
        return new Response(JSON.stringify({ error: 'Bu alana erişim yetkiniz yok.' }), { status: 403 });
      }

      // Tüm kullanıcıları çek
      const users = await env.DB.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all();
      return new Response(JSON.stringify(users.results), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Sunucu hatası' }), { status: 500 });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 4. STATİK DOSYALAR — doğrudan sun
  // ══════════════════════════════════════════════════════════════
  const staticPaths = [
    '/', '/index.html', '/login.html', '/login', '/dashboard.html',
    '/dashboard', '/admin', '/admin/index.html', '/profile.html',
    '/style.css', '/logo.png', '/bg.png', '/riot.txt', '/schema.sql', '/favicon.ico',
  ];

  if (staticPaths.includes(pathname) || pathname.match(/\.[a-z0-9]+$/i)) {
    // /login → login.html, /dashboard → dashboard.html, /admin → admin/index.html
    if (pathname === '/login') {
      return env.ASSETS.fetch(new Request(new URL('/login.html', url).toString()));
    }
    if (pathname === '/dashboard') {
      return env.ASSETS.fetch(new Request(new URL('/dashboard.html', url).toString()));
    }
    if (pathname === '/admin') {
      return env.ASSETS.fetch(new Request(new URL('/admin/index.html', url).toString()));
    }
    return env.ASSETS.fetch(request);
  }

  // ══════════════════════════════════════════════════════════════
  // 4. SLUG BAZLI PROFİL SAYFASI  →  /siyah → profile.html
  // ══════════════════════════════════════════════════════════════
  const slug = pathname.replace(/^\//, '').split('/')[0];
  if (slug) {
    return env.ASSETS.fetch(new Request(new URL('/profile.html', url).toString()));
  }

  return env.ASSETS.fetch(request);
}
