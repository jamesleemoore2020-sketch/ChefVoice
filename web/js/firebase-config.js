// Firebase Web App registration for the existing ChefVoice project.
// Firebase web configuration is an app identifier, not an admin credential.
export const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyDPjXKnbVOMyV4pyeNjhqqjEoH3ebXyBgw",
  authDomain: "chefvoice-d7fec.firebaseapp.com",
  projectId: "chefvoice-d7fec",
  storageBucket: "chefvoice-d7fec.firebasestorage.app",
  messagingSenderId: "569377936753",
  appId: "1:569377936753:web:9b4a80907391f62b5d92d0",
  measurementId: "G-B2QPSF99GE"
});

/**
 * Web Push certificate (VAPID public key) from
 * Firebase Console → Project settings → Cloud Messaging → Web configuration.
 *
 * Unlike the config above this is not generated with the web app registration --
 * it has to be created once, by hand, and pasted here. Until it is, push
 * registration stays disabled and ChefVoice falls back to the in-app Activity
 * feed, which needs no key and already works. Nothing else in the app depends on
 * it, so an empty value is a supported state rather than a broken one.
 */
export const messagingVapidKey = "BBPsneedlG2ChqSZUbKxrMLUtxmH9Ek1y__flL-vF0He6OYW_V4H6NDK9QKqg039Bs4jTjgEOAzF2u9t5gxUIrE";
