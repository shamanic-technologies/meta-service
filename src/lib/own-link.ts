/**
 * OWN-LINK TRACKING (FACTORY-P2-CONTENT-OUTCOMES, owner 2026-10-29). Byte-equal twin in meta-service
 * and social-service: keep both in step.
 *
 * Every link to the publishing brand's OWN site in a post we publish carries the post's
 * `dy_post=<subjectService>:<subjectId>` (the subject of its `post_published` occurrence), so
 * lead-service credits the visit, and the signup that follows, to the run that published the post.
 * Deterministic and applied at publish time only: the writer's words are never touched, only a
 * link to the brand's domain (bare `distribute.you`, `www.`, `http(s)://`, any path) gets the
 * parameter. Another domain, a subdomain (`dashboard.distribute.you`), an email address
 * (`kevin@distribute.you`) and a link that already carries `dy_post` are left as written.
 */

export const DY_POST_PARAM = "dy_post";

export function dyPostValue(subjectService: string, subjectId: string): string {
  return `${subjectService}:${subjectId}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** PURE: the bare host of a brand domain or URL ("https://www.Acme.com/x" -> "acme.com"), null when none. */
export function bareDomain(domainOrUrl: string | null | undefined): string | null {
  if (!domainOrUrl) return null;
  const raw = domainOrUrl.trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** PURE: `text` with `dy_post=<value>` on every link to `domain`; `count` = links decorated. */
export function withOwnLinkParam(text: string, domain: string | null, value: string): { text: string; count: number } {
  const host = bareDomain(domain);
  if (!host) return { text, count: 0 };
  // A link to the domain: not glued to a word, a dot, an @ or a slash before it (no subdomain, no
  // email, not inside another URL); an optional path / query / fragment; trailing punctuation
  // (. , ; : ! ? ) ' ") stays outside the link.
  const re = new RegExp(
    `(?<![\\w.@/:-])((?:https?:\\/\\/)?(?:www\\.)?${escape(host)})(?![\\w-]|\\.[a-z0-9])((?:[/?#][^\\s]*?)?)(?=[.,;:!?)'"]*(?:\\s|$))`,
    "gi",
  );
  let count = 0;
  const out = text.replace(re, (whole, base: string, rest: string) => {
    if (new RegExp(`[?&]${DY_POST_PARAM}=`).test(rest)) return whole;
    const hashAt = rest.indexOf("#");
    const beforeHash = hashAt >= 0 ? rest.slice(0, hashAt) : rest;
    const hash = hashAt >= 0 ? rest.slice(hashAt) : "";
    const path = beforeHash === "" ? "/" : beforeHash;
    const sep = path.includes("?") ? (path.endsWith("?") || path.endsWith("&") ? "" : "&") : "?";
    count++;
    return `${base}${path}${sep}${DY_POST_PARAM}=${value}${hash}`;
  });
  return { text: out, count };
}
