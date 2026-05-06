// Ægis · window.claude
// Direct Anthropic API call from browser.
// API key is injected at deploy time by GitHub Actions (secret: CLAUDE_API_KEY).
// Set it in: repo Settings → Secrets and variables → Actions → New repository secret.
window.claude = {
  _key: "__CLAUDE_API_KEY__",
  complete: async function (prompt) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this._key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
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
