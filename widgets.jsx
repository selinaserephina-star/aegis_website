// Live demo widgets — Ask The Codebase + Mimir Morning Briefing

const { useState: useStateW, useEffect: useEffectW, useRef: useRefW } = React;

// ---------- Ask The Codebase ----------

function AskCodebase() {
  const [stack, setStack] = useStateW("");
  const [output, setOutput] = useStateW("");
  const [loading, setLoading] = useStateW(false);
  const [error, setError] = useStateW("");
  const outRef = useRefW(null);

  const examples = [
    "github.com/myorg/payments-api · Java 21 · Spring · 180 repos",
    "Monorepo · TypeScript · Next.js + tRPC · 40 engineers",
    "Python · Django · 8-year-old codebase · 12 services",
  ];

  const run = async (override) => {
    const input = (override ?? stack).trim();
    if (!input) return;
    setLoading(true);
    setError("");
    setOutput("");
    try {
      const prompt = `You are Ægis, an AI-era development partner running an "ægentisk maturity" preview for a codebase.
The user describes their codebase / stack in one line.
Output a TERSE, OPINIONATED preview maturity snapshot, in this exact terminal format — no preamble, no closing — fewer than 14 short lines.

Codebase: ${input}

Format:
[ ægentisk maturity · preview ]

≡ readiness ........ <score>/10  <one-line reason>
≡ blast radius ..... <low|medium|high>  <one-line reason>
≡ top automatable .. <area>
≡ top risk ......... <area>

// 3 prioritised actions
1. <action — one short imperative line>
2. <action — one short imperative line>
3. <action — one short imperative line>

// next step
<one short line — recommend a workshop, advisory, or hands-on engagement>

Use lower-case, monospace-friendly, no emoji, no markdown bold. Be specific to the stack named.`;

      const text = await window.claude.complete(prompt);
      // type out the response
      setOutput("");
      const chars = text.split("");
      let i = 0;
      const tick = () => {
        if (i >= chars.length) { setLoading(false); return; }
        const step = Math.min(3, chars.length - i);
        setOutput((s) => s + chars.slice(i, i + step).join(""));
        i += step;
        setTimeout(tick, 8);
        if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
      };
      tick();
    } catch (e) {
      setError(String(e?.message || e));
      setLoading(false);
    }
  };

  return (
    <section className="section" id="demo">
      <SectionLabel idx={1} total={11} name="LIVE · ÆGENTISK MATURITY · PREVIEW" />
      <h2 className="section-title">
        Try it. <span className="dim">Right now.</span>
      </h2>
      <p className="section-lede">
        Describe your codebase in one line. Get a 60-second sample maturity snapshot —
        the same shape we deliver in a paid review, just shallower.
      </p>

      <div className="demo-shell">
        <div className="demo-prompt">
          <span className="dim">$</span>
          <span> aegis review</span>
          <span className="dim"> --stack</span>
        </div>
        <div className="demo-input-row">
          <span className="prompt-arrow">›</span>
          <input
            type="text"
            className="demo-input"
            placeholder="describe your codebase…"
            value={stack}
            onChange={(e) => setStack(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            disabled={loading}
          />
          <button className="demo-run" onClick={() => run()} disabled={loading || !stack.trim()}>
            {loading ? <span className="run-spin">⠋</span> : <span>↵</span>}
          </button>
        </div>
        <div className="demo-examples">
          <span className="dim">// try</span>
          {examples.map((ex, i) => (
            <button key={i} className="demo-chip" onClick={() => { setStack(ex); run(ex); }} disabled={loading}>
              {ex}
            </button>
          ))}
        </div>

        {(output || loading || error) && (
          <pre className="demo-output" ref={outRef}>
            {error
              ? `// error\n${error}\n\n// fall back to the form below to book a real review.`
              : output || "// thinking…"}
            {loading && <span className="caret">▍</span>}
          </pre>
        )}
      </div>

      <p className="footnote">
        Powered by Claude Haiku · this is a sample, not a deliverable. Real review = 6–8 reports, architecture guards, prioritised roadmap.
      </p>
    </section>
  );
}

// ---------- Mimir Morning Briefing ----------

function Mimir() {
  // simulated rotating Slack-style pulse
  const channels = [
    { c: "#mimir-dev",     u: "mímir",  t: "[03:14] nightly index complete · 65,905 files · 0 schema drift · 4 stale skills flagged for review" },
    { c: "#mimir-dev",     u: "klaw",   t: "[06:02] PR #482 ready · characterisation tests green · waiting human approval (you)" },
    { c: "#mimir-gtm",     u: "mímir",  t: "[06:31] BD signal: target account expanded LinkedIn team to 14 engineers — outreach window open" },
    { c: "#mimir-finance", u: "mímir",  t: "[06:45] DM-only · invoice 0241 paid · runway recalculated · sources cited" },
    { c: "#mimir-product", u: "mímir",  t: "[07:00] morning briefing · 3 yesterday-decisions · 2 unblocked launches · 1 question for Thor" },
    { c: "#mimir-dev",     u: "mímir",  t: "[07:02] component library: 17 similarity calculators verified · MOSFETs now match by gate-charge ±5%" },
    { c: "#mimir-strategy",u: "mímir",  t: "[07:14] cross-role query: 'who is talking to manufacturers?' → 2 threads, 1 deal in motion" },
    { c: "#mimir-dev",     u: "mímir",  t: "[07:22] memory triage · 12 stale topics · human in deletion loop · awaiting nod" },
    { c: "#mimir-gtm",     u: "mímir",  t: "[07:31] javaBin Oslo · attendance confirmed · 38 RSVPs · venue capacity ok" },
    { c: "#mimir-product", u: "mímir",  t: "[07:48] client production deploy clean · synthesis re-indexed · 1.1s avg query" },
  ];
  const [shown, setShown] = useStateW(channels.slice(0, 4));
  const cursorRef = useRefW(4);
  const listRef = useRefW(null);

  useEffectW(() => {
    const id = setInterval(() => {
      setShown((prev) => {
        const next = channels[cursorRef.current % channels.length];
        cursorRef.current += 1;
        const out = [...prev, next];
        return out.slice(-7);
      });
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="section" id="mimir">
      <SectionLabel idx={9} total={11} name="LIVE · MÍMIR MORNING BRIEFING" />
      <h2 className="section-title">
        Wake up to a synchronised company.
      </h2>
      <p className="section-lede">
        Mímir composes the pulse. Slack channels carry it. No meetings. No status reports.
        No copy-pasting between tools.
      </p>

      <div className="mimir-shell">
        <div className="mimir-bar">
          <span className="mimir-dot" />
          <span className="dim">slack · ægis workspace · </span>
          <span>09 channels</span>
          <span className="dim mimir-clock">{new Date().toISOString().slice(11,16)} UTC</span>
        </div>
        <div className="mimir-list" ref={listRef}>
          {shown.map((m, i) => (
            <div className="mimir-row" key={`${i}-${m.t}`}>
              <span className="mimir-channel">{m.c}</span>
              <span className="mimir-user">@{m.u}</span>
              <span className="mimir-text">{m.t}</span>
            </div>
          ))}
        </div>
        <div className="mimir-foot">
          <span className="dim">// every line above is composed by an agent · zero copy-paste · audit-trailed</span>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { AskCodebase, Mimir });
