// Ægis · window.claude
// Calls the Cloudflare Worker proxy — API key never reaches the browser.
// Worker repo: worker/index.js
// Set worker URL below after running: wrangler deploy
window.claude = {
  _proxyUrl: "https://aegis-proxy.totto.workers.dev",
  complete: async function (prompt) {
    const resp = await fetch(this._proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${resp.status}`);
    }
    const data = await resp.json();
    return data.content[0].text;
  },
};
