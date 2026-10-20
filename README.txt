Shared sign-in v5 — staged website integration

Deploy index.html, am-shared-auth.js, airlines_manager.html, rotation.html, js/app.js, route-importer.html, js/route-auth.js and the remaining Route Importer JS files at the paths your existing site uses.

IMPORTANT: This implementation assumes all iframe pages share the same origin. It reuses the existing Supabase project. Auth is persisted in same-origin localStorage to support page refresh, unlike the previous in-memory-only sessions. Do not deploy on a public/shared browser if persistent sign-in is unwanted.

Do not remove server-side authentication/affiliation checks. Price Optimiser Edge Function still needs its own server-side affiliated-origin enforcement.

The rotation file is based on the latest previously supplied v3 patch; inspect differences against current deployment before replacing. Test on a staging branch first.
