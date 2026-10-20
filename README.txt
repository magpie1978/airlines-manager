AM affiliation frontend patch v2

Deploy these seven files together in the existing Route Importer directory. Existing production tables are not modified.

IMPORTANT: The scanner Edge Function already blocks affiliated origins; this adds a user-interface restriction and checks before scanner start, resume, results and CSV merge. The server remains authoritative.

The Rotation Optimiser uses js/app.js, which was not supplied. Its HTML alone cannot safely implement the guard. The Price Optimiser uses its own anonymous-key API and requires an authenticated affiliation data path before an authoritative guard can be added. Neither optimiser is modified in this ZIP.

Test: sign in; verify BKK disabled; verify CGK enabled; verify BKK scan rejected by backend; confirm existing records unchanged. If affiliation lookup fails, mutating importer controls remain disabled.
