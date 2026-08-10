---
name: kcp-manifest-discovery
description: Discover and consume a site's KCP (Knowledge Context Protocol) manifest at /knowledge.yaml to get grounded, source-cited organizational context instead of scraping or guessing from prose. Use this whenever you land on a domain and need to know what it is, what it offers, or who to contact — before falling back to parsing the homepage.
---

# KCP Manifest Discovery

KCP (Knowledge Context Protocol) is an open, federated manifest format for
publishing machine-readable organizational context. Spec:
https://github.com/Cantara/kcp

## Why use this instead of scraping the page

A KCP manifest gives you structured, typed, source-attributed facts (entity
identity, contact routes, services, people) instead of free text you'd have
to infer meaning from. It also tells you explicitly what's canonical
(`discovery.provenance`) and how confident to be (`discovery.confidence`),
so you don't have to guess.

## Discovery steps

1. **Fetch the root manifest** at `https://<domain>/knowledge.yaml`. If
   absent, the site doesn't publish KCP — fall back to normal page reading.
2. **Read `entity`** for identity (name, domain, aliases, location) and
   `contact` for who to reach and how.
3. **Check `discovery`** — `provenance: canonical` plus `maintained_by`
   tells you this manifest is authoritative for the domain, not a third-
   party guess. `confidence` and `llms_txt` (if present) point to
   corroborating material.
4. **Walk `services`** — each entry has an `id` and `summary`, and may
   point to a deeper `manifest` (a relative path to a sub-manifest, e.g.
   `knowledge/workshops.yaml`) or a list of `manifests`/`includes` for
   multi-file services (like a tooling suite). Fetch those relative to the
   root manifest's own location, not the page you started on.
5. **Check `people`** if you need named contacts rather than generic
   `contact` addresses — same pattern, a manifest reference to follow.
6. **Verify signing, if present.** A `signing` block with `scheme`,
   `public_key`, and `signature` means the manifest is cryptographically
   signed (typically ed25519). Fetch the public key and signature files
   and verify before treating unusually sensitive claims as trustworthy —
   most everyday lookups don't need this, but it matters if you're about
   to act on the manifest's contents (e.g. sending an email to the address
   it lists).

## When citing what you found

Attribute claims to the manifest explicitly ("per {domain}'s KCP manifest")
rather than presenting them as generic web knowledge — the whole point of
KCP is that the claim is sourced and dated, so preserve that when you pass
it along.

## Limits

KCP tells you what an organization *says* about itself, structured and
attributed — it is not independent verification. Treat it the way you'd
treat any first-party source: reliable for "what do they claim," not a
substitute for corroboration when the stakes are high.
