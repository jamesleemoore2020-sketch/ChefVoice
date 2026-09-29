"use strict";

// The page behind a shared recipe link (audit F29). The rows that matter most are the privacy
// ones: a recipe that is not public must be indistinguishable from one that does not exist.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  renderSharePage, recipeIdFromPath, previewImage, deepLink, clip, GENERIC_TITLE, GENERIC_DESCRIPTION,
  FALLBACK_IMAGE, POLICY
} = require("./share-page");

const photo = "https://firebasestorage.googleapis.com/v0/b/chefvoice-d7fec.firebasestorage.app/o/recipes%2Fu1%2Fr1%2FpublicMedia%2Fslot-00?alt=media&token=abc-123";
const recipe = (overrides = {}) => ({
  title: "Garlic butter pasta",
  description: "Weeknight pasta with brown butter and a lot of garlic.",
  authorName: "DaPlug",
  isPublic: true,
  media: [{ type: "IMAGE", url: photo }],
  ...overrides
});

/** The content of one <meta> tag, by its property or name. */
const meta = (html, key) => {
  const match = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html);
  return match ? match[1] : null;
};

test("the recipe id comes only from a /r/{id} path", () => {
  assert.equal(recipeIdFromPath("/r/abc-DEF_123"), "abc-DEF_123");
  assert.equal(recipeIdFromPath("/r/abc/"), "abc");
  assert.equal(recipeIdFromPath("/r/"), "");
  assert.equal(recipeIdFromPath("/r/abc/extra"), "");
  assert.equal(recipeIdFromPath("/recipes/abc"), "");
  assert.equal(recipeIdFromPath("/r/../secret"), "");
  assert.equal(recipeIdFromPath("/r/a%2Fb"), "");
  assert.equal(recipeIdFromPath("/r/%E0%A4%A"), "");
  assert.equal(recipeIdFromPath(`/r/${"a".repeat(129)}`), "");
  assert.equal(recipeIdFromPath(undefined), "");
});

test("a public recipe is described by its own name, words and photo", () => {
  const { html } = renderSharePage({ id: "r1", recipe: recipe() });
  assert.equal(meta(html, "og:title"), "Garlic butter pasta");
  assert.equal(meta(html, "og:description"), "Weeknight pasta with brown butter and a lot of garlic.");
  assert.equal(meta(html, "og:image"), photo.replace(/&/g, "&amp;"));
  assert.equal(meta(html, "og:url"), "https://chefvoice-d7fec.web.app/r/r1");
  assert.equal(meta(html, "og:type"), "article");
  assert.equal(meta(html, "twitter:card"), "summary_large_image");
  assert.match(html, /<title>Garlic butter pasta · ChefVoice<\/title>/);
  assert.match(html, /By DaPlug on ChefVoice/);
  assert.match(html, /<link rel="canonical" href="https:\/\/chefvoice-d7fec\.web\.app\/r\/r1">/);
});

test("a person is sent on to the deep link the app already opens", () => {
  const { html } = renderSharePage({ id: "r1", recipe: recipe() });
  assert.match(html, /<script src="\/js\/share-redirect\.js"><\/script>/);
  assert.match(html, /<a href="\/\?tab=community&amp;recipe=r1">Open this recipe<\/a>/);
  assert.equal(deepLink("r1"), "/?tab=community&recipe=r1");
  assert.equal(deepLink(""), "/");
  // No other script, and none inline.
  assert.equal((html.match(/<script/g) || []).length, 1);
});

test("a recipe that is not public reads exactly like one that does not exist", () => {
  const missing = renderSharePage({ id: "r1", recipe: null }).html;
  const noId = renderSharePage({}).html;
  assert.equal(meta(missing, "og:title"), GENERIC_TITLE);
  assert.equal(meta(missing, "og:description"), GENERIC_DESCRIPTION);
  assert.equal(meta(missing, "og:image"), FALLBACK_IMAGE);
  assert.equal(meta(missing, "og:url"), "https://chefvoice-d7fec.web.app/");
  // index.js passes null for a private recipe, so the only difference a link can show is none:
  assert.equal(missing, noId);
  assert.ok(!missing.includes("r1"), "the id itself is not echoed back");
  assert.match(missing, /<a href="\/">Open ChefVoice<\/a>/);
});

