// GET /api/profile?slug=siyah → kullanıcı profilini döndür
// POST /api/profile → profili kaydet (dashboard'dan)
// PUT /api/profile → profil güncelle

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  const url = new URL(request.url);

  // CORS Headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://starhub.lol',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ─── GET: Profil verisi çek ────────────────────────────────────────────────
  if (method === 'GET') {
    const slug = url.searchParams.get('slug');
    const user_id = url.searchParams.get('user_id');

    if (!slug && !user_id) {
      return new Response(JSON.stringify({ error: 'slug veya user_id gerekli' }), { status: 400, headers: corsHeaders });
    }

    try {
      let profile;
      if (slug) {
        profile = await env.DB.prepare('SELECT * FROM profiles WHERE slug = ?').bind(slug).first();
      } else {
        profile = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user_id).first();
      }

      if (!profile) {
        return new Response(JSON.stringify({ error: 'Profil bulunamadı' }), { status: 404, headers: corsHeaders });
      }

      return new Response(JSON.stringify(profile), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ─── POST: Yeni profil oluştur ───────────────────────────────────────────
  if (method === 'POST') {
    try {
      const body = await request.json();
      const { user_id, username, slug, avatar_url, banner_url, bio, rank_name, rank_rr, is_public, sync_active } = body;

      if (!user_id || !username) {
        return new Response(JSON.stringify({ error: 'user_id ve username gerekli' }), { status: 400, headers: corsHeaders });
      }

      // Slug çakışması kontrolü
      if (slug) {
        const existing = await env.DB.prepare('SELECT user_id FROM profiles WHERE slug = ?').bind(slug).first();
        if (existing && existing.user_id !== user_id) {
          return new Response(JSON.stringify({ error: 'Bu kullanıcı adı zaten alınmış!' }), { status: 409, headers: corsHeaders });
        }
      }

      await env.DB.prepare(`
        INSERT INTO profiles (user_id, username, slug, avatar_url, banner_url, bio, rank_name, rank_rr, is_public, sync_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          username = excluded.username,
          slug = excluded.slug,
          avatar_url = excluded.avatar_url,
          banner_url = excluded.banner_url,
          bio = excluded.bio,
          is_public = excluded.is_public,
          sync_active = excluded.sync_active
      `).bind(user_id, username, slug || username, avatar_url || '', banner_url || '', bio || '', rank_name || 'Unranked', rank_rr || 0, is_public ?? 1, sync_active ?? 1).run();

      return new Response(JSON.stringify({ success: true, profileUrl: `https://starhub.lol/${slug || username}` }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
}
