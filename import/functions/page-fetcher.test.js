"use strict";

// Covers app/src/test/.../importer/PageFetcherTest.kt's ground, plus the checks that only
// exist because this fetch happens on a server inside Google's network rather than on a phone.
//
// The most important rows here are the ones about where a redirect may go. A link the chef
// could not have typed must not become reachable by being redirected to.

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchPage, FetchError, isPublicAddress, isReadableType, messageForStatus, MAX_BYTES } = require("./page-fetcher");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

/** A fetch stand-in driven by a map of url -> {status, headers, body}. */
const fakeFetch = routes => {
  const requested = [];
  const impl = async url => {
    requested.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request: ${url}`);
    const headers = new Map(Object.entries(route.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: route.status ?? 200,
      headers: { get: name => headers.get(name.toLowerCase()) ?? null },
      body: route.body === undefined ? null : (async function* () { yield Buffer.from(route.body); })()
    };
  };
  return { impl, requested };
};

const html = '<html><head><title>x</title></head><body>hi</body></html>';

const expectFailure = async (promise, fragment) => {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof FetchError, `expected a FetchError, got ${error}`);
    assert.ok(error.message.includes(fragment), `expected "${error.message}" to mention "${fragment}"`);
    return true;
  });
};

test("reads an ordinary page", async () => {
  const fetcher = fakeFetch({
    "https://example.com/chili": { headers: { "content-type": "text/html; charset=utf-8" }, body: html }
  });
  const page = await fetchPage("https://example.com/chili", { fetchImpl: fetcher.impl, lookup: publicLookup });
  assert.equal(page.finalUrl, "https://example.com/chili");
  assert.ok(page.html.includes("<title>x</title>"));
});

test("follows a redirect and credits where the page actually came from", async () => {
  const fetcher = fakeFetch({
    "https://short.link/abc": { status: 301, headers: { location: "https://real.example.org/recipes/chili" } },
    "https://real.example.org/recipes/chili": { headers: { "content-type": "text/html" }, body: html }
  });
  const page = await fetchPage("https://short.link/abc", { fetchImpl: fetcher.impl, lookup: publicLookup });
  assert.equal(page.finalUrl, "https://real.example.org/recipes/chili");
});

test("resolves a relative redirect against the page it came from", async () => {
  const fetcher = fakeFetch({
    "https://example.com/old": { status: 302, headers: { location: "/new" } },
    "https://example.com/new": { headers: { "content-type": "text/html" }, body: html }
  });
  const page = await fetchPage("https://example.com/old", { fetchImpl: fetcher.impl, lookup: publicLookup });
  assert.equal(page.finalUrl, "https://example.com/new");
});

test("a redirect into a private address is refused, not followed", async () => {
  // The whole point of following redirects by hand: every hop goes back through the same
  // rules as the address the chef pasted.
  const fetcher = fakeFetch({
    "https://example.com/x": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }
  });
  await expectFailure(
    fetchPage("https://example.com/x", { fetchImpl: fetcher.impl, lookup: publicLookup }),
    "redirects somewhere ChefVoice can't open"
  );
  assert.deepEqual(fetcher.requested, ["https://example.com/x"]);
});

test("a redirect to another scheme is refused", async () => {
  const fetcher = fakeFetch({
    "https://example.com/x": { status: 302, headers: { location: "file:///etc/passwd" } }
  });
  await expectFailure(fetchPage("https://example.com/x", { fetchImpl: fetcher.impl, lookup: publicLookup }), "redirects somewhere");
});

test("a redirect with no destination is refused", async () => {
  const fetcher = fakeFetch({ "https://example.com/x": { status: 302, headers: {} } });
  await expectFailure(fetchPage("https://example.com/x", { fetchImpl: fetcher.impl, lookup: publicLookup }), "redirects somewhere");
});

test("a redirect loop gives up rather than spinning", async () => {
  const fetcher = fakeFetch({
    "https://example.com/a": { status: 302, headers: { location: "https://example.com/b" } },
    "https://example.com/b": { status: 302, headers: { location: "https://example.com/a" } }
  });
  await expectFailure(fetchPage("https://example.com/a", { fetchImpl: fetcher.impl, lookup: publicLookup }), "redirects too many times");
});

test("a hostname that resolves to a private address is refused before any request", async () => {
  // A hostname-only rule cannot catch this: "evil.example" is an ordinary name that can point
  // straight at the metadata server.
  const fetcher = fakeFetch({});
  const rebinding = async () => [{ address: "169.254.169.254", family: 4 }];
  await expectFailure(
    fetchPage("https://evil.example/x", { fetchImpl: fetcher.impl, lookup: rebinding }),
    "isn't a public web page"
  );
  assert.equal(fetcher.requested.length, 0);
});

test("one private address among several is enough to refuse the host", async () => {
  const fetcher = fakeFetch({});
  const mixed = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
  await expectFailure(fetchPage("https://mixed.example/x", { fetchImpl: fetcher.impl, lookup: mixed }), "isn't a public web page");
  assert.equal(fetcher.requested.length, 0);
});

test("a host that does not resolve is reported as unreachable", async () => {
  const fetcher = fakeFetch({});
  const failing = async () => { throw new Error("ENOTFOUND"); };
  await expectFailure(fetchPage("https://nope.example/x", { fetchImpl: fetcher.impl, lookup: failing }), "couldn't reach that site");
});

test("a page larger than the cap is truncated, not refused", async () => {
  const big = "a".repeat(MAX_BYTES + 5000);
  const fetcher = fakeFetch({
    "https://example.com/big": { headers: { "content-type": "text/html" }, body: big }
  });
  const page = await fetchPage("https://example.com/big", { fetchImpl: fetcher.impl, lookup: publicLookup, maxBytes: 64 });
  assert.equal(page.html.length, 64);
});

test("something that is not a page is refused", async () => {
  const fetcher = fakeFetch({
    "https://example.com/x.pdf": { headers: { "content-type": "application/pdf" }, body: "%PDF" }
  });
  await expectFailure(fetchPage("https://example.com/x.pdf", { fetchImpl: fetcher.impl, lookup: publicLookup }), "isn't a web page");
});

test("a refusal by the site is reported as the site refusing", async () => {
  const fetcher = fakeFetch({ "https://example.com/x": { status: 403 } });
  await expectFailure(fetchPage("https://example.com/x", { fetchImpl: fetcher.impl, lookup: publicLookup }), "wouldn't let ChefVoice read");
});

test("a timeout says so in the chef's language", async () => {
  const timing = async () => { const error = new Error("timed out"); error.name = "TimeoutError"; throw error; };
  await expectFailure(
    fetchPage("https://example.com/x", { fetchImpl: timing, lookup: publicLookup }),
    "took too long to respond"
  );
});

test("status messages match what Android tells the chef", () => {
  assert.ok(messageForStatus(401).includes("wouldn't let ChefVoice read"));
  assert.ok(messageForStatus(404).includes("wasn't found"));
  assert.ok(messageForStatus(429).includes("limiting requests"));
  assert.ok(messageForStatus(503).includes("had a problem"));
  assert.ok(messageForStatus(418).includes("418"));
});

test("readable content types are the ones a recipe can live in", () => {
  assert.equal(isReadableType("text/html; charset=utf-8"), true);
  assert.equal(isReadableType("application/xhtml+xml"), true);
  assert.equal(isReadableType("text/plain"), true);
  assert.equal(isReadableType("image/png"), false);
  assert.equal(isReadableType("application/pdf"), false);
});

test("isPublicAddress judges resolved addresses, including IPv6 and mapped ones", () => {
  assert.equal(isPublicAddress("93.184.216.34", 4), true);
  assert.equal(isPublicAddress("169.254.169.254", 4), false);
  assert.equal(isPublicAddress("127.0.0.1", 4), false);
  assert.equal(isPublicAddress("::1", 6), false);
  assert.equal(isPublicAddress("::", 6), false);
  assert.equal(isPublicAddress("fd00::1", 6), false);
  assert.equal(isPublicAddress("fe80::1", 6), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1", 6), false);
  assert.equal(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946", 6), true);
  assert.equal(isPublicAddress("", 4), false);
});