test("everything a chef wrote is escaped", () => {
  const hostile = recipe({
    title: '"><script>alert(1)</script>',
    description: "Tom's <b>best</b> & only",
    authorName: '<img src=x onerror="alert(2)">'
  });
  const { html } = renderSharePage({ id: "r1", recipe: hostile });
  assert.ok(!html.includes("<script>alert"), "no script from a title");
  assert.ok(!html.includes("<b>"), "no markup from a description");
  assert.ok(!html.includes("<img"), "no markup from a name");
  assert.equal(meta(html, "og:title"), "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(meta(html, "og:description"), "Tom&#39;s &lt;b&gt;best&lt;/b&gt; &amp; only");
});

test("only a photo from this project's Storage bucket is previewed", () => {
  assert.equal(previewImage([{ type: "IMAGE", url: photo }]), photo);
  // A video first, then a photo: the photo.
  assert.equal(previewImage([{ type: "VIDEO", url: photo }, { type: "IMAGE", url: photo }]), photo);
  assert.equal(previewImage([{ type: "VIDEO", url: photo }]), "");
  // Somebody else's server, a look-alike bucket, a different scheme: none of them.
  assert.equal(previewImage([{ type: "IMAGE", url: "https://tracker.example/pixel.png" }]), "");
  assert.equal(previewImage([{ type: "IMAGE", url: "https://firebasestorage.googleapis.com/v0/b/someone-else.firebasestorage.app/o/x.jpg" }]), "");
  assert.equal(previewImage([{ type: "IMAGE", url: photo.replace("https:", "http:") }]), "");
  assert.equal(previewImage([{ type: "IMAGE", url: `${photo}"><script>` }]), "");
  assert.equal(previewImage(null), "");
  // No usable photo: the app's own icon, as a small card.
  const { html } = renderSharePage({ id: "r1", recipe: recipe({ media: [{ type: "IMAGE", url: "https://tracker.example/p.png" }] }) });
  assert.equal(meta(html, "og:image"), FALLBACK_IMAGE);
  assert.equal(meta(html, "twitter:card"), "summary");
});

test("long or missing words are handled", () => {
  const long = "Slow-roasted tomatoes with garlic and thyme ".repeat(10);
  const { html } = renderSharePage({ id: "r1", recipe: recipe({ title: long, description: long }) });
  assert.ok(meta(html, "og:title").length <= 120);
  assert.ok(meta(html, "og:description").length <= 200);
  assert.ok(meta(html, "og:title").endsWith("…"));
  const bare = renderSharePage({ id: "r1", recipe: recipe({ title: "", description: "  ", authorName: "" }) }).html;
  assert.equal(meta(bare, "og:title"), "A ChefVoice recipe");
  assert.equal(meta(bare, "og:description"), "A recipe by a ChefVoice chef on ChefVoice.");
  assert.equal(clip("  one\n two  ", 50), "one two");
});

test("the headers: cached briefly at the edge, and a policy that allows one script", () => {
  const described = renderSharePage({ id: "r1", recipe: recipe() }).headers;
  const generic = renderSharePage({}).headers;
  assert.equal(described["Content-Type"], "text/html; charset=utf-8");
  assert.match(described["Cache-Control"], /s-maxage=300/);
  assert.match(generic["Cache-Control"], /s-maxage=60/);
  for (const headers of [described, generic]) {
    assert.equal(headers["Content-Security-Policy"], POLICY);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
  }
  assert.match(POLICY, /default-src 'none'/);
  assert.match(POLICY, /script-src 'self'(;|$)/);
  assert.match(POLICY, /base-uri 'none'/);
});
