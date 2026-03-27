export async function onRequest(context) {
    const { env } = context;
    if (!env || !env.DB) {
        return new Response(JSON.stringify({ 
            error: "Cloudflare D1 binding 'DB' not found. Lütfen Pages Ayarları -> Functions -> Bindings kısmında 'DB' isminde bir bağlantı eklediğinden emin ol." 
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    try {
        const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
        return new Response(JSON.stringify(results || []), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { 
            status: 500, 
            headers: { "Content-Type": "application/json" } 
        });
    }
}
