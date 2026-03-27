export async function onRequest(context) {
    const { env } = context;
    try {
        const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
        return new Response(JSON.stringify(results), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}
