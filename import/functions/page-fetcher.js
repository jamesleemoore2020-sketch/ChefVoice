"use strict";

// Port of app/.../importer/PageFetcher.kt, with the extra checks a *server-side* fetch needs.
//
// A plain HTTP GET with no cookies, no login and no JavaScript, so it only ever sees what a
// search engine would. Nothing here is a way around a site's own access rules: a site that
// refuses the request is reported as refusing it.
//
// The difference from the phone: this runs inside Google's network, so "reach an address the
// chef could not have typed" would mean the project's own metadata server and anything else
// on the internal network. Two things guard that. The URL rules are re-applied to **every**
// redirect hop rather than only the pasted address, exactly as on Android; and every
// connection's hostname is resolved **by the connection itself**, which refuses to open when
// any address the name resolves to is not a public one. That second check is what a
// hostname-only rule cannot do: `evil.example` is a perfectly ordinary name that can point at
// 169.254.169.254.
//
// The check lives in the socket's own `lookup` (publicOnlyLookup) rather than before the
// fetch, and that is the point of it. The first version resolved and checked the name, and
// `fetch` then resolved it again to connect, so a name could answer with a public address to
// the check and a private one to the connection (DNS rebinding). Now the answer that was
// checked is the answer the socket connects to; there is no second lookup to race. TLS still
// verifies the certificate against the hostname, so pinning the address weakens nothing.

const dns = require("node:dns").promises;
const net = require("node:net");
const RecipeUrl = require("./recipe-url");

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; ChefVoice/1.0; +https://chefvoice-d7fec.web.app)";
const BAD_REDIRECT = "That link redirects somewhere ChefVoice can't open.";
const NOT_A_PAGE = "That link isn't a web page ChefVoice can read.";
const UNREACHABLE = "ChefVoice couldn't reach that site. Check the address and your connection.";

/** `message` is written for the chef, so callers can show it as it stands. */
class FetchError extends Error {}

const isReadableType = contentType =>
  contentType.startsWith("text/") || contentType.includes("html") || contentType.includes("xml");

function messageForStatus(code) {
  if (code === 401 || code === 403) return "That site wouldn't let ChefVoice read the page. Some sites block apps; try another link.";
  if (code === 404 || code === 410) return "That page wasn't found. Check the address.";
  if (code === 429) return "That site is limiting requests right now. Try again in a little while.";
  if (code >= 500 && code <= 599) return "That site had a problem loading the page. Try again later.";
  return `That site returned an unexpected response (${code}).`;
}

// Blocks inside global unicast (2000::/3) that are not the public web, or that carry an IPv4
// address inside them which could be anything, the metadata server included.
const SPECIAL_IPV6 = new net.BlockList();
SPECIAL_IPV6.addSubnet("2001::", 23, "ipv6"); // IETF protocol assignments, Teredo (2001::/32) among them
SPECIAL_IPV6.addSubnet("2001:db8::", 32, "ipv6"); // documentation
SPECIAL_IPV6.addSubnet("2002::", 16, "ipv6"); // 6to4: an IPv4 address wrapped in an IPv6 one

/** True only for an address on the public internet. Used on what a hostname actually resolves to. */
function isPublicAddress(address, family) {
  const text = String(address || "").trim().toLowerCase();
  if (!text) return false;
  if (family === 4 || net.isIPv4(text)) return net.isIPv4(text) && RecipeUrl.isPublicHost(text);
  if (!net.isIPv6(text)) return false;
  // One spelling for each address: "::ffff:127.0.0.1" and "::ffff:7f00:1" are the same address,
  // as are "64:ff9b::10.0.0.1" and "64:ff9b::a00:1".
  const canonical = new URL(`http://[${text}]`).hostname.slice(1, -1);
  // IPv4-mapped is an IPv4 address wearing a hat; judge the address inside.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return RecipeUrl.isPublicHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  // Only global unicast is the public internet. Everything else is refused: unspecified and
  // loopback, NAT64 (64:ff9b::/96, which reaches whatever IPv4 address it carries), unique- and
  // link-local, multicast (ff00::/8).
  if (canonical.startsWith(":")) return false;
  if ((parseInt(canonical.split(":")[0], 16) & 0xe000) !== 0x2000) return false;
  return !SPECIAL_IPV6.check(canonical, "ipv6");
}

