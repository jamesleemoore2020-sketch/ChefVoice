// Loaded only by the page a shared recipe link returns, /r/{recipeId} (share/functions). That page
// is there for link previews: the crawler that draws a card reads its tags and never runs this.
// A person's browser does, and goes straight on to the recipe's deep link, which the app opens.
// A browser that has the app's service worker never sees the page; the worker redirects first.
const shared = /^\/r\/([A-Za-z0-9_-]{1,128})\/?$/.exec(location.pathname);
location.replace(shared ? `/?tab=community&recipe=${encodeURIComponent(shared[1])}` : '/');
