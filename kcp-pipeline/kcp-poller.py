#!/usr/bin/env python3
"""kcp-poller — Aegis KCP Pipeline worker on Neuron.

Polls Cloudflare Queue 'kcp-jobs', generates KCP packages via claude CLI,
and emails the delivery zip to the customer.

Env (from ~/.kcp/kcp.env via systemd EnvironmentFile):
  CF_ACCOUNT_ID, CF_QUEUE_ID, CF_API_TOKEN
  RESEND_API_KEY, ANTHROPIC_API_KEY
"""

import os, json, subprocess, zipfile, io, re, time, logging, base64
from urllib.request import urlopen, Request
from urllib.parse import urlparse, quote_plus
from urllib.error import URLError, HTTPError
from datetime import date

# ── Config ────────────────────────────────────────────────────────────────────
CF_ACCOUNT_ID  = os.environ["CF_ACCOUNT_ID"]
CF_QUEUE_ID    = os.environ["CF_QUEUE_ID"]
CF_API_TOKEN   = os.environ["CF_API_TOKEN"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
FROM_EMAIL     = "aegis@exoreaction.com"
NOTIFY_EMAIL   = "selina@exoreaction.com"
DELIVERY_DIR   = os.path.expanduser("~/kcp-deliveries")
POLL_INTERVAL  = 30     # seconds between empty-queue polls
VISIBILITY_TIMEOUT = 600  # seconds — time allowed to process one job
BATCH_SIZE     = 1      # process one job at a time (claude takes 30-60s)

CF_BASE = (
    f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
    f"/queues/{CF_QUEUE_ID}/messages"
)

PROMPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts", "kcp-generate.txt")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kcp-poller")

# ── Cloudflare Queue helpers ──────────────────────────────────────────────────

def _cf_headers():
    return {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}

def pull_messages():
    req = Request(
        f"{CF_BASE}/pull",
        data=json.dumps({"visibilityTimeout": VISIBILITY_TIMEOUT, "batchSize": BATCH_SIZE}).encode(),
        headers=_cf_headers(),
        method="POST",
    )
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read())["result"]["messages"]

def ack_message(lease_id):
    req = Request(
        f"{CF_BASE}/ack",
        data=json.dumps({"acks": [{"lease_id": lease_id}], "retries": []}).encode(),
        headers=_cf_headers(),
        method="POST",
    )
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def nack_message(lease_id):
    """Return message to queue immediately so it retries sooner."""
    req = Request(
        f"{CF_BASE}/ack",
        data=json.dumps({"acks": [], "retries": [{"lease_id": lease_id}]}).encode(),
        headers=_cf_headers(),
        method="POST",
    )
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read())

# ── Website fetch ─────────────────────────────────────────────────────────────

UNAVAILABLE = "__UNAVAILABLE__"

