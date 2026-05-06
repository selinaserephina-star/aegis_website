// Ægis · Ægentisk — single-page site

const { useState, useEffect, useMemo, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "amber",
  "density": "roomy",
  "showTestimonial": true,
  "showCase": true
}/*EDITMODE-END*/;

const ACCENTS = {
  amber:  { hex: "#E8B45C", oklch: "oklch(0.80 0.14 75)",  name: "phosphor amber" },
  bone:   { hex: "#E8E4DA", oklch: "oklch(0.92 0.01 80)",  name: "bone white" },
  rust:   { hex: "#D87A5C", oklch: "oklch(0.70 0.14 40)",  name: "rust" },
  cyan:   { hex: "#7CC9D6", oklch: "oklch(0.80 0.08 210)", name: "ice cyan" },
};

// ---------- shared atoms ----------

function SectionLabel({ idx, total, name }) {
  return (
    <div className="section-label">
      <span className="dim">[</span>
      <span> {String(idx).padStart(2, "0")} / {String(total).padStart(2, "0")} </span>
      <span className="dim">]</span>
      <span className="dim"> · </span>
      <span>{name}</span>
    </div>
  );
}

function Caret() { return <span className="caret" aria-hidden="true">▍</span>; }

function Rule({ label }) {
  return (
    <div className="rule">
      <span className="rule-line" />
      {label && <span className="rule-label">{label}</span>}
      <span className="rule-line" />
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

window.SectionLabel = SectionLabel;
window.Caret = Caret;
window.Stat = Stat;

// ---------- header ----------

function Header() {
  const [time, setTime] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const t = time.toISOString().slice(11, 19);
  const close = () => setOpen(false);
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="topbar-left">
          <span className="brand">ÆGIS</span>
          <span className="dim">/</span>
          <span>ægentisk</span>
        </div>
        <nav className="topbar-nav">
          <a href="#demo">demo</a>
          <a href="#offerings">offerings</a>
          <a href="#workshops">workshops</a>
          <a href="#advisory">advisory</a>
          <a href="#hands-on">hands-on</a>
          <a href="#tooling">tooling</a>
          <a href="#who">who</a>
          <a href="#engage">engage</a>
        </nav>
        <div className="topbar-right">
          <span className="status-dot" />
          <span className="dim">UTC</span>
          <span className="mono-time">{t}</span>
          <button className="hamburger" aria-label="menu" onClick={() => setOpen(o => !o)}>
            <span /><span /><span />
          </button>
        </div>
      </div>
      {open && (
        <div className="mobile-nav" onClick={close}>
          <a href="#demo" onClick={close}>demo</a>
          <a href="#offerings" onClick={close}>offerings</a>
          <a href="#workshops" onClick={close}>workshops</a>
          <a href="#advisory" onClick={close}>advisory</a>
          <a href="#hands-on" onClick={close}>hands-on</a>
          <a href="#tooling" onClick={close}>tooling</a>
          <a href="#who" onClick={close}>who</a>
          <a href="#engage" onClick={close}>engage</a>
        </div>
      )}
    </header>
  );
}

// ---------- sticky mobile CTA ----------

function StickyCTA() {
  return (
    <a className="sticky-cta" href="#engage">
      <span>$</span> book scoping call <span className="arrow">→</span>
    </a>
  );
}

// ---------- hero ----------

function HeroHeadline() {
  const letters = [
    { ch: "Æ", keep: true,  cls: "lig" },
    { ch: "g", keep: true },
    { ch: "e", keep: false },
    { ch: "n", keep: false },
    { ch: "t", keep: false },
    { ch: "i", keep: true },
    { ch: "s", keep: true },
    { ch: "k", keep: false },
  ];
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState(0);
  const timers = useRef([]);
  const clearAll = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const run = () => {
    clearAll(); setPhase(0); setTyped(0);
    letters.forEach((_, i) => { timers.current.push(setTimeout(() => setTyped(i + 1), 130 + i * 110)); });
    timers.current.push(setTimeout(() => setPhase(1), 130 + letters.length * 110 + 100));
    timers.current.push(setTimeout(() => setPhase(2), 130 + letters.length * 110 + 1100));
    timers.current.push(setTimeout(() => setPhase(3), 130 + letters.length * 110 + 2200));
  };
  useEffect(() => { run(); return clearAll; }, []);
  return (
    <h1 className="hero-title" onClick={run} title="replay">
      <span className={`headline ${phase >= 2 ? "is-collapsing" : ""} ${phase === 3 ? "is-final" : ""}`}>
        {letters.map((L, i) => {
          const visible = i < typed;
          const dropping = phase >= 2 && !L.keep;
          return (
            <span key={i} className={["ltr", L.cls || "", visible ? "in" : "out", dropping ? "drop" : "", L.keep ? "keep" : ""].join(" ")}>{L.ch}</span>
          );
        })}
        <span className={`headline-caret ${phase >= 1 ? "off" : ""}`}>▍</span>
        <span className="headline-dot dim">.</span>
      </span>
      <br />
      <span className="hero-sub">
        Organisations that work <em>with</em> AI<span className="dim">—</span>
        and <em>as</em> AI.<Caret />
      </span>
    </h1>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-meta">
        <span>// AI-era development partner</span>
        <span className="dim">— est. Oslo</span>
      </div>
      <HeroHeadline />
      <div className="hero-foot">
        <div className="hero-foot-col">
          <div className="dim">// what</div>
          <div>Talks · Workshops · Advisory · Hands-on · Tooling</div>
        </div>
        <div className="hero-foot-col">
          <div className="dim">// how</div>
          <div>Human-led. Production-grade. Memory as infrastructure.</div>
        </div>
        <div className="hero-foot-col">
          <a className="cta-primary" href="#demo">
            <span>$</span> try the live demo <span className="arrow">↓</span>
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------- offerings ----------

function Offerings() {
  const items = [
    { n: "01", k: "talks",     t: "Talks",       d: "Keynotes at company conferences and developer communities." },
    { n: "02", k: "workshops", t: "Workshops",   d: "Hands-on team training. SDD, Claude Code, KCP — on your codebase." },
    { n: "03", k: "advisory",  t: "Advisory",    d: "Ægentisk maturity review. One-off or monthly retainer." },
    { n: "04", k: "hands-on",  t: "Hands-on",    d: "We build alongside you. Agentic development → full transformation." },
    { n: "05", k: "tooling",   t: "Tooling",     d: "Synthesis · ExoCortex · KCP · Skills Library — implementation + license." },
  ];
  return (
    <section className="section" id="offerings">
      <SectionLabel idx={2} total={11} name="OFFERINGS" />
      <h2 className="section-title">Five ways to work with us.</h2>
      <p className="section-lede">Book one — or run the full programme.</p>
      <div className="offer-grid five">
        {items.map((o) => (
          <a key={o.n} className="offer" href={`#${o.k}`}>
            <div className="offer-num">{o.n}</div>
            <div className="offer-title">{o.t}</div>
            <div className="offer-desc">{o.d}</div>
            <div className="offer-arrow">→</div>
          </a>
        ))}
      </div>
    </section>
  );
}

// ---------- talks ----------

function Talks() {
  return (
    <section className="section" id="talks">
      <SectionLabel idx={3} total={11} name="TALKS" />
      <h2 className="section-title">On stage, where the builders are.</h2>
      <div className="two-col">
        <div>
          <div className="col-label">// developer communities</div>
          <p className="footnote" style={{margin:0}}>javaBin · Agentbrew · JVM, JavaScript and agentic-dev meetups across Oslo and beyond.</p>
        </div>
        <div>
          <div className="col-label">// businesses &amp; consultancies</div>
          <p className="footnote" style={{margin:0}}>Internal events and brown-bags for engineering &amp; product organisations across the Nordics.</p>
        </div>
      </div>
      <div className="callout">
        <span className="dim">→ recent</span>
        <span> javaBin Oslo Meetup · </span>
        <span className="dim">meetup.com/javabin/events/314316420</span>
      </div>
      <p className="footnote">Practical, opinionated, grounded in production — not hype.</p>
    </section>
  );
}

// ---------- workshops (with pricing) ----------

function Workshops() {
  return (
    <section className="section" id="workshops">
      <SectionLabel idx={4} total={11} name="WORKSHOPS" />
      <h2 className="section-title">The 10× Developer Productivity Workshop.</h2>
      <p className="section-lede">
        Transform your team into AI-era developers who ship 10× value — with a sharp eye on AI cost.
      </p>

      <div className="workshop-grid">
        <div className="workshop-loop">
          <div className="col-label">// iterative loop</div>
          <pre className="ascii">
{`  ┌──────┐   ┌──────┐   ┌────────┐
  │ build│ → │ test │ → │ change │
  └──────┘   └──────┘   └────────┘
                            │
                            ▼
  ┌──────┐   ┌──────────┐   ┌──────┐
  │repeat│ ← │ improve  │ ← │ learn│
  └──────┘   └──────────┘   └──────┘`}
          </pre>
        </div>
        <div>
          <div className="col-label">// what you bring</div>
          <p>Your own codebase or idea.</p>
          <div className="col-label spaced">// what you leave with</div>
          <p>A Claude that actually knows what it's working on. Personal license to the Skills Library.</p>
          <div className="col-label spaced">// delivered for</div>
          <p className="footnote" style={{margin:0}}>Engineering teams across consulting, product and applied-AI organisations.</p>
        </div>
      </div>

      <div className="pricing-grid">
        <div className="price-card">
          <div className="price-tag">INDIVIDUAL · OPEN ENROLMENT</div>
          <div className="price-headline">
            <span className="price-amount">9 000 NOK</span>
            <span className="price-unit">/ seat</span>
          </div>
          <ul className="check-list dense">
            <li>Next cohort · <strong>21 May</strong></li>
            <li>15 places only · first-come</li>
            <li>Personal license to the Skills Library included</li>
            <li>Bring your own codebase</li>
          </ul>
          <a className="cta-primary" href="mailto:totto@exoreaction.com?subject=Workshop%2021%20May%20-%20book%20a%20seat">
            <span>$</span> book your place <span className="arrow">→</span>
          </a>
        </div>

        <div className="price-card">
          <div className="price-tag">BUSINESS · TEAM TRAINING</div>
          <div className="price-headline">
            <span className="price-amount">enquire</span>
          </div>
          <ul className="check-list dense">
            <li>On your codebase, on your premises</li>
            <li>Tailored curriculum · paired follow-ups</li>
            <li>Skills Library business license available</li>
            <li>Half-day to multi-day formats</li>
          </ul>
          <a className="cta-primary outline" href="mailto:totto@exoreaction.com?subject=Business%20workshop%20enquiry">
            <span>$</span> enquire within <span className="arrow">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------- testimonial ----------

function Testimonial({ enabled }) {
  if (!enabled) return null;
  return (
    <section className="section testimonial" id="testimonial">
      <div className="quote-mark">&ldquo;</div>
      <blockquote>
        I&apos;ve been on many AI courses that promise a lot and deliver less. This was different.
        You show up with your own codebase and work with it all day.
        <strong> Before lunch we had written several skills</strong> — rules obvious to me, invisible to any AI.
        <br /><br />
        The instructor clearly doesn&apos;t just read about AI — he uses the tools daily on real
        problems. Claude now orients itself quickly in our codebase. Less noise, and an assistant
        that actually knows what it&apos;s working on. After one day we work noticeably smarter with AI.
      </blockquote>
      <div className="quote-attr">
        <span className="dim">—</span> Ketil Hjerpaasen <span className="dim">·</span>{" "}
        <span className="dim">Head of Consulting, Item Consulting</span>
      </div>

      <div className="quote-divider" />

      <div className="quote-lang dim">// no</div>
      <blockquote lang="no">
        Vår visjon i Mynder er nært knyttet til europeisk digital suverenitet. Vi utvikler en ny
        infrastruktur som gjør at virksomheter trygt kan ta i bruk AI-agenter — med sikkerheten,
        sporbarheten og compliance-forankringen som kreves når det står noe på spill. Tiden for å
        eksperimentere er over; nå handler det om å sette agenter i produksjon der de skaper reell
        forretningsverdi og kutter kostnader. Det er noe hele Europa etterspør.
        <br /><br />
        <strong>Etter at Totto kom inn har vi fått en etterlengtet tempoøkning</strong>, og leverer
        nå mer og raskere — uten å gå på akkord med kvalitet eller sikkerhet — tvert imot. Han er i
        tillegg svært hyggelig og en raus læremester, og det er et privilegium å bygge et agentisk
        selskap sammen med ham. Han er rett og slett et unikum, og vi er svært heldige som fikk ham
        med på laget.
      </blockquote>
      <div className="quote-attr">
        <span className="dim">—</span> Synnøve, CEO Mynder
      </div>
    </section>
  );
}

// ---------- advisory ----------

function Advisory() {
  return (
    <section className="section" id="advisory">
      <SectionLabel idx={5} total={11} name="ADVISORY" />
      <h2 className="section-title">Make your codebase agent-ready.</h2>
      <div className="two-col gap-wide">
        <div>
          <div className="col-label">// what we assess</div>
          <ul className="check-list">
            <li>Organisation and team readiness</li>
            <li>Tech stacks and codebase fit for agents</li>
            <li>Which areas can be automated</li>
            <li>How large is the blast radius</li>
          </ul>
        </div>
        <div>
          <div className="col-label">// what you get</div>
          <ul className="check-list">
            <li>6–8 technical reports</li>
            <li>Architecture guards</li>
            <li>Security analysis</li>
            <li>Prioritised roadmap for ægentisk adoption</li>
          </ul>
        </div>
      </div>
      <div className="callout">
        Available as a one-off engagement or as a monthly retainer for continuous access.
      </div>
    </section>
  );
}

// ---------- expanded case study ----------

function CaseStudy({ enabled }) {
  if (!enabled) return null;
  const deliverables = [
    { d: "D01", t: "Architecture map · all 12 services", how: "synthesis index" },
    { d: "D02", t: "Threat model · 21 signal types",     how: "automated scan + human review" },
    { d: "D03", t: "Secret rotation · CI hardening",     how: "guardrail script + paired" },
    { d: "D04", t: "Frontend perf budget + fixes",       how: "characterisation tests" },
    { d: "D05", t: "Backend N+1 audit + remediation",    how: "pattern refactor" },
    { d: "D06", t: "Database index review",              how: "query log analysis" },
    { d: "D07", t: "API contract documentation",         how: "auto-generated + reviewed" },
    { d: "D08", t: "Test pyramid restructure",           how: "characterisation testing" },
    { d: "D09", t: "Deploy pipeline v2 · canary",        how: "human-led rewrite" },
    { d: "D10", t: "Observability stack · traces",       how: "agent-paired" },
    { d: "D11", t: "Onboarding doc · auto-maintained",   how: "synthesis-driven" },
    { d: "D12", t: "Skills library · 18 team-specific",  how: "session-pattern mining" },
    { d: "D13", t: "Migration plan · legacy module",     how: "advisory + paired" },
    { d: "D14", t: "Cost model · AI usage caps",         how: "live spend tracker" },
    { d: "D15", t: "Code-review automation",             how: "klaw agent" },
    { d: "D16", t: "Strategic roadmap · 2 quarters",     how: "synthesis + workshop" },
    { d: "D17", t: "Vendor risk register",               how: "automated + signed off" },
    { d: "D18", t: "Knowledge graph of repos",           how: "kcp federation" },
    { d: "D19", t: "Briefing templates · 4 roles",       how: "mímir composer" },
    { d: "D20", t: "Train-the-trainer kit",              how: "skill packaging" },
    { d: "D21", t: "Live demo + handover deck",          how: "showcase" },
  ];
  const [open, setOpenCase] = useState(false);
  return (
    <section className="section case" id="case">
      <SectionLabel idx={6} total={11} name="CASE · MAR–APR 2026" />
      <h2 className="section-title">21 deliverables in 7 days.</h2>

      <div className="case-stats">
        <Stat value="21" label="deliverables" />
        <Stat value="1.75M" label="NOK · value at Oslo rates" />
        <Stat value="10×" label="throughput" />
      </div>

      <div className="case-timeline">
        <div className="col-label">// 7-day timeline · human-loop checkpoints marked ⌖</div>
        <ol className="case-days">
          <li><span className="case-day">D1</span> <span className="case-act">scope · index codebase · run synthesis</span> <span className="dim">⌖ kickoff</span></li>
          <li><span className="case-day">D2</span> <span className="case-act">architecture analysis · threat model</span></li>
          <li><span className="case-day">D3</span> <span className="case-act">security remediation · paired refactor</span> <span className="dim">⌖ midweek review</span></li>
          <li><span className="case-day">D4</span> <span className="case-act">frontend + backend fixes · characterisation tests</span></li>
          <li><span className="case-day">D5</span> <span className="case-act">strategic planning · cost model · skill packaging</span></li>
          <li><span className="case-day">D6</span> <span className="case-act">test pyramid · deploy pipeline · briefings</span></li>
          <li><span className="case-day">D7</span> <span className="case-act">handover · demo · train-the-trainer</span> <span className="dim">⌖ sign-off</span></li>
        </ol>
      </div>

      <div className="case-deliverables">
        <button className="case-toggle" onClick={() => setOpenCase(o => !o)}>
          {open ? "− hide" : "+ show"} all 21 deliverables
        </button>
        {open && (
          <div className="case-grid">
            {deliverables.map((d, i) => (
              <div className="case-item" key={i}>
                <span className="case-id">{d.d}</span>
                <span className="case-title">{d.t}</span>
                <span className="case-how dim">// {d.how}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- retainer ----------

function Retainer() {
  const items = [
    { t: "Agent-ready codebase", d: "More testable, modular, autonomous-friendly. Velocity compounds." },
    { t: "Market launches",      d: "Blockers patched. Launch becomes a scheduling decision." },
    { t: "Migration completion", d: "Architectural guidance against live production systems." },
    { t: "Security posture",     d: "Secret rotation, scanning, guardrails." },
    { t: "AI-ready team",        d: "Paired workshops + coached sprints. Muscle that compounds." },
  ];
  return (
    <section className="section" id="retainer">
      <Rule label="// continued engagement" />
      <h2 className="section-title small">The monthly retainer — five needs.</h2>
      <div className="retainer-grid">
        {items.map((it, i) => (
          <div key={i} className="retainer-card">
            <div className="retainer-num">0{i + 1}</div>
            <div className="retainer-title">{it.t}</div>
            <div className="retainer-desc">{it.d}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- hands-on ----------

function HandsOn() {
  return (
    <section className="section" id="hands-on">
      <SectionLabel idx={7} total={11} name="HANDS-ON" />
      <h2 className="section-title">We build alongside you.</h2>
      <p className="section-lede">
        AI digital workers running in production. Human-led, not autonomous. Single feature → full ægentisk transformation.
      </p>

      <div className="build-grid">
        <div className="build-card">
          <div className="col-label">// current builds</div>
          <div className="build-item">
            <span className="build-name">Active client build</span>
            <span className="dim">— production agentic infrastructure</span>
          </div>
          <div className="build-item">
            <span className="build-name">elprint</span>
            <span className="dim">— lib-electronic-components · Apache 2.0 · Java</span>
          </div>
          <p className="build-note">
            elprint: MPN normalisation, 17 specialised similarity calculators
            (resistors, MOSFETs, MCUs, sensors…), BOM validation, metadata for 135+ manufacturers.
          </p>
        </div>
        <div className="build-card">
          <div className="col-label">// reference agents</div>
          <div className="build-item">
            <span className="build-name">Mímir</span>
            <span className="dim"> ( ironclaw0 )</span>
          </div>
          <div className="build-item">
            <span className="build-name">Klaw</span>
            <span className="dim"> ( ironclaw1 )</span>
          </div>
          <p className="build-note">24/7 on AWS EC2.</p>
        </div>
        <div className="build-proof">
          <div className="proof-num">10–30×</div>
          <div className="proof-label">development speed<br/>with controlled quality</div>
        </div>
      </div>

      <div className="callout spaced">
        <span className="dim">// transformation arc · </span>
        <span>single feature → agentic team → ægentisk company. </span>
        <a href="agentic-company.html" className="link-amber">read the agentic company essay →</a>
      </div>
    </section>
  );
}

// ---------- tooling (KCP / Synthesis / ExoCortex / Skills) ----------

function Tooling() {
  const rows = [
    { c: "CLAUDE.md, hand-curated skill files",            e: "Semantic indexing, behavioural scoring" },
    { c: "Manual routing and memory maintenance",          e: "Deterministic, scheduled memory maintenance" },
    { c: "Scales to one developer, breaks at team scale",  e: "Scales to 289+ repos, 66,350 files, 529 skills" },
    { c: "Memory rots silently",                           e: "Push-based context: 53–80% fewer tool calls" },
  ];
  return (
    <section className="section" id="tooling">
      <SectionLabel idx={8} total={11} name="TOOLING" />
      <h2 className="section-title">Memory as <em>infrastructure</em>.</h2>
      <p className="section-lede">
        Most AI-dev setups treat memory as text files you maintain by hand. We treat it as a system —
        and we&apos;ll either implement it on your stack, or license you the pieces.
      </p>

      <div className="diff-table">
        <div className="diff-head">
          <div className="diff-h-c">CONFIGURATION APPROACH</div>
          <div className="diff-h-e">ÆGIS TOOLING</div>
        </div>
        {rows.map((r, i) => (
          <div className="diff-row" key={i}>
            <div className="diff-c"><span className="minus">−</span> {r.c}</div>
            <div className="diff-e"><span className="plus">+</span> {r.e}</div>
          </div>
        ))}
      </div>

      <div className="three-col spaced">
        <div className="tool-card">
          <div className="col-label">// 01 — synthesis</div>
          <div className="tool-name">Knowledge index across your entire codebase.</div>
          <ul className="check-list dense">
            <li>Lucene-based, sub-second retrieval across tens of thousands of files</li>
            <li>Knowledge graph of directory purpose &amp; archetype</li>
            <li>21 security signal types — incl. AI-specific threats</li>
            <li>Auto-generates skills from recurring session patterns</li>
          </ul>
          <div className="tool-stats">
            <Stat value="1.2s" label="answer latency" />
            <Stat value="−40%" label="tool calls" />
            <Stat value="+67%" label="reasoning time" />
          </div>
        </div>

        <div className="tool-card">
          <div className="col-label">// 02 — ExoCortex</div>
          <div className="tool-name">Declare → execute → verify.</div>
          <p className="tool-desc">
            Human-led ægentisk workflow. In the loop at the decisions that matter
            — out of it everywhere else.
          </p>
          <pre className="ascii small">
{`$ exo declare  intent
$ exo execute  --dry-run
$ exo verify   --human`}
          </pre>
        </div>

        <div className="tool-card">
          <div className="col-label">// 03 — kcp</div>
          <div className="tool-name">Federated org manifest.</div>
          <p className="tool-desc">
            <span className="dim">knowledge.yaml →</span> agents understand structure. Saves 33% context.
          </p>
          <div className="tool-principle">
            <span className="dim">// principle</span><br/>
            Agent memory rots. <code>topic-health</code> + <code>topic-triage</code> run
            nightly · zero LLM calls · human in the deletion loop.
            <br/><strong>Freshness beats completeness.</strong>
          </div>
        </div>
      </div>

      {/* Skills Library product card */}
      <div className="skills-product">
        <div className="skills-head">
          <div className="col-label">// 04 — skills library</div>
          <div className="skills-title">529 skills. 40 years of dev knowledge. Licensed.</div>
        </div>
        <div className="skills-grid">
          <div>
            <div className="col-label">// what&apos;s inside</div>
            <ul className="check-list dense">
              <li>Java · Spring · Kotlin · TypeScript · Python · React</li>
              <li>Architecture · security · testing · perf · DX patterns</li>
              <li>Auto-curated from real production sessions</li>
              <li>Behavioural scoring — stale skills retired automatically</li>
            </ul>
          </div>
          <div>
            <div className="col-label">// licensing</div>
            <ul className="check-list dense">
              <li><strong>Personal license</strong> — included with every workshop seat</li>
              <li><strong>Business license</strong> — enquire within</li>
              <li>Updated weekly · audit-trailed · self-hosted option</li>
            </ul>
            <a className="cta-primary outline" href="mailto:totto@exoreaction.com?subject=Skills%20Library%20-%20business%20license%20enquiry">
              <span>$</span> enquire about business licensing <span className="arrow">→</span>
            </a>
          </div>
        </div>
      </div>

      <p className="footnote">
        Implementation engagement available — we wire these into your stack and hand it back maintained.
      </p>
    </section>
  );
}

// ---------- who ----------

function Who() {
  return (
    <section className="section" id="who">
      <SectionLabel idx={10} total={11} name="WHO" />
      <h2 className="section-title">Who builds this.</h2>
      <div className="who-grid">
        <div className="who-portrait" aria-hidden="true">
          <div className="who-mono">THH</div>
          <div className="who-portrait-meta dim">// portrait pending</div>
        </div>
        <div className="who-body">
          <div className="who-name">Thor Henning Hetland</div>
          <div className="who-role dim">Founder · Ægis · ægentisk practitioner</div>
          <p>
            Four decades shipping production code across Java, Kotlin, TypeScript, Python and the
            architectures around them. Spent the last few years using agentic tools every day on
            real client problems — long enough to have opinions, scars, and a working method.
          </p>
          <p>
            Ægis is the practice that came out of that. The tooling (Synthesis · ExoCortex · KCP),
            the workshops, the case studies — all of it is what I do daily, packaged so a team can
            adopt it without re-living the learning curve.
          </p>
          <div className="who-links">
            <a href="https://wiki.totto.org/about/" target="_blank" rel="noopener" className="link-amber">wiki.totto.org/about →</a>
            <span className="dim">·</span>
            <a href="mailto:totto@exoreaction.com" className="link-amber">totto@exoreaction.com →</a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- rollout ----------

function Rollout() {
  const weeks = [
    { w: "WEEK 0",   t: "Core infra",       d: "Synthesis workspaces · Mímir Slack channels." },
    { w: "WEEK 1",   t: "Dev activation",   d: "Claude Code live · codebase indexed · #mimir-dev active." },
    { w: "WEEK 2–3", t: "Role activation",  d: "Morning briefings · meeting prep · BD signals live." },
    { w: "WEEK 4",   t: "API hardening",    d: "CRM and Accounting APIs fully automated." },
    { w: "WEEK 5–6", t: "Polish & showcase",d: "Cross-role query testing · live demo." },
  ];
  return (
    <section className="section" id="rollout">
      <Rule label="// 6-week rollout" />
      <h2 className="section-title small">From zero to ægentisk — in six weeks.</h2>
      <div className="timeline">
        <div className="timeline-track" />
        <div className="timeline-steps">
          {weeks.map((wk, i) => (
            <div className="step" key={i}>
              <div className="step-dot" />
              <div className="step-week">{wk.w}</div>
              <div className="step-title">{wk.t}</div>
              <div className="step-desc">{wk.d}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="two-col gap-wide spaced">
        <div className="callout dense">
          <div className="col-label">// economic threshold</div>
          <p>Infra cost <strong>~15,000 NOK/month</strong>. Positive ROI the moment each team member saves 20 minutes a day.</p>
        </div>
        <div className="callout dense">
          <div className="col-label">// guardrails from day one</div>
          <p>Network isolation · financial outputs cite API sources · sensitive queries DM-only · hard spend alerts · documented backup admin · gradual channel rollout.</p>
        </div>
      </div>
    </section>
  );
}

// ---------- engage ----------

function Engage() {
  return (
    <section className="section" id="engage">
      <SectionLabel idx={11} total={11} name="ENGAGEMENT" />
      <h2 className="section-title">From scoping call to self-sufficient team.</h2>
      <div className="engage-flow">
        <div className="engage-step"><div className="engage-when">START</div><div className="engage-title">30-min scoping call</div><div className="engage-desc">Fit · goals · constraints.</div></div>
        <div className="engage-arrow">→</div>
        <div className="engage-step"><div className="engage-when">WEEK 1–2</div><div className="engage-title">Maturity review + workshop</div><div className="engage-desc">Assess · train · align.</div></div>
        <div className="engage-arrow">→</div>
        <div className="engage-step"><div className="engage-when">WEEK 3–8</div><div className="engage-title">Implementation + agentic build</div><div className="engage-desc">Ship to production together.</div></div>
        <div className="engage-arrow">→</div>
        <div className="engage-step"><div className="engage-when">WEEK 9+</div><div className="engage-title">Handover · train-the-trainer</div><div className="engage-desc">Your team keeps the velocity.</div></div>
      </div>
      <p className="footnote center">Or pick any single offering — talk · workshop · review · build · tooling.</p>
    </section>
  );
}

// ---------- cta ----------

function CTA() {
  return (
    <section className="section cta-section" id="contact">
      <div className="cta-meta">// let&apos;s talk</div>
      <h2 className="cta-title">
        An AI-era codebase.<br/>
        An AI-era team.<br/>
        <span className="dim">Start with 30 minutes.</span><Caret />
      </h2>
      <div className="cta-actions">
        <a className="cta-primary big" href="mailto:totto@exoreaction.com">
          <span>$</span> book scoping call <span className="arrow">→</span>
        </a>
        <div className="cta-links">
          <a href="https://aegis.org" className="cta-link">aegis.org</a>
          <span className="dim">·</span>
          <a href="https://wiki.totto.org" className="cta-link">wiki</a>
          <span className="dim">·</span>
          <a href="agentic-company.html" className="cta-link">/agentic-company</a>
        </div>
      </div>
    </section>
  );
}

// ---------- footer ----------

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-row">
        <div>
          <span className="brand small">ÆGIS</span>
          <span className="dim"> · ægentisk · </span>
          <span className="dim">© 2026</span>
        </div>
        <div className="dim">// human-led · production-grade · memory as infrastructure</div>
        <div className="dim">end of file ▍</div>
      </div>
    </footer>
  );
}

// ---------- app ----------

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => {
    const root = document.documentElement;
    const a = ACCENTS[tweaks.accent] || ACCENTS.amber;
    root.style.setProperty("--accent", a.oklch);
    root.style.setProperty("--accent-hex", a.hex);
  }, [tweaks.accent]);
  useEffect(() => { document.documentElement.dataset.density = tweaks.density; }, [tweaks.density]);

  return (
    <div className="page">
      <Header />
      <main>
        <Hero />
        <AskCodebase />
        <Offerings />
        <Talks />
        <Workshops />
        <Testimonial enabled={tweaks.showTestimonial} />
        <Advisory />
        <CaseStudy enabled={tweaks.showCase} />
        <Retainer />
        <HandsOn />
        <Tooling />
        <Mimir />
        <Who />
        <Rollout />
        <Engage />
        <CTA />
      </main>
      <Footer />
      <StickyCTA />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Accent">
          <TweakRadio value={tweaks.accent} onChange={(v) => setTweak("accent", v)}
            options={[{value:"amber",label:"amber"},{value:"bone",label:"bone"},{value:"rust",label:"rust"},{value:"cyan",label:"cyan"}]} />
        </TweakSection>
        <TweakSection label="Density">
          <TweakRadio value={tweaks.density} onChange={(v) => setTweak("density", v)}
            options={[{value:"compact",label:"compact"},{value:"roomy",label:"roomy"}]} />
        </TweakSection>
        <TweakSection label="Sections">
          <TweakToggle label="testimonial" checked={tweaks.showTestimonial} onChange={(v) => setTweak("showTestimonial", v)} />
          <TweakToggle label="case study"  checked={tweaks.showCase}        onChange={(v) => setTweak("showCase", v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
