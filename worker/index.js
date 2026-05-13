// Ægis Claude Proxy — Cloudflare Worker
// API key stored as CF secret (never reaches the browser).
// Deploy: wrangler deploy
// Secrets: wrangler secret put CLAUDE_API_KEY
//          wrangler secret put RESEND_API_KEY
//          wrangler secret put STRIPE_SECRET_KEY  (Ask ExoCortex)

const ALLOWED_ORIGINS = ["https://ægis.no", "https://xn--gis-xla.no", "http://localhost"];

// ── KCP pipeline config ───────────────────────────────────────────────────────
const KCP_AMOUNTS = {
  "ai-readiness":     500,   // EUR 5
  "codebase-starter": 1900,  // EUR 19
};

// ── Ask ExoCortex config ──────────────────────────────────────────────────────
const TIERS = {
  basic: { maxMessages: 5,  model: "claude-haiku-4-5-20251001", expiryMs: 30 * 60 * 1000 },
  pro:   { maxMessages: 20, model: "claude-sonnet-4-6",         expiryMs: 2 * 60 * 60 * 1000 },
};

const SYSTEM_PROMPT =
  "You are ExoCortex, Ægis's engineering intelligence. Give concise, opinionated answers about " +
  "software architecture, codebases, engineering practices, tech stack decisions, and technical " +
  "team structure. Be direct and specific. No marketing language.";

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowed ? origin : ""),
      });
    }

    if (!allowed) {
      return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(request.url);

    // KCP pipeline routes
    if (url.pathname === "/kcp/session" && request.method === "POST") {
      return handleKcpSession(request, env, origin);
    }

    // Ask ExoCortex routes
    if (url.pathname === "/ask/session" && request.method === "POST") {
      return handleAskSession(request, env, origin);
    }
    if (url.pathname === "/ask/chat" && request.method === "POST") {
      return handleAskChat(request, env, origin);
    }
    if (url.pathname === "/ask/status" && request.method === "GET") {
      return handleAskStatus(request, env, origin);
    }

    // All remaining routes require POST
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/waitlist") {
      return handleWaitlist(request, env, origin);
    }

    // Claude API proxy (existing — used by the AskCodebase demo on the homepage)
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const resp = await claudeCall(env.CLAUDE_API_KEY, body);
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  },
};

// ── /kcp/session — validate Stripe checkout and queue Neuron job ──────────────
async function handleKcpSession(request, env, origin) {
  let body;
  try { body = await request.json(); } catch {
    return jsonError("invalid json", 400, origin);
  }

  const { checkoutId, product } = body;
  if (!checkoutId || !KCP_AMOUNTS[product]) {
    return jsonError("missing checkoutId or invalid product", 400, origin);
  }

  // Prevent double-submission
  const redeemed = await env.ASK_SESSIONS.get(`kcp_checkout:${checkoutId}`);
  if (redeemed) {
    return jsonError("already queued", 409, origin);
  }

  // Validate payment with Stripe
  let stripeSession;
  try {
    const stripeResp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutId)}`,
      { headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` } }
    );
    if (!stripeResp.ok) return jsonError("stripe lookup failed", 402, origin);
    stripeSession = await stripeResp.json();
  } catch {
    return jsonError("stripe unreachable", 502, origin);
  }

  if (stripeSession.payment_status !== "paid") {
    return jsonError("payment not completed", 402, origin);
  }

  if (stripeSession.amount_total !== KCP_AMOUNTS[product]) {
    return jsonError("product/amount mismatch", 402, origin);
  }

  const targetUrl = stripeSession.client_reference_id || "";
  const email = stripeSession.customer_details?.email || "";

  if (!targetUrl || !email) {
    return jsonError("missing url or email from Stripe checkout", 400, origin);
  }

  // Determine job type: github.com URL → codebase, otherwise → website
  const jobType = targetUrl.includes("github.com") ? "codebase" : "website";
  const jobBody = jobType === "codebase"
    ? { type: "codebase", github_url: targetUrl, email }
    : { type: "website", url: targetUrl, email };

  // Push to CF Queue — Neuron polls this
  await env.KCP_QUEUE.send(jobBody);

  // Mark checkout redeemed for 24h to prevent duplicate submissions
  await env.ASK_SESSIONS.put(`kcp_checkout:${checkoutId}`, "redeemed", { expirationTtl: 86400 });

  return jsonOk({ queued: true, jobType, url: targetUrl, email }, origin);
}

