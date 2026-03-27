export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    if (!env || !env.DB) {
        return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
    }

    try {
        const body = await request.json();
        const { username, short_desc, avatar, banner } = body;

        await env.DB.prepare(`
            INSERT INTO users (username, short_desc, avatar, banner) 
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(username) DO UPDATE SET 
            short_desc = excluded.short_desc,
            avatar = excluded.avatar,
            banner = excluded.banner
        `).bind(username, short_desc, avatar, banner).run();

        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}
