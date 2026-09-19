"use strict";

// Port of app/.../importer/RecipeUrl.kt. Keep the two in step.
//
// Turns whatever the chef pasted into one clean https address, or says why it cannot.
//
// The same rules are applied to every redirect the fetch follows, not just the first address,
// so a link cannot be bounced somewhere the chef could not have typed directly. On Android
// that matters because a phone following a link to 192.168.1.1 is poking at its own network.
// **Here it matters far more**: this code runs on Google's infrastructure, where "not a public
// address" also means the metadata server and anything else inside the project. Every rule
// below is load-bearing for that reason, not merely tidy.

const MAX_LENGTH = 2048;
const NOT_A_LINK = "Paste the web address of a recipe page, like https://example.com/best-chili.";
const NOT_PUBLIC = "That address isn't a public web page ChefVoice can import from.";

/** A share sheet hands over "Great chili! https://..." -- the link is what matters. */
const LINK_IN_TEXT = /https?:\/\/[^\s<>"']+/i;
const TRACKING_PARAMETER = /^(?:utm_[a-z_]+|fbclid|gclid|igshid|mc_cid|mc_eid|msclkid)$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const LOCAL_SUFFIXES = [".local", ".localdomain", ".internal", ".lan", ".home", ".corp", ".intranet"];

/**
 * Keeps the import to the public web. Refuses loopback, link-local (which on a cloud host is
 * the metadata server), every private and carrier-grade range, and multicast.
 */
function isPublicHost(host) {
  if (host.includes(":") || host.includes("[")) return false; // IPv6 literals
  if (!host.includes(".")) return false;
  if (host === "localhost" || LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix))) return false;
  const match = IPV4.exec(host);
  if (!match) return true;
  const octets = match.slice(1).map(Number);
  if (octets.some(n => !Number.isInteger(n) || n > 255)) return false;
  const [a, b] = octets;
  return !(a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224);
}

/** `{url}` when the address is usable, `{rejected}` with a message written for the chef. */
function normalize(input) {
  const text = String(input ?? "").trim();
  if (!text) return { rejected: NOT_A_LINK };

  const found = LINK_IN_TEXT.exec(text);
  let candidate = (found ? found[0] : text.replace(/^["'<>\s]+|["'<>\s]+$/g, ""))
    .replace(/[.,;!]+$/, "");
  if (!candidate.includes("://")) {
    if (/\s/.test(candidate)) return { rejected: NOT_A_LINK };
    candidate = `https://${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { rejected: NOT_A_LINK };
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  // http is upgraded rather than refused: nearly every recipe site redirects http to https
  // anyway, and the fetch itself only ever speaks https.
  if (scheme !== "http" && scheme !== "https") {
    return { rejected: "Only web addresses starting with https:// can be imported." };
  }
  if (url.username || url.password) return { rejected: NOT_A_LINK };
  const host = url.hostname.toLowerCase();
  if (!host) return { rejected: NOT_A_LINK };
  if (!isPublicHost(host)) return { rejected: NOT_PUBLIC };
  if (url.port && url.port !== "80" && url.port !== "443") return { rejected: NOT_PUBLIC };

  const query = url.search.replace(/^\?/, "")
    .split("&")
    .filter(part => part && !TRACKING_PARAMETER.test(part.split("=")[0]))
    .join("&");
  const path = url.pathname || "/";
  const normalized = `https://${host}${path}${query ? `?${query}` : ""}`;
  if (normalized.length > MAX_LENGTH) return { rejected: NOT_A_LINK };
  return { url: normalized };
}

/** The site name to show a chef: the host without a leading "www.". */
function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

module.exports = { normalize, displayHost, isPublicHost, MAX_LENGTH, NOT_A_LINK, NOT_PUBLIC };