/**
 * A `lookup` for the socket itself, in the shape `net.connect` calls it: resolves the name,
 * refuses unless every address it resolves to passes `allow`, and hands the socket the addresses
 * it just checked. One private address among several is enough to refuse the name.
 *
 * `resolve` and `allow` are parameters so a test can run this against a server on 127.0.0.1;
 * nothing in production passes either.
 */
function publicOnlyLookup(resolve = dns.lookup, allow = isPublicAddress) {
  return (hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    const family = typeof options === "number" ? options : Number(options?.family) || 0;
    resolve(hostname, { all: true, family }).then(records => {
      if (!records?.length || !records.every(record => allow(record.address, record.family))) {
        callback(new FetchError(RecipeUrl.NOT_PUBLIC));
      } else if (options?.all) {
        callback(null, records);
      } else {
        callback(null, records[0].address, records[0].family);
      }
    }, () => callback(new FetchError(UNREACHABLE)));
  };
}

/**
 * `fetch` over connections that resolve their own name with publicOnlyLookup. undici's own
 * `fetch`, not the global one: an undici Agent handed to the `fetch` bundled with a different
 * Node release can disagree with it about the dispatcher interface.
 */
function publicOnlyFetch({ resolve, allow, undici = require("undici") } = {}) {
  const dispatcher = new undici.Agent({ connect: { lookup: publicOnlyLookup(resolve, allow) } });
  return (url, init) => undici.fetch(url, { ...init, dispatcher });
}

let sharedFetch = null;
/** One pinned-lookup fetch per instance, so its connections are pooled across imports. */
const defaultFetch = () => (sharedFetch ??= publicOnlyFetch());

/** Reads at most `maxBytes`; a page bigger than that is truncated, not refused. */
async function readCapped(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    const room = maxBytes - total;
    if (buffer.length >= room) { chunks.push(buffer.subarray(0, room)); break; }
    chunks.push(buffer);
    total += buffer.length;
  }
  return Buffer.concat(chunks);
}

/** The charset the server declared, or UTF-8 when it declared none or an unknown one. */
function decodeBody(bytes, contentType) {
  const declared = /charset\s*=\s*"?([A-Za-z0-9_.:-]+)/i.exec(contentType || "")?.[1];
  const name = (declared || "utf-8").toLowerCase();
  try {
    return new TextDecoder(name).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Fetches one page. Returns `{finalUrl, html}` -- `finalUrl` is where the page actually came
 * from after any redirects, which is what gets credited.
 */
async function fetchPage(url, { fetchImpl = defaultFetch(), maxBytes = MAX_BYTES } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.8"
        }
      });
    } catch (error) {
      if (error instanceof FetchError) throw error;
      // A refusal from publicOnlyLookup arrives as the cause of fetch's own "fetch failed".
      if (error?.cause instanceof FetchError) throw error.cause;
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new FetchError("That site took too long to respond. Try again in a moment.");
      }
      throw new FetchError("ChefVoice couldn't load that page. Check your connection and try again.");
    }

    const status = response.status;
    if (status >= 300 && status <= 399) {
      const location = response.headers.get("location");
      if (!location) throw new FetchError(BAD_REDIRECT);
      let resolved;
      try {
        resolved = new URL(location.trim(), current).toString();
      } catch {
        throw new FetchError(BAD_REDIRECT);
      }
      // Every hop goes back through the same rules as the pasted address.
      const checked = RecipeUrl.normalize(resolved);
      if (!checked.url) throw new FetchError(BAD_REDIRECT);
      current = checked.url;
      continue;
    }
    if (status !== 200) throw new FetchError(messageForStatus(status));

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !isReadableType(contentType)) throw new FetchError(NOT_A_PAGE);
    const bytes = await readCapped(response, maxBytes);
    return { finalUrl: current, html: decodeBody(bytes, contentType) };
  }
  throw new FetchError("That link redirects too many times to follow.");
}

module.exports = {
  fetchPage, FetchError, isPublicAddress, isReadableType, messageForStatus, publicOnlyFetch,
  publicOnlyLookup, MAX_BYTES, MAX_REDIRECTS, USER_AGENT
};
