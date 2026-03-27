// functions/auth/callback.js
// Cloudflare Pages bu dosyayı otomatik olarak /auth/callback adresine bağlar
// Discord OAuth2 flow: code → access_token → user info → D1 kayıt → cookie → dashboard

const DISCORD_API = 'https://discord.com/api/v10';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Kullanıcı Discord'da "İptal Et" dediyse
  if (error || !code) {
    return Response.redirect('https://starhub.lol/login.html?error=cancelled', 302);
  }

  try {
    // ── 1. Authorization code → access token ──────────────────
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: '1486756004883595284',
        client_secret: env.DISCORD_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://starhub.lol/auth/callback',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', errText);
      return Response.redirect('https://starhub.lol/login.html?error=auth_failed', 302);
    }

    const { access_token } = await tokenRes.json();

    // ── 2. Discord kullanıcı bilgilerini çek ──────────────────
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userRes.ok) {
      return Response.redirect('https://starhub.lol/login.html?error=user_fetch_failed', 302);
    }

    const discordUser = await userRes.json();
    const userId      = discordUser.id;
    const username    = discordUser.global_name || discordUser.username;
    const discriminator = discordUser.discriminator || '0';
    const avatarHash  = discordUser.avatar;
    const avatarUrl   = avatarHash
      ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) >> 22n) % 6n}.png`;

    // ── 3. D1'e kaydet (varsa avatar_url güncelle, diğer ayarlar korunur) ──
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
      existing?.is_public  ?? 1,
      existing?.sync_active ?? 1
    ).run();

    // ── 4. Session cookie set et (30 gün) ────────────────────
    const sessionData = JSON.stringify({ id: userId, username, discriminator, avatarUrl });
    const sessionB64  = btoa(unescape(encodeURIComponent(sessionData)));

    return new Response(null, {
      status: 302,
      headers: {
        'Location': 'https://starhub.lol/dashboard.html',
        'Set-Cookie': `shub_session=${sessionB64}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
      },
    });

  } catch (err) {
    console.error('Auth callback error:', err.message);
    return Response.redirect('https://starhub.lol/login.html?error=server_error', 302);
  }
}
