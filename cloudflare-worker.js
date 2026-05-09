/**
 * LiftBuilder — Cloudflare Worker entry point
 *
 * POST /api/auth  →  exchanges a GitHub OAuth code for an access token
 * Everything else →  served from static assets (index.html)
 *
 * Set these as Worker secrets in the Cloudflare dashboard
 * (Settings → Variables → Add variable, mark as secret):
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method === 'POST') {
        return handleAuth(request, env);
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // All other requests → serve static assets (index.html, etc.)
    return env.ASSETS.fetch(request);
  },
};

async function handleAuth(request, env) {
  try {
    const { code } = await request.json();
    if (!code) return jsonResponse({ error: 'missing_code' }, 400);

    const ghRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const data = await ghRes.json();
    return jsonResponse(data);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
