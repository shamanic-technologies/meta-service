import { describe, it, expect } from "vitest";
import { bareDomain, withOwnLinkParam } from "../../src/lib/own-link.js";

const V = "meta-service:cb162cb2-b4f1-4a62-aab0-08697e630fb7";
const P = `dy_post=${V}`;

describe("withOwnLinkParam", () => {
  it("decorates the bare closing link, the writer's words untouched", () => {
    expect(withOwnLinkParam("Qualify before you spend.\n\nGet started: distribute.you", "distribute.you", V)).toEqual({
      text: `Qualify before you spend.\n\nGet started: distribute.you/?${P}`,
      count: 1,
    });
  });
  it("keeps trailing punctuation outside, handles scheme, www, path, query and fragment", () => {
    const r = withOwnLinkParam(
      "See https://distribute.you/blog/x. Or www.distribute.you! Or http://distribute.you/?a=1#top, then (distribute.you).",
      "https://www.distribute.you",
      V,
    );
    expect(r.text).toBe(`See https://distribute.you/blog/x?${P}. Or www.distribute.you/?${P}! Or http://distribute.you/?a=1&${P}#top, then (distribute.you/?${P}).`);
    expect(r.count).toBe(4);
  });
  it("leaves another domain, a subdomain, an email, a lookalike and an already-tracked link alone", () => {
    const t = `dashboard.distribute.you kevin@distribute.you distribute.youtube.com notdistribute.you distribute.you/?${P} acme.com`;
    expect(withOwnLinkParam(t, "distribute.you", V)).toEqual({ text: t, count: 0 });
  });
  it("no brand domain = nothing changes", () => {
    expect(withOwnLinkParam("Get started: distribute.you", null, V).count).toBe(0);
  });
  it("bareDomain", () => {
    expect(bareDomain("https://www.Distribute.you/x")).toBe("distribute.you");
    expect(bareDomain("localhost")).toBeNull();
    expect(bareDomain("")).toBeNull();
  });
});
