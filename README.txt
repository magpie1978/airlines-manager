Airlines Manager shared sign-in cleanup v6

Deploy all files at their existing paths, preserving other website assets.

Changes: header hides credential inputs when signed in; Route Importer and affiliated manager duplicate login controls hidden; Rotation Optimiser removes duplicate sign-in UI and loads through shared session; Price Optimiser continues using shared authentication.

The Price Optimiser still displays a completed scan as Complete until its selected scan hub can be verified; backend rejection prevents BKK optimisation. Do not interpret a completed scan as pricing-ready.

Test: sign in once, switch tabs, verify Rotation Optimiser data loads, Route Importer session works, BKK remains blocked, and sign-out disables actions.

Important: same-origin iframe access is required. Deploy all files under the same domain and protocol. Do not use this package to change database RLS or Edge Function permissions.
