"use strict";

// The page behind a shared recipe link, https://chefvoice-d7fec.web.app/r/{recipeId}.
//
// It exists for link previews. A messaging app that is sent a link fetches it and reads its
// Open Graph tags to draw a card: the dish's name, a line about it, a photo. The PWA is one
// static index.html, so every link used to preview as a bare "ChefVoice" (audit F29).
//
// It is not the app. Crawlers read the tags and never run scripts; a person's browser runs
// /js/share-redirect.js and is sent straight on to the recipe's deep link, which the app
// already opens. The PWA's own service worker skips this page entirely.
//
// Pure functions only, so every rule here is tested without Firebase. index.js reads the recipe
// and hands it over. **Only a public recipe is ever described**: a private, unpublished or
// missing one gets the same generic page, so the link cannot be used to learn whether a recipe
// exists or what it is called.

const ORIGIN = "https://chefvoice-d7fec.web.app";
// The same pattern as web/sw.js and web/js/share-redirect.js; web/tests/hosting-config.test.mjs
// holds the three to it. The path is not percent-decoded: a recipe id is only ever made of these
// characters, so a link the app made never needs decoding, and an escape is not a recipe.
const SHARE_PATH = /^\/r\/([A-Za-z0-9_-]{1,128})\/?$/;
// A photo must come from this project's own Storage bucket, the same rule firestore.rules holds
// new recipes to. Older recipes can carry other URLs; those are left out rather than handed to
// every crawler that previews the link.
const STORAGE_IMAGE = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/chefvoice-d7fec\.firebasestorage\.app\/o\/[A-Za-z0-9%._~!*()-]+(\?[A-Za-z0-9%._~=&-]*)?$/;
const FALLBACK_IMAGE = `${ORIGIN}/assets/chefvoice-icon.png`;
const GENERIC_TITLE = "ChefVoice";
const GENERIC_DESCRIPTION = "ChefVoice turns what a chef says while cooking into a recipe.";
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 200;

// This page loads one script, from the PWA's own origin, and nothing else.
const POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'unsafe-inline'", "base-uri 'none'",
  "form-action 'none'", "frame-ancestors 'none'"
].join("; ");

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** One line, trimmed, cut at a word near `max` with an ellipsis. */
function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}

/** The recipe id in a /r/{id} path, or "" for any other path. */
function recipeIdFromPath(path) {
  return SHARE_PATH.exec(String(path ?? ""))?.[1] ?? "";
}

/** The first photo that is safe to hand to a crawler: an image from this project's bucket. */
function previewImage(media) {
  if (!Array.isArray(media)) return "";
  for (const item of media) {
    if (!item || item.type === "VIDEO") continue;
    const url = String(item.url ?? "");
    if (STORAGE_IMAGE.test(url)) return url;
  }
  return "";
}

/**
 * The tags a crawler reads for one recipe, or the generic ones. `recipe` must already be known
 * to be public: index.js passes null for anything else.
 */
function describe(id, recipe) {
  if (!id || !recipe) {
    return { title: GENERIC_TITLE, description: GENERIC_DESCRIPTION, image: FALLBACK_IMAGE, byline: "", url: `${ORIGIN}/`, recipe: false };
  }
  const author = clip(recipe.authorName, 60) || "a ChefVoice chef";
  const title = clip(recipe.title, MAX_TITLE) || "A ChefVoice recipe";
  const description = clip(recipe.description, MAX_DESCRIPTION) || `A recipe by ${author} on ChefVoice.`;
  const photo = previewImage(recipe.media);
  return {
    title,
    description,
    image: photo || FALLBACK_IMAGE,
    largeImage: Boolean(photo),
    byline: `By ${author} on ChefVoice`,
    url: `${ORIGIN}/r/${id}`,
    recipe: true
  };
}

/** Where a person is sent: the deep link the app already opens. */
const deepLink = id => (id ? `/?tab=community&recipe=${encodeURIComponent(id)}` : "/");

/**
 * The page and its headers. A described recipe may be cached a few minutes at the edge; the
 * generic page less, so a recipe published a moment ago is not previewed as generic for long.
 */
function renderSharePage({ id = "", recipe = null } = {}) {
  const page = describe(id, recipe);
  const tag = (attribute, name, content) => `<meta ${attribute}="${name}" content="${escapeHtml(content)}">`;
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(page.recipe ? `${page.title} · ChefVoice` : page.title)}</title>`,
    tag("name", "description", page.description),
    `<link rel="canonical" href="${escapeHtml(page.url)}">`,
    tag("property", "og:site_name", "ChefVoice"),
    tag("property", "og:type", page.recipe ? "article" : "website"),
    tag("property", "og:title", page.title),
    tag("property", "og:description", page.description),
    tag("property", "og:url", page.url),
    tag("property", "og:image", page.image),
    tag("name", "twitter:card", page.largeImage ? "summary_large_image" : "summary"),
    // Sends a person's browser on to the recipe. Crawlers do not run it, so they keep the tags.
    '<script src="/js/share-redirect.js"></script>',
    "<style>body{margin:0;font-family:system-ui,sans-serif;background:#fffbf8;color:#241a16}main{max-width:560px;margin:0 auto;padding:40px 20px}h1{font-size:1.6rem;margin:0 0 8px}p{color:#765f56;line-height:1.5}a{color:#b03e0e;font-weight:700}</style>",
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(page.title)}</h1>`,
    page.byline ? `<p>${escapeHtml(page.byline)}</p>` : "",
    `<p><a href="${escapeHtml(deepLink(page.recipe ? id : ""))}">Open ${page.recipe ? "this recipe" : "ChefVoice"}</a></p>`,
    "</main>",
    "</body>",
    "</html>"
  ].filter(Boolean).join("\n");
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": page.recipe ? "public, max-age=300, s-maxage=300" : "public, max-age=60, s-maxage=60",
    "Content-Security-Policy": POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  };
  return { html, headers };
}

module.exports = {
  renderSharePage, recipeIdFromPath, previewImage, deepLink, clip, escapeHtml,
  ORIGIN, GENERIC_TITLE, GENERIC_DESCRIPTION, FALLBACK_IMAGE, POLICY, SHARE_PATH
};
