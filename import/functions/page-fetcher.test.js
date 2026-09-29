"use strict";

// Covers app/src/test/.../importer/PageFetcherTest.kt's ground, plus the checks that only
// exist because this fetch happens on a server inside Google's network rather than on a phone.
//
// The most important rows here are the ones about where a redirect may go. A link the chef
// could not have typed must not become reachable by being redirected to.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  fetchPage, FetchError, isPublicAddress, isReadableType, messageForStatus, publicOnlyFetch,
  publicOnlyLookup, MAX_BYTES
} = require("./page-fetcher");

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
  const page = await fetchPage("https://example.com/chili", { fetchImpl: fetcher.impl });
  assert.equal(page.finalUrl, "https://example.com/chili");
  assert.ok(page.html.includes("<title>x</title>"));
});

test("follows a redirect and credits where the page actually came from", async () => {
  const fetcher = fakeFetch({
    "https://short.link/abc": { status: 301, headers: { location: "https://real.example.org/recipes/chili" } },
    "https://real.example.org/recipes/chili": { headers: { "content-type": "text/html" }, body: html }
  });
  const page = await fetchPage("https://short.link/abc", { fetchImpl: fetcher.impl });
  assert.equal(page.finalUrl, "https://real.example.org/recipes/chili");
});

test("resolves a relative redirect against the page it came from", async () => {
  const fetcher = fakeFetch({
    "https://example.com/old": { status: 302, headers: { location: "/new" } },
    "https://example.com/new": { headers: { "content-type": "text/html" }, body: html }
  });
  const page = await fetchPage("https://example.com/old", { fetchImpl: fetcher.impl });
  assert.equal(page.finalUrl, "https://example.com/new");
});

test("a redirect into a private address is refused, not followed", async () => {
  // The whole point of following redirects by hand: every hop goes back through the same
  // rules as the address the chef pasted.
  const fetcher = fakeFetch({
    "https://example.com/x": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }
  });
  await expectFailure(
    fetchPage("https://example.com/x", { fetchImpl: fetcher.impl }),
    "redirects somewhere ChefVoice can't open"
  );
  assert.deepEqual(fetcher.requested, ["https://example.com/x"]);
});

test("a redirect to another scheme is refused", async () => {
  const fetcher = fakeFetch({
    "https://example.com/x": { status: 302, headers: { location: "file:///etc/passwd" } }
  });
  await expectFailure(fetchPage("https://example.com/x", { fetchImpl: fetcher.impl }), "redirects somewhere");
});

test("a redirect with no destination is refused", async () => {
  const fetcher = fakeFetch({ "https://example.com/x": { status: 302, headers: {} } });
  await expectFailure(fetchPage("https://example.com/x", { fetchImpl: fetcher.impl }), "redirects somewhere");
});

test("a redirect loop gives up rather than spinning", async () => {
  const fetcher = fakeFetch({
    "https://example.com/a": { status: 302, headers: { location: "https://example.com/b" } },
    "https://example.com/b": { status: 302, headers: { location: "https://example.com/a" } }
  });
  await expectFailure(fetchPage("https://example.com/a", { fetchImpl: fetcher.impl }), "redirects too many times");
});

// ---- Real sockets --------------------------------------------------------------------------
// The address check is only worth anything if the connection uses the answer it checked. These
// run the production fetch -- undici with publicOnlyLookup as the socket's own lookup -- against
// a server on 127.0.0.1, with the name's answers supplied by the test. `allow` stands in for
// "public" so that loopback can play the part of a public site; the last one uses the real rule.

/** A page server on 127.0.0.1 that records every request it is sent. */
async function localSite(t) {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push({ url: request.url, host: request.headers.host });
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { port: server.address().port, seen };
}

