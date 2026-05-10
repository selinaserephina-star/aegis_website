// Ægis — Stripe Webhook Worker
// Receives checkout.session.completed → notifies selina@ → confirms to customer
//
// Secrets (set via wrangler secret put):
//   STRIPE_WEBHOOK_SECRET   whsec_...
//   RESEND_API_KEY          re_...
//
// Deploy: wrangler deploy --config wrangler-webhook.toml
// Register webhook in Stripe dashboard:
//   Events: checkout.session.completed
//   URL:    https://webhook.xn--gis-xla.no  (or your worker route)

const NOTIFY_EMAIL = "selina@exoreaction.com";
const FROM_EMAIL   = "aegis@exoreaction.com"; // must be verified in Resend

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();
    const sig  = request.headers.get("stripe-signature");

    // Verify Stripe signature
    let event;
    try {
      event = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("Stripe signature verification failed:", err.message);
      return new Response("Unauthorized", { status: 401 });
    }

    if (event.type !== "checkout.session.completed") {
      return new Response("OK", { status: 200 }); // ignore other events
    }

    const session      = event.data.object;
    const repoUrl      = session.client_reference_id || "(not provided)";
    const customerEmail = session.customer_details?.email || "(unknown)";
    const amountPaid   = ((session.amount_total || 0) / 100).toFixed(2);
    const currency     = (session.currency || "eur").toUpperCase();

    console.log(`New KCP package request: ${customerEmail} → ${repoUrl}`);

    // Queue job for automated pipeline (Neuron pulls and processes)
    if (env.KCP_JOBS) {
      await env.KCP_JOBS.send({
        url:       repoUrl,
        email:     customerEmail,
        sessionId: session.id,
        amount:    amountPaid,
        currency,
        queuedAt:  new Date().toISOString(),
      });
      console.log(`Queued KCP job for ${repoUrl}`);
    }

    // Send notification to Selina/Totto (also serves as manual fallback if pipeline is down)
    await sendEmail(env.RESEND_API_KEY, {
      from: FROM_EMAIL,
      to:   NOTIFY_EMAIL,
      subject: `[Ægis] New KCP package request — ${repoUrl}`,
      html: `
        <h2>New AI-Readiness Package Request</h2>
        <table>
          <tr><td><strong>Customer email:</strong></td><td>${customerEmail}</td></tr>
          <tr><td><strong>Repo / website:</strong></td><td><a href="${repoUrl}">${repoUrl}</a></td></tr>
          <tr><td><strong>Amount paid:</strong></td><td>${amountPaid} ${currency}</td></tr>
          <tr><td><strong>Session ID:</strong></td><td>${session.id}</td></tr>
        </table>
        <p>Run the ExoCortex pipeline, then send the zip to ${customerEmail}.</p>
      `,
    });

    // Send confirmation to customer
    if (customerEmail && customerEmail !== "(unknown)") {
      await sendEmail(env.RESEND_API_KEY, {
        from: FROM_EMAIL,
        to:   customerEmail,
        subject: "Your Ægis AI-Readiness Package — received",
        html: `
          <p>Hi,</p>
          <p>We've received your order for the Ægis AI-Readiness Package.</p>
          <p><strong>Repository / website:</strong> ${repoUrl}</p>
          <p>Your package will be delivered to this email address within minutes.
             It will include: <code>knowledge.yaml</code> (signed), <code>CLAUDE.md</code>,
             <code>AGENTS.md</code>, <code>llms.txt</code>, and a setup guide.</p>
          <p>Questions? Reply to this email or write to
             <a href="mailto:selina@exoreaction.com">selina@exoreaction.com</a>.</p>
          <p>— Ægis</p>
        `,
      });
    }

    return new Response("OK", { status: 200 });
  },
};

// ---- Stripe signature verification (no npm dependency) ----
// Implements HMAC-SHA256 verification per Stripe docs.

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) throw new Error("Missing signature or secret");

  const parts     = Object.fromEntries(sigHeader.split(",").map(p => p.split("=")));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error("Malformed Stripe-Signature header");

  // Reject events older than 5 minutes
  const tolerance = 300;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > tolerance) {
    throw new Error("Timestamp too old");
  }

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected !== signature) throw new Error("Signature mismatch");

  return JSON.parse(payload);
}

// ---- Resend email sender ----

async function sendEmail(apiKey, { from, to, subject, html }) {
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — email skipped:", subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", res.status, err);
  }
}
