AM Route Importer v0.2

Deploy index.html, route-importer.html, route-importer.js and route-scanner.js in the same website folder.

The existing Supabase Edge Function API supports POST ?action=start, batch, status, results. It scans ALL hubs. v0.2 cannot limit scanning to CGK; hub selection filters results for export only.

Provide the actual Edge Function URL and a publishable/anon key at runtime. Never enter a service-role key. Ensure the Edge Function enforces proper authentication/authorization server-side before use.

Start/Resume/Pause are browser controls. Pausing does not cancel an in-flight server-side operation. Supabase writes are performed by the existing Edge Function.

Exported scanned CSV is intentionally partial. Merge with the 19-column routes.csv using the existing importer and validate missing categories and pricing before using it in the optimiser.