/** A resolver that answers from a script, one answer per call, and counts the calls. */
const scripted = (...answers) => {
  const calls = [];
  const resolve = async (hostname, options) => {
    calls.push({ hostname, options });
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { resolve, calls };
};

const loopbackOnly = address => address === "127.0.0.1";
const loopback = [{ address: "127.0.0.1", family: 4 }];

test("the connection goes to the address the name was checked at, resolved once", async t => {
  const site = await localSite(t);
  const dns = scripted(loopback, [{ address: "10.0.0.5", family: 4 }]);
  const page = await fetchPage(`http://recipes.test:${site.port}/chili`, {
    fetchImpl: publicOnlyFetch({ resolve: dns.resolve, allow: loopbackOnly })
  });
  assert.ok(page.html.includes("<title>x</title>"));
  assert.deepEqual(site.seen, [{ url: "/chili", host: `recipes.test:${site.port}` }]);
  // One lookup, made by the connection. The second, private answer was never asked for: there
  // is no later lookup for a name to answer differently (DNS rebinding).
  assert.deepEqual(dns.calls.map(c => c.hostname), ["recipes.test"]);
  assert.equal(dns.calls[0].options.all, true);
});

test("a name that resolves to a private address never opens a connection", async t => {
  // A hostname-only rule cannot catch this: "evil.example" is an ordinary name that can point
  // straight at the metadata server.
  const site = await localSite(t);
  const dns = scripted([{ address: "169.254.169.254", family: 4 }]);
  await expectFailure(
    fetchPage(`http://evil.test:${site.port}/x`, { fetchImpl: publicOnlyFetch({ resolve: dns.resolve, allow: loopbackOnly }) }),
    "isn't a public web page"
  );
  assert.equal(site.seen.length, 0);
});

test("one private address among several is enough to refuse the name", async t => {
  const site = await localSite(t);
  const dns = scripted([...loopback, { address: "10.0.0.5", family: 4 }]);
  await expectFailure(
    fetchPage(`http://mixed.test:${site.port}/x`, { fetchImpl: publicOnlyFetch({ resolve: dns.resolve, allow: loopbackOnly }) }),
    "isn't a public web page"
  );
  assert.equal(site.seen.length, 0);
});

test("a name that does not resolve is reported as unreachable", async t => {
  const site = await localSite(t);
  const dns = scripted(new Error("ENOTFOUND"));
  await expectFailure(
    fetchPage(`http://nope.test:${site.port}/x`, { fetchImpl: publicOnlyFetch({ resolve: dns.resolve, allow: loopbackOnly }) }),
    "couldn't reach that site"
  );
  assert.equal(site.seen.length, 0);
});

test("with the real rule, a name that points at this machine is refused", async t => {
  const site = await localSite(t);
  const dns = scripted(loopback);
  await expectFailure(
    fetchPage(`http://sneaky.test:${site.port}/x`, { fetchImpl: publicOnlyFetch({ resolve: dns.resolve }) }),
    "isn't a public web page"
  );
  assert.equal(site.seen.length, 0);
});

test("the lookup answers in both of the shapes net.connect asks for", async () => {
  const records = [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }];
  const lookup = publicOnlyLookup(async () => records);
  const all = await new Promise((resolve, reject) => lookup("example.com", { all: true }, (e, list) => (e ? reject(e) : resolve(list))));
  assert.deepEqual(all, records);
  const one = await new Promise((resolve, reject) => lookup("example.com", {}, (e, address, family) => (e ? reject(e) : resolve({ address, family }))));
  assert.deepEqual(one, records[0]);
  // The old (hostname, family, callback) shape.
  const legacy = await new Promise((resolve, reject) => lookup("example.com", 4, (e, address) => (e ? reject(e) : resolve(address))));
  assert.equal(legacy, "93.184.216.34");
  // A refusal is an error in either shape, and it never hands over an address.
  const privateLookup = publicOnlyLookup(async () => [{ address: "10.0.0.1", family: 4 }]);
  for (const options of [{ all: true }, {}]) {
    const outcome = await new Promise(resolve => privateLookup("intranet.example", options, (error, address) => resolve({ error, address })));
    assert.ok(outcome.error instanceof FetchError, "refused with a FetchError");
    assert.equal(outcome.address, undefined);
  }
});

test("a page larger than the cap is truncated, not refused", async () => {
  const big = "a".repeat(MAX_BYTES + 5000);
  const fetcher = fakeFetch({
    "https://example.com/big": { headers: { "content-type": "text/html" }, body: big }
  });
  const page = await fetchPage("https://example.com/big", { fetchImpl: fetcher.impl, maxBytes: 64 });
  assert.equal(page.html.length, 64);
});

test("something that is not a page is refused", async () => {
  const fetcher = fakeFetch({
    "https://example.com/x.pdf": { headers: { "content-type": "application/pdf" }, body: "%PDF" }
  });
  await expectFailure(fetchPage("https://example.com/x.pdf", { fetchImpl: fetcher.impl }), "isn't a web page");
});

test("a refusal by the site is reported as the site refusing", async () => {
  const fetcher = fakeFetch({ "https://example.com/x": { status: 403 } });
  await expectFailure(fetchPage("https://example.com/x", { fetchImpl: fetcher.impl }), "wouldn't let ChefVoice read");
});

test("a timeout says so in the chef's language", async () => {
  const timing = async () => { const error = new Error("timed out"); error.name = "TimeoutError"; throw error; };
  await expectFailure(
    fetchPage("https://example.com/x", { fetchImpl: timing }),
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

test("IPv6 ranges that carry an IPv4 address inside, or that are not the public web, are refused", () => {
  // The same mapped address in its other spelling, and a public one it may carry.
  assert.equal(isPublicAddress("::ffff:7f00:1", 6), false);
  assert.equal(isPublicAddress("::ffff:a9fe:a9fe", 6), false);
  assert.equal(isPublicAddress("::ffff:93.184.216.34", 6), true);
  // NAT64 reaches whatever IPv4 address it wraps, the metadata server included.
  assert.equal(isPublicAddress("64:ff9b::a9fe:a9fe", 6), false);
  assert.equal(isPublicAddress("64:ff9b::169.254.169.254", 6), false);
  assert.equal(isPublicAddress("64:ff9b:1::1", 6), false);
  // 6to4 and Teredo wrap one too.
  assert.equal(isPublicAddress("2002:a9fe:a9fe::1", 6), false);
  assert.equal(isPublicAddress("2001:0:4136:e378:8000:63bf:3fff:fdd2", 6), false);
  // Multicast, documentation, discard-only, and the deprecated IPv4-compatible form.
  assert.equal(isPublicAddress("ff02::1", 6), false);
  assert.equal(isPublicAddress("ff0e::1", 6), false);
  assert.equal(isPublicAddress("2001:db8::1", 6), false);
  assert.equal(isPublicAddress("100::1", 6), false);
  assert.equal(isPublicAddress("::a9fe:a9fe", 6), false);
  // Ordinary global addresses, written every way an OS might write them.
  assert.equal(isPublicAddress("2a00:1450:4001:82a::200e", 6), true);
  assert.equal(isPublicAddress("2A00:1450:4001:082A:0000:0000:0000:200E", 6), true);
  assert.equal(isPublicAddress("2606:4700::6810:85e5", 6), true);
  // Something that is not an address at all.
  assert.equal(isPublicAddress("not-an-address", 6), false);
  assert.equal(isPublicAddress("example.com", 4), false);
  assert.equal(isPublicAddress("999.1.1.1", 4), false);
});
