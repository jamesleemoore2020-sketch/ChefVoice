# ChefVoice Android v0.9.5 — Live Lease + Cloud Stability

- Live hosts renew `heartbeatAt` every 10 seconds; stale `LIVE` rooms expire client-side after 35 seconds, with a 90-second legacy grace window.
- Android system Back and Live host-exit safety from v0.9.4 are carried forward.
- Public/legacy recipes are treated as potentially cloud-backed. Delete is cloud-first and keeps the local copy if cloud deletion fails.
- Notification history can be cleared after reading; the backend opportunistically prunes up to 50 notification records older than 30 days whenever new activity arrives.
- Current Firestore rules include cumulative replies, reports, follower/reply notification preferences, and owner-only notification-history deletion.
- The isolated notification backend includes seven functions: message, recipe comment, comment reply, recipe like, new follower, followed-chef Live, and push delivery.
- IAM/App Check enforcement/Storage rules/protected cooking parser/Second Pass/WebRTC transport are unchanged.

Deployment and real-device acceptance are pending. A real Windows Gradle build remains the authoritative Android compile gate.
