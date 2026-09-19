"use strict";

// Port of app/src/test/.../importer/RecipeUrlTest.kt, row for row, plus the cases that only
// matter once this runs on a server rather than a phone.

const test = require("node:test");
const assert = require("node:assert/strict");
const RecipeUrl = require("./recipe-url");

const ok = input => {
  const result = RecipeUrl.normalize(input);
  assert.ok(result.url, `expected "${input}" to be accepted but got ${JSON.stringify(result)}`);
  return result.url;
};
const rejected = input => {
  const result = RecipeUrl.normalize(input);
  assert.ok(result.rejected, `expected "${input}" to be rejected but got ${JSON.stringify(result)}`);
};

test("accepts an ordinary recipe link", () => {
  assert.equal(ok("https://www.example.com/best-chili"), "https://www.example.com/best-chili");
});
test("adds https to a bare address", () => {
  assert.equal(ok("example.com/chili"), "https://example.com/chili");
});
test("upgrades http, because the fetch only ever speaks https", () => {
  assert.equal(ok("http://example.com/x"), "https://example.com/x");
});
test("takes the link out of shared text", () => {
  assert.equal(
    ok("Great chili! https://example.com/chili?utm_source=share&id=7#comments thanks"),
    "https://example.com/chili?id=7"
  );
});
test("drops tracking parameters but keeps ones that choose the page", () => {
  assert.equal(ok("https://example.com/chili?utm_source=a&utm_medium=b&fbclid=zz"), "https://example.com/chili");
  assert.equal(ok("https://example.com/recipe?id=42&utm_campaign=x"), "https://example.com/recipe?id=42");
});
test("ignores punctuation that ends a sentence", () => {
  assert.equal(ok("See https://example.com/chili."), "https://example.com/chili");
});
test("normalises case in the scheme and host only", () => {
  assert.equal(ok("HTTPS://Example.COM/Chili"), "https://example.com/Chili");
});
test("drops the default port", () => {
  assert.equal(ok("https://example.com:443/x"), "https://example.com/x");
});

test("rejects anything that is not a link", () => {
  rejected("");
  rejected("   ");
  rejected("hello world");
});
test("rejects schemes other than web", () => {
  rejected("ftp://example.com/x");
  rejected("file:///sdcard/recipe.html");
  rejected("javascript:alert(1)");
  rejected("content://com.android.providers/x");
});
test("rejects local and private addresses", () => {
  rejected("https://localhost/x");
  rejected("https://127.0.0.1/x");
  rejected("https://10.0.0.1/");
  rejected("https://192.168.1.10/x");
  rejected("https://172.16.5.5/x");
  rejected("https://169.254.169.254/latest/meta-data");
  rejected("https://[::1]/x");
  rejected("https://intranet/x");
  rejected("https://printer.local/x");
});
test("rejects the carrier-grade NAT range too", () => {
  // 100.64.0.0/10 is where a cloud host's own neighbours can live.
  rejected("https://100.64.0.1/x");
  rejected("https://100.127.255.254/x");
});
test("accepts a public IP address and the edges of the private ranges", () => {
  assert.equal(ok("https://8.8.8.8/"), "https://8.8.8.8/");
  assert.equal(ok("https://172.32.0.1/"), "https://172.32.0.1/");
  assert.equal(ok("https://100.63.0.1/"), "https://100.63.0.1/");
  assert.equal(ok("https://100.128.0.1/"), "https://100.128.0.1/");
});
test("rejects credentials in the link and unusual ports", () => {
  rejected("https://user:secret@example.com/x");
  rejected("https://example.com:8080/x");
});
test("rejects an absurdly long link", () => {
  rejected(`https://example.com/${"a".repeat(2100)}`);
});

test("names the site without www", () => {
  assert.equal(RecipeUrl.displayHost("https://www.example.com/x"), "example.com");
  assert.equal(RecipeUrl.displayHost("https://cooking.example.org/x"), "cooking.example.org");
});

// isPublicHost is used a second time, on what a hostname actually resolves to, so it is worth
// pinning directly rather than only through normalize().
test("isPublicHost judges an address on its own", () => {
  assert.equal(RecipeUrl.isPublicHost("8.8.8.8"), true);
  assert.equal(RecipeUrl.isPublicHost("example.com"), true);
  assert.equal(RecipeUrl.isPublicHost("169.254.169.254"), false);
  assert.equal(RecipeUrl.isPublicHost("0.0.0.0"), false);
  assert.equal(RecipeUrl.isPublicHost("224.0.0.1"), false);
  assert.equal(RecipeUrl.isPublicHost("999.1.1.1"), false);
});
