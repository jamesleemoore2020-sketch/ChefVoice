"use strict";

// The `chefvoice-share` Cloud Functions codebase: one HTTP function, reached only through the
// PWA's Hosting rewrite for /r/**, that answers a shared recipe link with a page a messaging
// app can preview (audit F29). Every rule is in share-page.js and documented there.
//
// Deployed on its own, like `chefvoice-notifications`, `chefvoice-billing` and
// `chefvoice-import`, so a bad deploy here cannot take anything else down with it. It reads one
// document per request and writes nothing.

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const { recipeIdFromPath, renderSharePage } = require("./share-page");

initializeApp();
const db = getFirestore();

// The client retries a failing read for most of a minute, far past this function's own timeout,
// which would turn a Firestore hiccup into an error page. A slow read gets the generic page.
const READ_TIMEOUT_MS = 3000;
const withinTimeout = promise => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error("recipe read timed out")), READ_TIMEOUT_MS).unref())
]);

exports.recipeSharePage = onRequest(
  // Public on purpose: the crawlers that draw link previews carry no credentials. The page
  // describes public recipes only, and the edge caches it, so few requests reach this.
  { region: "us-central1", invoker: "public", memory: "256MiB", timeoutSeconds: 10, maxInstances: 5 },
  async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.set("Allow", "GET, HEAD").status(405).send("");
      return;
    }
    const id = recipeIdFromPath(request.path);
    let recipe = null;
    if (id) {
      try {
        const snapshot = await withinTimeout(db.doc(`recipes/${id}`).get());
        // A private, unpublished or missing recipe gets the generic page; its name is never read out.
        if (snapshot.exists && snapshot.get("isPublic") === true) recipe = snapshot.data();
      } catch (error) {
        logger.warn("share page: recipe could not be read", { error: error?.message });
      }
    }
    const page = renderSharePage({ id, recipe });
    response.set(page.headers).status(200).send(request.method === "HEAD" ? "" : page.html);
  }
);
