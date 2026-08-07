#!/usr/bin/env python3
"""kcp-poller — Aegis KCP Pipeline worker on Neuron.

Polls Cloudflare Queue 'kcp-jobs', generates KCP packages via claude CLI,
and emails the delivery zip to the customer.

Env (from ~/.kcp/kcp.env via systemd EnvironmentFile):
  CF_ACCOUNT_ID, CF_QUEUE_ID, CF_API_TOKEN
  RESEND_API_KEY, ANTHROPIC_API_KEY
"""

import os, json, subprocess, zipfile, io, re, time, logging, base64, shutil, tempfile
import sys, sqlite3, multiprocessing
from urllib.request import urlopen, Request
from urllib.parse import urlparse, quote_plus
from urllib.error import URLError, HTTPError
from datetime import date, datetime
from pathlib import Path

# Load .env if present (python-dotenv)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

# ── Config ────────────────────────────────────────────────────────────────────
CF_ACCOUNT_ID  = os.environ.get("CF_ACCOUNT_ID", "")
CF_QUEUE_ID    = os.environ.get("CF_QUEUE_ID", "")
CF_API_TOKEN   = os.environ.get("CF_API_TOKEN", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL     = "aegis@exoreaction.com"
NOTIFY_EMAIL   = "selina@exoreaction.com"
DELIVERY_DIR   = os.path.expanduser("~/kcp-deliveries")
POLL_INTERVAL  = 30     # seconds between empty-queue polls
VISIBILITY_TIMEOUT = 600  # seconds — time allowed to process one job
BATCH_SIZE     = 1      # process one job at a time (claude takes 30-60s)
MAX_CODEBASE_WORKERS = 2  # max concurrent codebase jobs
PHASE3_MAX_RETRIES   = 2  # retry Phase 3 up to 2 times on failure

CF_BASE = (
    f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
    f"/queues/{CF_QUEUE_ID}/messages"
)

PROMPTS_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
PROMPT_PATH     = os.path.join(PROMPTS_DIR, "kcp-generate.txt")
CODEBASE_ARCHITECTURE_PROMPT = os.path.join(PROMPTS_DIR, "codebase-architecture.txt")
CODEBASE_SKILLS_PROMPT       = os.path.join(PROMPTS_DIR, "codebase-skills.txt")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kcp-poller")

# ── SQLite job state ─────────────────────────────────────────────────────────

JOBS_DB_PATH = os.path.expanduser("~/kcp-pipeline/jobs.db")

def _init_db():
    """Create the jobs table if it doesn't exist. Returns a connection."""
    os.makedirs(os.path.dirname(JOBS_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(JOBS_DB_PATH, timeout=10)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            type TEXT,
            repo TEXT,
            status TEXT,
            phase1_output_path TEXT,
            phase3_output_path TEXT,
            error TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.commit()
    return conn

def _update_job(job_id, **kwargs):
    """Update job fields. Thread-safe via separate connection per call."""
    conn = sqlite3.connect(JOBS_DB_PATH, timeout=10)
    try:
        kwargs["updated_at"] = datetime.utcnow().isoformat()
        sets = ", ".join(f"{k} = ?" for k in kwargs)
        vals = list(kwargs.values())
        conn.execute(f"UPDATE jobs SET {sets} WHERE id = ?", vals + [job_id])
        conn.commit()
    finally:
        conn.close()

def _create_job(job_id, job_type, repo):
    """Insert a new job record."""
    conn = sqlite3.connect(JOBS_DB_PATH, timeout=10)
    try:
        now = datetime.utcnow().isoformat()
        conn.execute(
            "INSERT OR REPLACE INTO jobs (id, type, repo, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (job_id, job_type, repo, "queued", now, now),
        )
        conn.commit()
    finally:
        conn.close()

def status():
    """Print a table of recent jobs (last 20)."""
    if not os.path.exists(JOBS_DB_PATH):
        print("No jobs database found.")
        return
    conn = sqlite3.connect(JOBS_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, type, repo, status, created_at, error FROM jobs ORDER BY created_at DESC LIMIT 20"
    ).fetchall()
    conn.close()

    if not rows:
        print("No jobs recorded yet.")
        return

    # Header
    print(f"{'ID':<20} {'TYPE':<10} {'REPO':<35} {'STATUS':<16} {'CREATED':<20} {'ERROR'}")
    print("-" * 130)
    for r in rows:
        err = (r["error"] or "")[:50]
        repo = (r["repo"] or "")[:34]
        jid = (r["id"] or "")[:19]
        created = (r["created_at"] or "")[:19]
        print(f"{jid:<20} {r['type'] or '':<10} {repo:<35} {r['status'] or '':<16} {created:<20} {err}")

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
    env.pop('ANTHROPIC_API_KEY', None)  # use subscription credentials, not API key
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
        subject=f"[Aegis] Pipeline started -- {domain}",
        html=f"<p>Neuron picked up the job for <strong>{domain}</strong> -> <strong>{email}</strong>. Generating now...</p>",
    )

def deliver_to_customer(domain, email, zip_bytes):
    send_resend(
        to=email,
        subject=f"Your Aegis AI-Readiness Package -- {domain}",
        html=f"""<p>Hi,</p>
<p>Your Aegis AI-Readiness Package for <strong>{domain}</strong> is attached.</p>
<ul>
  <li><code>knowledge.yaml</code> -- root manifest with identity &amp; imports</li>
  <li><code>knowledge/products.yaml</code> -- products &amp; services</li>
  <li><code>knowledge/people.yaml</code> -- key people &amp; leadership</li>
  <li><code>knowledge/technology.yaml</code> -- tech stack, integrations, AI context</li>
  <li><code>knowledge/customers.yaml</code> -- target customer segments</li>
  <li><code>knowledge/compliance.yaml</code> -- certifications &amp; regulatory context</li>
  <li><code>llms.txt</code> -- plain-text summary for AI tools</li>
  <li><code>CLAUDE.md</code> -- context file for Claude / Cursor</li>
  <li><code>AGENTS.md</code> -- context file for AI agents</li>
  <li><code>SETUP.md</code> -- deployment instructions</li>
</ul>
<p>See <code>SETUP.md</code> for how to deploy these files. Questions? Reply here or
write to <a href="mailto:selina@exoreaction.com">selina@exoreaction.com</a>.</p>
<p>-- Aegis</p>""",
        attachments=[{
            "filename": f"{domain}-kcp-package.zip",
            "content": base64.b64encode(zip_bytes).decode(),
        }],
    )

def notify_completed(domain, email):
    send_resend(
        to=NOTIFY_EMAIL,
        subject=f"[Aegis] Delivered -- {domain}",
        html=f"<p>Package delivered to <strong>{email}</strong> for <strong>{domain}</strong>.</p>",
    )

# ── Codebase Intelligence ─────────────────────────────────────────────────────

CODEBASE_TAG_MAP = {
    "architecture_report":   "architecture-report.md",
    "security_findings":     "security-findings.md",
    "technical_debt":        "technical-debt.md",
    "modernization_roadmap": "modernization-roadmap.md",
    "knowledge_yaml":        "knowledge.yaml",
    "llms_txt":              "llms.txt",
    "claude_md":             "CLAUDE.md",
    "agents_md":             "AGENTS.md",
}

def clone_repo(github_url, dest_dir):
    """Shallow clone a public GitHub repo into dest_dir. Returns path."""
    log.info(f"Cloning {github_url}")
    result = subprocess.run(
        ["git", "clone", "--depth=1", github_url, dest_dir],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git clone failed: {result.stderr[:300]}")
    log.info(f"Cloned to {dest_dir}")
    return dest_dir

def _run_claude(prompt_text, repo_path, repo_name, label, timeout=900):
    """Run a single claude CLI call and return stdout. Saves raw output for diagnostics."""
    env = os.environ.copy()
    env.pop('ANTHROPIC_API_KEY', None)  # use subscription credentials, not API key
    result = subprocess.run(
        [
            "claude", "-p", prompt_text,
            "--output-format", "text",
            "--model", "claude-sonnet-4-6",
            "--allowedTools", "Read,Glob,Grep,Bash",
            "--dangerously-skip-permissions",
        ],
        capture_output=True, text=True, timeout=timeout, env=env,
        cwd=repo_path,
    )
    debug_path = os.path.expanduser(f"~/kcp-deliveries/{repo_name.replace('/', '-')}-raw-{label}.txt")
    os.makedirs(os.path.dirname(debug_path), exist_ok=True)
    with open(debug_path, "w") as f:
        f.write(result.stdout)
    if result.returncode != 0:
        # Soft-fail: claude sometimes exits rc=1 after generating valid tagged output
        # (e.g. subscription rate-limit hit after Phase 1+2 token usage). If the
        # output contains the expected XML tags, log a warning and proceed.
        if result.stdout and ("<skill" in result.stdout or "<architecture_report" in result.stdout or "<module_knowledge" in result.stdout):
            log.warning(f"claude CLI exited rc={result.returncode} [{label}] but stdout contains valid tags — treating as soft-fail. stderr: {result.stderr[:200]}")
        else:
            raise RuntimeError(f"claude CLI failed [{label}] (rc={result.returncode}): {result.stderr[:400]}")
    return result.stdout

def generate_codebase_intelligence(repo_path, repo_name, job_id=None):
    """Run Phase 1 (architecture) and Phase 3 (skills) with checkpoint and retry."""
    today = str(date.today())
    short_name = repo_name.replace("/", "-")

    def render(template_path):
        return (open(template_path).read()
            .replace("{repo}", repo_name)
            .replace("{date}", today))

    # ── Phase 1+2: architecture + modules ──
    if job_id:
        _update_job(job_id, status="phase1_running")

    log.info(f"[{repo_name}] Phase 1+2: architecture + modules")
    arch_output = _run_claude(render(CODEBASE_ARCHITECTURE_PROMPT), repo_path, repo_name, "architecture", timeout=900)

    # Checkpoint: Phase 1 output is already saved by _run_claude to the debug path.
    # Record the path in job state before proceeding to Phase 3.
    phase1_path = os.path.expanduser(f"~/kcp-deliveries/{short_name}-raw-architecture.txt")
    if job_id:
        _update_job(job_id, status="phase1_done", phase1_output_path=phase1_path)
    log.info(f"[{repo_name}] Phase 1 checkpointed to {phase1_path}")

    # ── Phase 3: skills (with retry) ──
    if job_id:
        _update_job(job_id, status="phase3_running")

    log.info(f"[{repo_name}] Phase 3: skills")
    skills_output = None
    last_error = None
    for attempt in range(1 + PHASE3_MAX_RETRIES):
        try:
            skills_output = _run_claude(render(CODEBASE_SKILLS_PROMPT), repo_path, repo_name, "skills", timeout=900)
            if not skills_output or not skills_output.strip():
                raise RuntimeError("Phase 3 returned empty output")
            # Quick sanity check: must contain at least one <skill> tag
            if "<skill " not in skills_output and "<skill>" not in skills_output:
                raise RuntimeError("Phase 3 output missing <skill> tags — likely unparseable")
            last_error = None
            break
        except Exception as e:
            last_error = e
            if attempt < PHASE3_MAX_RETRIES:
                log.warning(f"[{repo_name}] Phase 3 attempt {attempt+1} failed: {e} — retrying...")
                time.sleep(5)
            else:
                log.error(f"[{repo_name}] Phase 3 failed after {1 + PHASE3_MAX_RETRIES} attempts: {e}")

    if last_error:
        if job_id:
            _update_job(job_id, status="failed", error=str(last_error)[:500])
        raise RuntimeError(f"Phase 3 failed after retries: {last_error}")

    phase3_path = os.path.expanduser(f"~/kcp-deliveries/{short_name}-raw-skills.txt")
    if job_id:
        _update_job(job_id, phase3_output_path=phase3_path)

    return arch_output + "\n" + skills_output

def parse_codebase_output(text):
    files = {}

    # Fixed tags — allow optional attributes e.g. <architecture_report id="...">
    for tag, filename in CODEBASE_TAG_MAP.items():
        m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", text, re.DOTALL)
        if not m:
            raise ValueError(f"Missing <{tag}> block in claude output")
        files[filename] = m.group(1).strip()

    # Per-module knowledge: <module_knowledge id="module-slug">...</module_knowledge>
    for m in re.finditer(r'<module_knowledge\s+id="([^"]+)">(.*?)</module_knowledge>', text, re.DOTALL):
        slug = m.group(1).strip()
        content = m.group(2).strip()
        files[f"knowledge/modules/{slug}.yaml"] = content

    # Skills: <skill id="skill-slug">...</skill>
    for m in re.finditer(r'<skill\s+id="([^"]+)">(.*?)</skill>', text, re.DOTALL):
        slug = m.group(1).strip()
        content = m.group(2).strip()
        files[f"skills/{slug}.yaml"] = content

    return files

def _extract_email_signals(files):
    """Extract personalisation signals from report files for the delivery email."""
    signals = {"overview": "", "high_count": 0, "medium_count": 0, "low_count": 0, "quick_win_count": 0}

    # Overview paragraph from architecture report
    arch = files.get("architecture-report.md", "")
    m = re.search(r"## Overview\s*\n\n?(.*?)(?=\n## |\Z)", arch, re.DOTALL)
    if m:
        signals["overview"] = m.group(1).strip()

    # Security severity counts from summary table
    sec = files.get("security-findings.md", "")
    for sev in ("high", "medium", "low"):
        m = re.search(rf"\| {sev.upper()}\s*\|\s*(\d+)", sec, re.IGNORECASE)
        if m:
            signals[f"{sev}_count"] = int(m.group(1))

    # Quick win count
    roadmap = files.get("modernization-roadmap.md", "")
    m = re.search(r"## Quick Wins.*?\n(.*?)(?=\n## |\Z)", roadmap, re.DOTALL)
    if m:
        signals["quick_win_count"] = len(re.findall(r"^\d+\.", m.group(1), re.MULTILINE))

    return signals


def deliver_codebase_report(repo_name, email, zip_bytes, file_manifest=None, files=None):
    skill_count = sum(1 for f in (file_manifest or []) if f.startswith("skills/"))
    module_count = sum(1 for f in (file_manifest or []) if f.startswith("knowledge/modules/"))
    signals = _extract_email_signals(files or {})
    email_template = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "email-delivery.html")).read()
    email_html = (email_template
        .replace("{repo_name}", repo_name)
        .replace("{module_count}", str(module_count))
        .replace("{skill_count}", str(skill_count))
        .replace("{overview}", signals["overview"])
        .replace("{high_count}", str(signals["high_count"]))
        .replace("{medium_count}", str(signals["medium_count"]))
        .replace("{low_count}", str(signals["low_count"]))
        .replace("{quick_win_count}", str(signals["quick_win_count"]))
    )
    send_resend(
        to=email,
        subject=f"Your codebase analysis is ready — {repo_name}",
        html=email_html,
        attachments=[{
            "filename": f"{repo_name.replace('/', '-')}-intelligence.zip",
            "content": base64.b64encode(zip_bytes).decode(),
        }],
    )

def process_codebase_job(github_url, email, job_id=None):
    """Process a codebase intelligence job. Can run in a subprocess."""
    repo_name = github_url.rstrip("/").split("github.com/")[-1]  # e.g. "directus/directus"
    short_name = repo_name.replace("/", "-")
    log.info(f"[{short_name}] starting codebase intelligence pipeline")

    send_resend(
        to=NOTIFY_EMAIL,
        subject=f"[Aegis] Codebase Intelligence started -- {short_name}",
        html=f"<p>Neuron picked up codebase job for <strong>{repo_name}</strong> -> <strong>{email}</strong>. Cloning &amp; analysing...</p>",
    )

    tmp = tempfile.mkdtemp(prefix="aegis-codebase-")
    try:
        repo_path = os.path.join(tmp, short_name)
        clone_repo(github_url, repo_path)

        log.info(f"[{short_name}] running claude analysis")
        raw_output = generate_codebase_intelligence(repo_path, repo_name, job_id=job_id)

        log.info(f"[{short_name}] parsing output")
        files = parse_codebase_output(raw_output)

        archive_to_disk(short_name, files)

        zip_bytes = build_zip(short_name, files)

        deliver_codebase_report(short_name, email, zip_bytes, file_manifest=list(files.keys()), files=files)

        send_resend(
            to=NOTIFY_EMAIL,
            subject=f"[Aegis] Codebase Intelligence delivered -- {short_name}",
            html=f"<p>Report delivered to <strong>{email}</strong> for <strong>{repo_name}</strong>.</p>",
        )

        if job_id:
            _update_job(job_id, status="complete")

        log.info(f"[{short_name}] complete")
    except Exception as e:
        if job_id:
            _update_job(job_id, status="failed", error=str(e)[:500])
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

# ── Background worker wrapper ────────────────────────────────────────────────

def _codebase_worker(github_url, email, job_id, lease_id):
    """Entry point for multiprocessing.Process — runs codebase job, acks/nacks queue."""
    try:
        process_codebase_job(github_url, email, job_id=job_id)
        ack_message(lease_id)
        log.info(f"[worker] acked lease for job {job_id}")
    except Exception as e:
        log.error(f"[worker] codebase job {job_id} failed: {e}", exc_info=True)
        try:
            nack_message(lease_id)
            log.info(f"[worker] nacked lease for job {job_id}")
        except Exception as ne:
            log.warning(f"[worker] nack failed for {job_id}: {ne}")

# ── Pipeline ──────────────────────────────────────────────────────────────────

def process_job(url, email, job_id=None):
    domain = urlparse(url).hostname or url.replace("https://", "").split("/")[0]
    log.info(f"[{domain}] starting pipeline")

    if job_id:
        _update_job(job_id, status="phase1_running")

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

    if job_id:
        _update_job(job_id, status="complete")

    log.info(f"[{domain}] complete")

# ── Poll loop ─────────────────────────────────────────────────────────────────

def _reap_workers(workers):
    """Remove finished processes from the workers list."""
    still_running = []
    for w in workers:
        if w.is_alive():
            still_running.append(w)
        else:
            w.join(timeout=1)
            log.info(f"[reap] worker pid={w.pid} finished (exit={w.exitcode})")
    return still_running

def main():
    # Require env vars for polling mode
    for var in ("CF_ACCOUNT_ID", "CF_QUEUE_ID", "CF_API_TOKEN", "RESEND_API_KEY"):
        if not os.environ.get(var):
            log.error(f"Missing required env var: {var}")
            sys.exit(1)

    os.makedirs(DELIVERY_DIR, exist_ok=True)
    _init_db()
    log.info(f"kcp-poller started -- queue {CF_QUEUE_ID} -- polling every {POLL_INTERVAL}s")

    codebase_workers = []  # list of multiprocessing.Process

    while True:
        # Reap finished workers
        codebase_workers = _reap_workers(codebase_workers)

        try:
            messages = pull_messages()
        except Exception as e:
            log.warning(f"Queue poll failed: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        for msg in messages:
            lease_id = msg["lease_id"]
            job_id = None
            try:
                raw_body = msg["body"]
                body = raw_body if isinstance(raw_body, dict) else json.loads(raw_body)
                job_type = body.get("type", "website")
                email    = body["email"]
                job_id   = body.get("job_id", f"{job_type}-{int(time.time())}")

                if job_type == "codebase":
                    github_url = body["github_url"]
                    log.info(f"Claimed codebase job: {github_url} -> {email} (lease {str(lease_id)[:12]}...)")

                    _create_job(job_id, "codebase", github_url)

                    # Check capacity
                    codebase_workers = _reap_workers(codebase_workers)
                    if len(codebase_workers) >= MAX_CODEBASE_WORKERS:
                        log.warning(f"At capacity ({MAX_CODEBASE_WORKERS} codebase workers) — nacking job {job_id}")
                        _update_job(job_id, status="queued", error="at capacity, returned to queue")
                        nack_message(lease_id)
                        continue

                    # Launch in background subprocess
                    p = multiprocessing.Process(
                        target=_codebase_worker,
                        args=(github_url, email, job_id, lease_id),
                        name=f"codebase-{job_id}",
                        daemon=True,
                    )
                    p.start()
                    codebase_workers.append(p)
                    log.info(f"Launched codebase worker pid={p.pid} for {job_id}")
                    # Do NOT ack here — the worker will ack/nack when done

                else:
                    url = body["url"]
                    log.info(f"Claimed website job: {url} -> {email} (lease {str(lease_id)[:12]}...)")

                    _create_job(job_id, "website", url)

                    # Website jobs run inline (fast, ~2 min)
                    process_job(url, email, job_id=job_id)
                    ack_message(lease_id)

            except Exception as e:
                log.error(f"Job failed: {e}", exc_info=True)
                try:
                    # Try to update job status if we have a job_id
                    if job_id:
                        _update_job(job_id, status="failed", error=str(e)[:500])
                except Exception:
                    pass
                try:
                    nack_message(lease_id)
                    log.info(f"Nacked -- will retry after visibility timeout")
                except Exception as ne:
                    log.warning(f"Nack also failed: {ne}")

        if not messages:
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        # Status command doesn't need queue env vars — just reads the DB
        status()
    else:
        main()
