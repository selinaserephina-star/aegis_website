// Email CTA with clipboard fallback.
//
// Click → fires mailto: AND copies the address to the clipboard AND shows
// a small toast. Users with a registered mail handler get their mail app
// (mailto fires normally); users without get a clear "copied to clipboard"
// confirmation so they can paste into Gmail web, Slack, etc.

function showAegisToast(msg) {
  let t = document.getElementById("aegis-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "aegis-toast";
    t.className = "aegis-toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    document.body.appendChild(t);
  }
  t.textContent = msg;
  // re-trigger transition if a previous toast is still showing
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

function copyAndToast(email, opts) {
  const okMsg = (opts && opts.okMsg) || `${email} — copied to clipboard`;
  const failMsg = (opts && opts.failMsg) || `opening mail app for ${email}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(email).then(
      () => showAegisToast(okMsg),
      () => showAegisToast(failMsg),
    );
  } else {
    showAegisToast(failMsg);
  }
}

function MailCTA({ email, subject, className, children }) {
  const href = subject
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${email}`;
  return (
    <a
      className={className}
      href={href}
      onClick={() => copyAndToast(email)}
    >
      {children}
    </a>
  );
}

function MailCTAFootnote({ email }) {
  return (
    <div className="mail-cta-foot">
      <span className="dim">or write directly:</span>{" "}
      <a
        className="mail-cta-link"
        href={`mailto:${email}`}
        onClick={() => copyAndToast(email)}
      >
        {email} <span className="arrow">→</span>
      </a>
    </div>
  );
}

function MailCTAGroup({ email, subject, className, children }) {
  return (
    <div className="cta-with-foot">
      <MailCTA email={email} subject={subject} className={className}>
        {children}
      </MailCTA>
      <MailCTAFootnote email={email} />
    </div>
  );
}

Object.assign(window, { MailCTA, MailCTAFootnote, MailCTAGroup, showAegisToast });