def _strip_html(raw):
    """Strip script/style blocks and all HTML tags, collapse whitespace."""
    text = re.sub(r"<(script|style)[^>]*>.*?</(script|style)>", " ", raw, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def _fetch_page(url, timeout=15):
    """Fetch a single page and return stripped text, or UNAVAILABLE on failure."""
    try:
        req = Request(url, headers={"User-Agent": "AegisBot/1.0 (kcp-package-generator)"})
        with urlopen(req, timeout=timeout) as r:
            raw = r.read(80_000).decode("utf-8", errors="replace")
        return _strip_html(raw)
    except Exception as e:
        log.warning(f"Fetch failed for {url}: {e}")
        return UNAVAILABLE

def _extract_links(raw, base):
    """Extract same-domain href links from raw HTML."""
    links = []
    for m in re.finditer(r'href=["\']([^"\'#?]+)["\']', raw, re.IGNORECASE):
        href = m.group(1)
        if href.startswith("/"):
            links.append(base + href)
        elif href.startswith(base):
            links.append(href)
    return links

# Keywords that suggest a page has good company/product info
_SUPPLEMENT_KEYWORDS = re.compile(
    r"/(about|company|team|product|service|solution|platform|technology|tech|"
    r"who-we-are|what-we-do|how-it-works|features|why)[^/]*$",
    re.IGNORECASE,
)
# Fallback paths to try if link extraction yields nothing promising
_FALLBACK_PATHS = ["/about", "/about-us", "/company", "/products", "/services",
                   "/solutions", "/platform", "/technology", "/docs"]

# Content is "thin" if useful text is below this threshold (chars)
_THIN_THRESHOLD = 800

def _search_ddg(query, max_results=5):
    """Query DuckDuckGo Instant Answer API and extract snippets. No API key needed."""
    try:
        url = f"https://api.duckduckgo.com/?q={quote_plus(query)}&format=json&no_html=1&skip_disambig=1"
        req = Request(url, headers={"User-Agent": "AegisBot/1.0 (kcp-package-generator)"})
        with urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        snippets = []
        # Abstract (Wikipedia-style summary)
        if data.get("AbstractText"):
            snippets.append(f"[Summary] {data['AbstractText']}")
        # Related topics
        for topic in data.get("RelatedTopics", [])[:max_results]:
            text = topic.get("Text", "")
            if text:
                snippets.append(text)
        return "\n".join(snippets)
    except Exception as e:
        log.warning(f"DDG search failed for '{query}': {e}")
        return ""

def _search_bing(query, max_results=5):
    """Query Bing Web Search API. Requires BING_SEARCH_KEY env var."""
    key = os.environ.get("BING_SEARCH_KEY", "")
    if not key:
        return ""
    try:
        url = f"https://api.bing.microsoft.com/v7.0/search?q={quote_plus(query)}&count={max_results}&mkt=en-US"
        req = Request(url, headers={"Ocp-Apim-Subscription-Key": key,
                                    "User-Agent": "AegisBot/1.0 (kcp-package-generator)"})
        with urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        snippets = []
        for item in data.get("webPages", {}).get("value", []):
            snippets.append(f"[{item['name']}] {item['snippet']}")
        return "\n".join(snippets)
    except Exception as e:
        log.warning(f"Bing search failed for '{query}': {e}")
        return ""

def search_web(domain):
    """Search for company info using Bing (if key set) or DDG fallback."""
    query = f"{domain} company"
    result = _search_bing(query) or _search_ddg(query)
    if result:
        log.info(f"Web search returned {len(result)} chars for '{query}'")
    return result

def fetch_website(url):
    """Fetch homepage + up to 2 supplementary pages discovered from homepage links."""
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    try:
        req = Request(url, headers={"User-Agent": "AegisBot/1.0 (kcp-package-generator)"})
        with urlopen(req, timeout=15) as r:
            raw_homepage = r.read(80_000).decode("utf-8", errors="replace")
    except Exception as e:
        log.warning(f"Homepage fetch failed for {url}: {e}")
        return "(Website unavailable — do not guess or infer company details. Set all product, description, and technology fields to empty strings. Add this comment at the top of the knowledge_yaml block: '# NOTE: Website was unavailable at generation time — all fields require manual review.')"

    homepage = _strip_html(raw_homepage)

    # Discover supplementary pages: prefer links found on homepage, fallback to fixed paths
    candidate_links = _extract_links(raw_homepage, base)
    seen = {url, base, base + "/"}
    ordered = []
    for link in candidate_links:
        link = link.rstrip("/")
        if link not in seen and _SUPPLEMENT_KEYWORDS.search(link):
            seen.add(link)
            ordered.append(link)

    if not ordered:
        ordered = [base + p for p in _FALLBACK_PATHS]

    extras = []
    for link in ordered:
        if len(extras) >= 2:
            break
        text = _fetch_page(link, timeout=8)
        if text != UNAVAILABLE and len(text) > 300:
            path = link.replace(base, "") or "/"
            extras.append(f"--- {path} ---\n{text[:4000]}")
            log.info(f"Fetched supplementary page: {link}")

    combined = homepage[:10000]
    if extras:
        combined += "\n\n" + "\n\n".join(extras)

    # If content is still thin (SPA or near-empty site), supplement with web search snippets
    if len(combined.strip()) < _THIN_THRESHOLD:
        domain = parsed.netloc
        log.info(f"Content thin ({len(combined.strip())} chars) — running web search for {domain}")
        search_snippets = search_web(domain)
        if search_snippets:
            combined += f"\n\n--- web search results for {domain} ---\n{search_snippets[:5000]}"

    return combined[:20000]

# ── KCP generation ────────────────────────────────────────────────────────────

TAG_MAP = {
    "knowledge_root":       "knowledge.yaml",
    "knowledge_products":   "knowledge/products.yaml",
    "knowledge_people":     "knowledge/people.yaml",
    "knowledge_technology": "knowledge/technology.yaml",
    "knowledge_customers":  "knowledge/customers.yaml",
    "knowledge_compliance": "knowledge/compliance.yaml",
    "llms_txt":             "llms.txt",
    "claude_md":            "CLAUDE.md",
    "agents_md":            "AGENTS.md",
    "setup_md":             "SETUP.md",
}

def generate_kcp(url, domain, website_text):
    template = open(PROMPT_PATH).read()
    prompt = (template
        .replace("{url}", url)
        .replace("{domain}", domain)
        .replace("{website_text}", website_text)
        .replace("{date}", str(date.today()))
    )
    env = os.environ.copy()
    result = subprocess.run(
        ["claude", "-p", prompt, "--output-format", "text", "--model", "claude-sonnet-4-6"],
        capture_output=True, text=True, timeout=300, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed (rc={result.returncode}): {result.stderr[:400]}")
    return result.stdout

def parse_output(text):
    files = {}
    for tag, filename in TAG_MAP.items():
        m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
        if not m:
            raise ValueError(f"Missing <{tag}> block in claude output")
        files[filename] = m.group(1).strip()
    return files

# ── File handling ─────────────────────────────────────────────────────────────

def archive_to_disk(domain, files):
    dest = os.path.join(DELIVERY_DIR, domain)
    for name, content in files.items():
        path = os.path.join(dest, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
    log.info(f"Archived to {dest}")

def build_zip(domain, files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(f"{domain}-kcp-package/{name}", content)
    return buf.getvalue()

# ── Email ─────────────────────────────────────────────────────────────────────

def send_resend(to, subject, html, attachments=None):
    payload = {"from": FROM_EMAIL, "to": to, "subject": subject, "html": html}
    if attachments:
        payload["attachments"] = attachments
    req = Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json", "User-Agent": "kcp-poller/1.0"},
        method="POST",
    )
    with urlopen(req, timeout=15) as r:
        resp = json.loads(r.read())
    log.info(f"Email sent to {to}: {resp.get('id')}")

def notify_started(domain, email):
    send_resend(
        to=NOTIFY_EMAIL,
        subject=f"[Ægis] 🔄 Pipeline started — {domain}",
        html=f"<p>Neuron picked up the job for <strong>{domain}</strong> → <strong>{email}</strong>. Generating now…</p>",
    )

def deliver_to_customer(domain, email, zip_bytes):
    send_resend(
        to=email,
        subject=f"Your Ægis AI-Readiness Package — {domain}",
        html=f"""<p>Hi,</p>
<p>Your Ægis AI-Readiness Package for <strong>{domain}</strong> is attached.</p>
<ul>
  <li><code>knowledge.yaml</code> — root manifest with identity &amp; imports</li>
  <li><code>knowledge/products.yaml</code> — products &amp; services</li>
  <li><code>knowledge/people.yaml</code> — key people &amp; leadership</li>
  <li><code>knowledge/technology.yaml</code> — tech stack, integrations, AI context</li>
  <li><code>knowledge/customers.yaml</code> — target customer segments</li>
  <li><code>knowledge/compliance.yaml</code> — certifications &amp; regulatory context</li>
  <li><code>llms.txt</code> — plain-text summary for AI tools</li>
  <li><code>CLAUDE.md</code> — context file for Claude / Cursor</li>
  <li><code>AGENTS.md</code> — context file for AI agents</li>
  <li><code>SETUP.md</code> — deployment instructions</li>
</ul>
<p>See <code>SETUP.md</code> for how to deploy these files. Questions? Reply here or
write to <a href="mailto:selina@exoreaction.com">selina@exoreaction.com</a>.</p>
<p>— Ægis</p>""",
        attachments=[{
            "filename": f"{domain}-kcp-package.zip",
            "content": base64.b64encode(zip_bytes).decode(),
        }],
    )

def notify_completed(domain, email):
    send_resend(
        to=NOTIFY_EMAIL,
        subject=f"[Ægis] ✅ Delivered — {domain}",
        html=f"<p>Package delivered to <strong>{email}</strong> for <strong>{domain}</strong>.</p>",
    )

# ── Pipeline ──────────────────────────────────────────────────────────────────

def process_job(url, email):
    domain = urlparse(url).hostname or url.replace("https://", "").split("/")[0]
    log.info(f"[{domain}] starting pipeline")

    notify_started(domain, email)

    log.info(f"[{domain}] fetching website")
    website_text = fetch_website(url)

    log.info(f"[{domain}] generating KCP via claude")
    raw_output = generate_kcp(url, domain, website_text)

    log.info(f"[{domain}] parsing output")
    files = parse_output(raw_output)

    archive_to_disk(domain, files)

    zip_bytes = build_zip(domain, files)

    deliver_to_customer(domain, email, zip_bytes)
    notify_completed(domain, email)

    log.info(f"[{domain}] ✅ complete")

# ── Poll loop ─────────────────────────────────────────────────────────────────

def main():
    os.makedirs(DELIVERY_DIR, exist_ok=True)
    log.info(f"kcp-poller started — queue {CF_QUEUE_ID} — polling every {POLL_INTERVAL}s")

    while True:
        try:
            messages = pull_messages()
        except Exception as e:
            log.warning(f"Queue poll failed: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        for msg in messages:
            lease_id = msg["lease_id"]
            try:
                raw_body = msg["body"]
                body = raw_body if isinstance(raw_body, dict) else json.loads(raw_body)
                url   = body["url"]
                email = body["email"]
                log.info(f"Claimed job: {url} → {email} (lease {str(lease_id)[:12]}…)")
                process_job(url, email)
                ack_message(lease_id)
            except Exception as e:
                log.error(f"Job failed: {e}", exc_info=True)
                try:
                    nack_message(lease_id)
                    log.info(f"Nacked — will retry after visibility timeout")
                except Exception as ne:
                    log.warning(f"Nack also failed: {ne}")

        if not messages:
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
