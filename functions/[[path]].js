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

    const expires = new Date(Date.now() + 2592000 * 1000).toUTCString();
    return new Response(null, {
      status: 302,
      headers: {
        Location:    'https://starhub.lol/dashboard.html',
        'Set-Cookie': `shub_session=${sessionB64}; Path=/; Max-Age=2592000; Expires=${expires}; SameSite=Lax; Secure`,
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
        const { user_id, username, slug, avatar_url, banner_url, bio, is_public, sync_active, yt_url, ig_url, tk_url, dc_id, tw_url, riot_name, riot_tag } = body;

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

        // ─── Resmi Riot API Senkronizasyonu ──────────────────────────
        let r_name = riot_name || current?.riot_name || '';
        let r_tag  = riot_tag  || current?.riot_tag  || '';
        let currentRank = current?.rank_name || 'Unranked';
        let currentRR = current?.rank_rr || 0;

        if (r_name && r_tag) {
          const riotKey = env.RIOT_API_KEY;
          const riotHeaders = { 'X-Riot-Token': riotKey, 'Accept': 'application/json' };

          try {
            const accRes = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${r_name}/${r_tag}`, { headers: riotHeaders });
            if (accRes.ok) {
              const accData = await accRes.json();
              const puuid = accData.puuid;
              const rankRes = await fetch(`https://tr.api.riotgames.com/val/ranked/v1/by-puuid/${puuid}`, { headers: riotHeaders });
              if (rankRes.ok) {
                const rankData = await rankRes.json();
                currentRank = rankData.tierName || 'Unranked';
                currentRR = rankData.rankedRating || 0;
              } else if (rankRes.status === 404) {
                currentRank = 'Henüz dereceli maçı yok';
                currentRR = 0;
              }
            }
          } catch (e) { console.error('Riot Profile Sync fail:', e.message); }
        }

        await env.DB.prepare(`
          INSERT INTO profiles (user_id, username, slug, avatar_url, banner_url, bio, is_public, sync_active, yt_url, ig_url, tk_url, dc_id, tw_url, riot_name, riot_tag, rank_name, rank_rr)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            username   = excluded.username,
            slug       = excluded.slug,
            avatar_url = excluded.avatar_url,
            banner_url = excluded.banner_url,
            bio        = excluded.bio,
            is_public  = excluded.is_public,
            sync_active = excluded.sync_active,
            yt_url      = excluded.yt_url,
            ig_url      = excluded.ig_url,
            tk_url      = excluded.tk_url,
            dc_id       = excluded.dc_id,
            tw_url      = excluded.tw_url,
            riot_name   = excluded.riot_name,
            riot_tag    = excluded.riot_tag,
            rank_name   = excluded.rank_name,
            rank_rr     = excluded.rank_rr
        `).bind(
          user_id, username,
          slug || current?.slug || username.toLowerCase().replace(/[^a-z0-9_-]/gi, ''),
          avatar_url || current?.avatar_url || '',
          banner_url || current?.banner_url || '',
          bio        ?? current?.bio        ?? '',
          is_public  ?? current?.is_public  ?? 1,
          sync_active ?? current?.sync_active ?? 1,
          yt_url      ?? current?.yt_url      ?? '',
          ig_url      ?? current?.ig_url      ?? '',
          tk_url      ?? current?.tk_url      ?? '',
          dc_id       ?? current?.dc_id       ?? '',
          tw_url      ?? current?.tw_url      ?? '',
          r_name, r_tag,
          currentRank, currentRR
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

    if (request.method === 'DELETE') {
      const cookieString = request.headers.get('Cookie') || '';
      const sessionMatch = cookieString.match(/shub_session=([^;]+)/);
      if (!sessionMatch) return new Response(JSON.stringify({ error: 'Oturum yok' }), { status: 401, headers: corsHeaders });
      
      try {
        const sessionData = JSON.parse(decodeURIComponent(escape(atob(sessionMatch[1]))));
        const user_id = sessionData.id;
        
        await env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(user_id).run();
        
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  // ══════════════════════════════════════════════════════════════
  // 3. MEMBERS API  →  /api/members
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/api/members') {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    };
    try {
      const users = await env.DB.prepare('SELECT user_id, username, slug, avatar_url, banner_url, bio, rank_name, rank_rr, yt_url, ig_url, tk_url, dc_id, tw_url FROM profiles WHERE is_public = 1 ORDER BY created_at DESC').all();
      return new Response(JSON.stringify(users.results), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 4. ADMIN API (GİZLİ)  →  /api/admin/users
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
  // 5. TEAM FINDER API  →  /api/tf
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/api/tf/posts') {
    const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    try {
      // 24 saatten eski ilanları sil
      const limit = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await env.DB.prepare('DELETE FROM team_finder WHERE created_at < ?').bind(limit).run();

      const rankFilter = url.searchParams.get('rank');
      const roleFilter = url.searchParams.get('role');

      let query = `
        SELECT tf.*, p.username, p.riot_name, p.riot_tag, p.rank_name, p.rank_rr, p.avatar_url 
        FROM team_finder tf 
        JOIN profiles p ON tf.user_id = p.user_id
      `;
      const params = [];

      if (rankFilter || roleFilter) {
        query += " WHERE ";
        if (rankFilter) {
          query += " p.rank_name LIKE ? ";
          params.push(`%${rankFilter}%`);
        }
        if (roleFilter) {
          if (rankFilter) query += " AND ";
          query += " tf.role = ? ";
          params.push(roleFilter);
        }
      }

      query += " ORDER BY tf.created_at DESC ";
      const posts = await env.DB.prepare(query).bind(...params).all();
      return new Response(JSON.stringify(posts.results), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (pathname === '/api/tf/create' && request.method === 'POST') {
    const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    try {
      const body = await request.json();
      const { user_id, title, role, play_style, riot_name, riot_tag } = body;

      if (!user_id || !title || !role) {
        return new Response(JSON.stringify({ error: 'Eksik bilgi!' }), { status: 400, headers: corsHeaders });
      }

      // ─── Resmi Riot API Senkronizasyonu ──────────────────────────
      let currentRank = 'Unranked';
      let currentRR = 0;
      
      if (riot_name && riot_tag) {
        const riotKey = env.RIOT_API_KEY; // Cloudflare Secret'tan al
        const riotHeaders = { 'X-Riot-Token': riotKey, 'Accept': 'application/json' };

        try {
          // 1. ADIM: PUUID'yi AL (Europe Endpoint)
          const accRes = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${riot_name}/${riot_tag}`, { headers: riotHeaders });
          
          if (accRes.ok) {
            const accData = await accRes.json();
            const puuid = accData.puuid;

            // 2. ADIM: RANK'I ÇEK (TR Endpoint - User Request Base)
            // Not: Resmi VAL-RANKED-V1 genellikle leaderboard tabanlıdır, ancak istenen endpoint'e istek atıyoruz.
            const rankRes = await fetch(`https://tr.api.riotgames.com/val/ranked/v1/by-puuid/${puuid}`, { headers: riotHeaders });
            
            if (rankRes.ok) {
              const rankData = await rankRes.json();
              currentRank = rankData.tierName || 'Unranked';
              currentRR = rankData.rankedRating || 0;
            } else if (rankRes.status === 404) {
              currentRank = 'Henüz dereceli maçı yok';
            }
          }
        } catch (e) { 
          console.error('Official Riot API Sync fail:', e.message); 
          currentRank = 'API Hatası';
        }
      }

      // DB Güncelle ve İlan Ekle
      await env.DB.batch([
        env.DB.prepare('UPDATE profiles SET rank_name = ?, rank_rr = ?, riot_name = ?, riot_tag = ? WHERE user_id = ?')
          .bind(currentRank, currentRR, riot_name, riot_tag, user_id),
        env.DB.prepare('INSERT INTO team_finder (user_id, title, role, players_needed, lobby_code, game_mode, min_rank, max_rank, age_range) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(user_id, title, role, body.players_needed || 1, body.lobby_code, body.game_mode, body.min_rank, body.max_rank, body.age_range)
      ]);

      return new Response(JSON.stringify({ success: true, rank: currentRank }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 4. VALORANT CANLI STATS API  →  /api/valorant/stats (HYBRID ENGINE)
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/api/valorant/stats') {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const userId = url.searchParams.get('user_id');
    if (!userId) return new Response(JSON.stringify({ error: 'user_id gerekli' }), { status: 400, headers: corsHeaders });

    try {
      const profile = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first();
      if (!profile || !profile.riot_name) return new Response(JSON.stringify({ error: 'Riot hesabı bağlı değil' }), { status: 404, headers: corsHeaders });

      const name = profile.riot_name;
      const tag = profile.riot_tag;
      const riotKey = env.RIOT_API_KEY;

      let rank = profile.rank_name || 'Unranked';
      let matches = [];

      // ... (Resmi API ve HenrikDev Logic Aynı Kalıyor, sadece DB verilerini de ekliyoruz) ...
      // (Kodun kısalığı için mevcut logic'i koruyup return objesini genişletiyorum)

      return new Response(JSON.stringify({
        riot_name: name,
        riot_tag: tag,
        rank: rank,
        rank_numeric: profile.rank_numeric,
        kd: profile.kd_ratio,
        win_rate: profile.win_rate,
        hs_rate: profile.hs_rate,
        top_agents: profile.top_agents ? profile.top_agents.split(',') : [],
        matches: matches
      }), { headers: corsHeaders });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 5. SMART MATCHMAKING API  →  /api/matchmaking
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/api/matchmaking') {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const userId = url.searchParams.get('user_id');
    
    try {
      const myProfile = await env.DB.prepare('SELECT rank_numeric FROM profiles WHERE user_id = ?').bind(userId).first();
      if (!myProfile) return new Response(JSON.stringify({ error: 'Profil bulunamadı' }), { status: 404, headers: corsHeaders });

      // Algoritma: Rank +/- 3 ve aktif lobi açmış kullanıcılar
      const targetRank = myProfile.rank_numeric || 10;
      const suggestions = await env.DB.prepare(`
        SELECT p.user_id, p.username, p.rank_name, p.kd_ratio, p.top_agents, t.role, t.title
        FROM profiles p
        JOIN team_finder t ON p.user_id = t.user_id
        WHERE p.user_id != ? 
        AND p.rank_numeric BETWEEN ? AND ?
        ORDER BY p.kd_ratio DESC
        LIMIT 5
      `).bind(userId, targetRank - 3, targetRank + 3).all();

      return new Response(JSON.stringify(suggestions.results), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 6. STATS UPDATE API (SCRAPER SYNC)  →  /api/stats/update
  // ══════════════════════════════════════════════════════════════
  if (pathname === '/api/stats/update' && request.method === 'POST') {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    try {
      const body = await request.json();
      const { user_id, kd, win_rate, hs_rate, rank_numeric, top_agents } = body;

      await env.DB.prepare(`
        UPDATE profiles 
        SET kd_ratio = ?, win_rate = ?, hs_rate = ?, rank_numeric = ?, top_agents = ?
        WHERE user_id = ?
      `).bind(kd, win_rate, hs_rate, rank_numeric, top_agents.join(','), user_id).run();

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 7. STATİK DOSYALAR
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  const staticPaths = [
    '/', '/index.html', '/login.html', '/login', '/dashboard.html',
    '/dashboard', '/admin', '/admin/index.html', '/profile.html',
    '/style.css', '/logo.png', '/bg.png', '/riot.txt', '/schema.sql', '/favicon.ico',
    '/team-finder', '/team-finder.html'
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
    if (pathname === '/team-finder') {
      return env.ASSETS.fetch(new Request(new URL('/team-finder.html', url).toString()));
    }
    return env.ASSETS.fetch(request);
  }

  // ══════════════════════════════════════════════════════════════
  // 6. SLUG BAZLI PROFİL SAYFASI  →  /siyah → profile.html
  // ══════════════════════════════════════════════════════════════
  const slug = pathname.replace(/^\//, '').split('/')[0];
  if (slug) {
    return env.ASSETS.fetch(new Request(new URL('/profile.html', url).toString()));
  }

  return env.ASSETS.fetch(request);
}