// ── /ask/session — exchange Stripe checkout ID for session token ──────────────
async function handleAskSession(request, env, origin) {
  let body;
  try { body = await request.json(); } catch {
    return jsonError("invalid json", 400, origin);
  }

  const { checkoutId, tier } = body;
  if (!checkoutId || !TIERS[tier]) {
    return jsonError("missing checkoutId or invalid tier", 400, origin);
  }

  // Prevent double-redemption
  const redeemed = await env.ASK_SESSIONS.get(`checkout:${checkoutId}`);
  if (redeemed) {
    return jsonError("session already redeemed", 409, origin);
  }

  // Validate payment with Stripe
  let stripeSession;
  try {
    const stripeResp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutId)}`,
      { headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` } }
    );
    if (!stripeResp.ok) return jsonError("stripe lookup failed", 402, origin);
    stripeSession = await stripeResp.json();
  } catch {
    return jsonError("stripe unreachable", 502, origin);
  }

  if (stripeSession.payment_status !== "paid") {
    return jsonError("payment not completed", 402, origin);
  }

  // Verify tier matches amount paid (EUR in cents: basic=100, pro=1000)
  const expectedAmount = tier === "pro" ? 1000 : 100;
  if (stripeSession.amount_total !== expectedAmount) {
    return jsonError("tier/amount mismatch", 402, origin);
  }

  // Create session token
  const token = crypto.randomUUID();
  const tierCfg = TIERS[tier];
  const sessionData = {
    tier,
    maxMessages: tierCfg.maxMessages,
    messagesUsed: 0,
    expiresAt: Date.now() + tierCfg.expiryMs,
    history: [],
  };

  await env.ASK_SESSIONS.put(
    `session:${token}`,
    JSON.stringify(sessionData),
    { expirationTtl: Math.ceil(tierCfg.expiryMs / 1000) + 300 }
  );
  // Mark checkout redeemed for 24h to prevent replay
  await env.ASK_SESSIONS.put(`checkout:${checkoutId}`, "redeemed", { expirationTtl: 86400 });

  return jsonOk({ token, messagesLeft: tierCfg.maxMessages, expiresAt: sessionData.expiresAt }, origin);
}

// ── /ask/chat — session-authenticated chat with scope guard ──────────────────
async function handleAskChat(request, env, origin) {
  let body;
  try { body = await request.json(); } catch {
    return jsonError("invalid json", 400, origin);
  }

  const { token, message } = body;
  if (!token || !message?.trim()) {
    return jsonError("missing token or message", 400, origin);
  }

  // Load session from KV
  const raw = await env.ASK_SESSIONS.get(`session:${token}`);
  if (!raw) return jsonError("session not found or expired", 404, origin);

  const sess = JSON.parse(raw);

  if (Date.now() > sess.expiresAt) {
    return jsonError("session expired", 410, origin);
  }
  if (sess.messagesUsed >= sess.maxMessages) {
    return jsonError("session exhausted", 410, origin);
  }

  // Scope guard: fast Haiku call, no message decrement on rejection
  const guardResp = await claudeCall(env.CLAUDE_API_KEY, {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 5,
    messages: [{
      role: "user",
      content:
        "Is this message a question about software engineering, architecture, codebases, or " +
        "technical team decisions? Reply only: YES or NO\n\nMessage: " +
        message.slice(0, 500),
    }],
  });

  if (guardResp.ok) {
    const guardData = await guardResp.json();
    const answer = (guardData.content?.[0]?.text || "").trim().toUpperCase();
    if (!answer.startsWith("YES")) {
      return jsonOk({
        response:
          "That's outside my scope — I only answer engineering and architecture questions. " +
          "Try rephrasing as a technical question.",
        messagesLeft: sess.maxMessages - sess.messagesUsed,
        scopeError: true,
      }, origin);
    }
  }
  // If guard call fails, proceed anyway — don't block the user

  // Main chat call
  const tierCfg = TIERS[sess.tier];
  const history = sess.history.slice(-20); // cap history to avoid token bloat

  const chatResp = await claudeCall(env.CLAUDE_API_KEY, {
    model: tierCfg.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [...history, { role: "user", content: message }],
  });

  if (!chatResp.ok) return jsonError("chat call failed", 502, origin);
  const chatData = await chatResp.json();
  const assistantText = chatData.content?.[0]?.text || "";

  // Update session in KV
  sess.history.push({ role: "user", content: message });
  sess.history.push({ role: "assistant", content: assistantText });
  sess.messagesUsed += 1;

  const ttlRemaining = Math.max(Math.ceil((sess.expiresAt - Date.now()) / 1000), 60);
  await env.ASK_SESSIONS.put(`session:${token}`, JSON.stringify(sess), {
    expirationTtl: ttlRemaining + 300,
  });

  return jsonOk({
    response: assistantText,
    messagesLeft: sess.maxMessages - sess.messagesUsed,
  }, origin);
}

// ── /ask/status — session status check ───────────────────────────────────────
async function handleAskStatus(request, env, origin) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return jsonError("missing token", 400, origin);

  const raw = await env.ASK_SESSIONS.get(`session:${token}`);
  if (!raw) return jsonError("session not found", 404, origin);

  const sess = JSON.parse(raw);
  return jsonOk({
    tier: sess.tier,
    messagesLeft: sess.maxMessages - sess.messagesUsed,
    expiresAt: sess.expiresAt,
  }, origin);
}

// ── /waitlist (existing) ──────────────────────────────────────────────────────
async function handleWaitlist(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const email = (body.email || "").trim();
  const product = (body.product || "unknown").trim();

  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "invalid email" }), {
      status: 400,
      headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "waitlist@xn--gis-xla.no",
        to: "selina@exoreaction.com",
        subject: `[Ægis Waitlist] ${product}: ${email}`,
        text: `New waitlist signup\n\nProduct: ${product}\nEmail: ${email}\nTime: ${new Date().toISOString()}`,
      }),
    });
  } catch (_) {
    // Non-fatal — still return success to the user
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function claudeCall(apiKey, body) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function jsonOk(data, origin) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
