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
// redirect hop rather than only the pasted address, exactly as on Android; and every hop's
// hostname is **resolved first**, with the fetch refused when any address it resolves to is
// not a public one. The second check is what a hostname-only rule cannot do: `evil.example`
// is a perfectly ordinary name that can point at 169.254.169.254.
//
// A name that passes the check and then changes its answer before the socket opens (DNS
// rebinding) is still possible in principle. Closing that needs pinning the connection to the
// address that was checked, which `fetch` gives no way to do; it is recorded here rather than
// left implied.

const dns = require("node:dns").promises;
const RecipeUrl = require("./recipe-url");

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; ChefVoice/1.0; +https://chefvoice-d7fec.web.app)";
const BAD_REDIRECT = "That link redirects somewhere ChefVoice can't open.";
const NOT_A_PAGE = "That link isn't a web page ChefVoice can read.";

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

/** True only for an address on the public internet. Used on what a hostname actually resolves to. */
function isPublicAddress(address, family) {
  const text = String(address || "").toLowerCase();
  if (!text) return false;
  if (family === 4 || /^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return RecipeUrl.isPublicHost(text);
  // IPv4-mapped ("::ffff:127.0.0.1") is an IPv4 address wearing a hat; judge the address inside.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (mapped) return RecipeUrl.isPublicHost(mapped[1]);
  if (text === "::" || text === "::1") return false;
  const head = text.split(":")[0];
  // "::something" -- compressed leading zeros, so not a global unicast address.
  if (!head) return false;
  // The first hextet, as the 16-bit number the address ranges are written in.
  const leading = parseInt(head, 16);
  if (Number.isNaN(leading)) return false;
  if (leading >= 0xfc00 && leading <= 0xfdff) return false; // unique-local fc00::/7
  if (leading >= 0xfe80 && leading <= 0xfebf) return false; // link-local fe80::/10
  return true;
}

/** Refuses the hop unless every address its hostname resolves to is a public one. */
async function assertPublicHost(host, lookup) {
  let records;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new FetchError("ChefVoice couldn't reach that site. Check the address and your connection.");
  }
  if (!records || !records.length) throw new FetchError(RecipeUrl.NOT_PUBLIC);
  for (const record of records) {
    if (!isPublicAddress(record.address, record.family)) throw new FetchError(RecipeUrl.NOT_PUBLIC);
  }
}

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
async function fetchPage(url, { fetchImpl = fetch, lookup = dns.lookup, maxBytes = MAX_BYTES } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(new URL(current).hostname, lookup);
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
  fetchPage, FetchError, isPublicAddress, isReadableType, messageForStatus,
  MAX_BYTES, MAX_REDIRECTS, USER_AGENT
};
