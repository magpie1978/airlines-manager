
/**
 * Airlines Manager Rotation Optimiser
 * app.js v1.0
 *
 * Automatic multi-hub mixed-fleet interface.
 *
 * All 149 catalogue models, including cargo-only freighters.
 *
 * Scenario A: Rebuild schedules from scratch.
 */

import {
  csv,
  prepare,
  getSupportedAircraft
} from "./engine.js";

let HUB = "BOM";
let rawRoutes = [];
let rawPricing = [];
let rawAircraft = [];
let availableHubs = [];
let loadGeneration = 0;
let activeDataSource = "CSV";
// In-memory reservation only; a page refresh clears it.
let confirmedX380Hub = null;
let resultHub = null;

function x380GroupsInResult() {
  return optimisationResult?.rotations?.filter(r => r.model === "X380Plus").length ?? 0;
}

function updateX380Controls() {
  const status = $("x380-status");
  if (status) status.textContent = confirmedX380Hub
    ? `7 of 10 X380Plus aircraft reserved for ${confirmedX380Hub}. The other 3 cannot form a group.`
    : "10 X380Plus aircraft available globally (one seven-aircraft group). No confirmed reservation.";
  const confirm = $("confirm-x380");
  if (confirm) confirm.disabled = isRunning || !optimisationResult || resultHub !== HUB ||
    x380GroupsInResult() !== 1 || (confirmedX380Hub !== null && confirmedX380Hub !== HUB);
  const release = $("release-x380");
  if (release) release.disabled = isRunning || confirmedX380Hub === null;
}

function confirmX380() {
  if (isRunning || !optimisationResult || resultHub !== HUB || x380GroupsInResult() !== 1) return;
  if (confirmedX380Hub && confirmedX380Hub !== HUB) return;
  confirmedX380Hub = HUB;
  updateX380Controls();
  setStatus(`Confirmed: one X380Plus group reserved for ${HUB} this session.`);
}

function releaseX380() {
  if (isRunning || !confirmedX380Hub) return;
  const previous = confirmedX380Hub;
  confirmedX380Hub = null;
  // Old proposed rotations must be rerun before they can be confirmed.
  optimisationResult = null;
  resultHub = null;
  clearResults();
  updateButtons();
  setStatus(`Released ${previous}'s X380Plus reservation. Run the optimiser again to create a new proposal.`);
}


function normaliseHub(value) {
  return String(value ?? "").trim().toUpperCase();
}

function updateHubHeading() {
  if ($("active-hub")) $("active-hub").textContent = HUB;
}

function discoverHubs(routes, pricing) {
  const routeHubs = new Set(routes.map(row => normaliseHub(row.hub)).filter(Boolean));
  const pricingHubs = new Set(pricing.map(row => normaliseHub(row.hub)).filter(Boolean));
  // A hub is usable only if it appears in both datasets.
  return [...routeHubs].filter(hub => pricingHubs.has(hub)).sort();
}

function renderHubOptions() {
  const select = $("hub-select");
  if (!select) return;
  select.replaceChildren();
  for (const hub of availableHubs) {
    const option = document.createElement("option");
    option.value = hub;
    option.textContent = hub;
    select.appendChild(option);
  }
  select.value = HUB;
  select.disabled = availableHubs.length < 2 || isRunning;
}

function activateHub(hub) {
  if (isRunning) return;
  const selected = normaliseHub(hub);
  if (!availableHubs.includes(selected)) return;
  HUB = selected;
  updateHubHeading();
  optimisationResult = null;
  resultHub = null;
  preparedData = null;
  clearResults();
  const routes = rawRoutes.filter(row => normaliseHub(row.hub) === HUB);
  const pricing = rawPricing.filter(row => normaliseHub(row.hub) === HUB);
  try {
    preparedData = prepare(routes, pricing, rawAircraft);
    if (!preparedData || !Array.isArray(preparedData.routes) || !Array.isArray(preparedData.aircraft)) {
      throw new Error("The optimisation engine returned invalid data.");
    }
    preparedData.hub = HUB;
    const fleet = getConfiguredFleet();
    $("routes").textContent = formatNumber(preparedData.routes.length);
    $("models").textContent = formatNumber(fleet.length);
    renderConfigurations(fleet);
    setStatus(`${HUB}: ${formatNumber(preparedData.routes.length)} owned routes loaded (${formatNumber(preparedData.routes.filter(r => r.pricingValid).length)} valid pricing); ${fleet.length} aircraft models ready.`);
    if (preparedData.routes.length === 0) {
      preparedData = null;
      setStatus(`${HUB}: no eligible owned routes found. Check the hub's routes.csv and pricing.csv records.`);
    }
  } catch (error) {
    console.error("[Rotation Optimiser] Hub preparation failed:", error);
    preparedData = null;
    $("routes").textContent = "—";
    $("models").textContent = "—";
    $("fleet-configurations")?.replaceChildren();
    setStatus(`Hub ${HUB}: ${error.message}`);
  }
  renderHubOptions();
  updateButtons();
}

const AIRCRAFT_PER_GROUP = 7;
const ECONOMY_PAYLOAD_TONNES = 0.1;

const DATA_FILES = [
  "./data/routes.csv",
  "./data/pricing.csv",
  "./data/aircraft.csv"
];

let preparedData = null;
let optimisationResult = null;
let worker = null;
let isRunning = false;

// ============================================================
// DOM AND FORMATTING
// ============================================================

function $(id) {
  return document.getElementById(id);
}

function setStatus(message) {
  const element = $("status");

  if (element) {
    element.textContent = message;
  }
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function formatMoney(value) {
  return formatNumber(Math.round(value));
}

function formatBillions(value) {
  return (value / 1_000_000_000).toFixed(3);
}

function percentage(part, total) {
  if (!(total > 0)) {
    return "0.0%";
  }

  return `${(100 * part / total).toFixed(1)}%`;
}

function appendRow(tbody, values) {
  const row = document.createElement("tr");

  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.appendChild(cell);
  }

  tbody.appendChild(row);
}

function clearResults() {
  for (const id of [
    "results",
    "fleet-results",
    "demand-results"
  ]) {
    $(id)?.replaceChildren();
  }
}

// ============================================================
// BUTTON STATE
// ============================================================

function updateButtons() {
  const runButton = $("run");
  const stopButton = $("stop");
  const downloadButton = $("download");

  if ($("hub-select")) $("hub-select").disabled = isRunning || availableHubs.length < 2;

  if (runButton) {
    runButton.disabled =
      isRunning || preparedData === null;
  }

  if (stopButton) {
    stopButton.disabled = !isRunning;
  }

  updateX380Controls();

  if (downloadButton) {
    downloadButton.disabled =
      isRunning ||
      !optimisationResult ||
      optimisationResult.rotations.length === 0;
  }
}

// ============================================================
// LOAD DATA
// ============================================================

async function loadCSVFile(path) {
  const response = await fetch(path, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Could not load ${path}: HTTP ${response.status}`
    );
  }

  return csv(await response.text());
}

// Supabase publishable credentials. Never use a service-role key in browser code.
const SUPABASE_URL = "https://eukgodthgusongsbhdwg.supabase.co";
const SUPABASE_KEY = "sb_publishable_pBMWDgyFgIUGetg6NwkKkA_rMa1--kc";
const PAGE_SIZE = 1000;

async function fetchSupabaseView(view) {
  const all = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${view}`);

    url.searchParams.set("select", "*");

    const orderColumns =
      view === "am_optimizer_aircraft"
        ? "aircraft_id.asc"
        : "route_id.asc,hub_code.asc";

    url.searchParams.set("order", orderColumns);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: SUPABASE_KEY,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      throw new Error(
        `${view}: HTTP ${response.status}: ${detail}`
      );
    }

    const batch = await response.json();

    if (!Array.isArray(batch)) {
      throw new Error(`${view}: unexpected response`);
    }

    all.push(...batch);

    if (batch.length < PAGE_SIZE) break;
  }

  return all;
}

async function loadSupabaseData() {
  const [routes, pricing, aircraft] = await Promise.all([
    fetchSupabaseView("am_optimizer_routes"),
    fetchSupabaseView("am_optimizer_pricing"),
    fetchSupabaseView("am_optimizer_aircraft")
  ]);
  
  if (!routes.length || !pricing.length || !aircraft.length) {
    throw new Error("Supabase returned an empty optimiser dataset");
  }
  return {

    routes: routes.map(r => ({
      scan_id: r.scan_id,
      route: r.route,
      hub: r.hub_code,
      airport_code: r.destination_code,
      ownership_status: r.ownership_status,
      route_id: r.route_id,
      distance_km: r.distance_km,
      category: r.destination_category
    })),
    pricing: pricing.map(p => ({
      scan_id: p.scan_id,
      route: p.route,
      distance_km: p.distance_km,
      hub: p.hub_code,
      airport_code: String(p.route ?? "").split("/")[1] ?? "",
      route_id: p.route_id,
      status: p.status,
      current_price_economy: p.current_price_economy,
      current_price_cargo: p.current_price_cargo,
      current_demand_economy: p.current_demand_economy,
      current_demand_cargo: p.current_demand_cargo
    })),
    aircraft
  };
}

function validateSupabaseData(candidate) {
  const requiredHubs = ["BOM", "MPM"];
  const routeKeys = new Set();
  const pricingKeys = new Set();
  const scanIds = new Set();

  const keyOf = row =>
    `${normaliseHub(row.hub)}:${String(row.route_id)}`;

  const excludedDestinationsForPricing =
  new Set(["BKK", "CGK", "DEL"]);
  
  // Validate route records.
  for (const route of candidate.routes) {
    const hub = normaliseHub(route.hub);
    const key = keyOf(route);

    if (!requiredHubs.includes(hub)) {
      throw new Error(`Unexpected route hub: ${hub}`);
    }

    if (!route.scan_id) {
      throw new Error(`Missing scan ID for route ${key}`);
    }
    scanIds.add(route.scan_id);

    if (routeKeys.has(key)) {
      throw new Error(`Duplicate route: ${key}`);
    }
    routeKeys.add(key);

    if (
(route.route_id === null ||
 route.route_id === undefined ||
 String(route.route_id).trim() === "" ||
 !Number.isSafeInteger(Number(route.route_id))) ||
      Number(route.route_id) <= 0 ||
     (route.distance_km === null ||
 route.distance_km === undefined ||
 String(route.distance_km).trim() === "" ||
 !Number.isFinite(Number(route.distance_km))) ||
      
      Number(route.distance_km) <= 0 ||
      !String(route.airport_code ?? "").trim() ||
      (route.category === null ||
       route.category === undefined ||
       String(route.category).trim() === "" ||
       !Number.isInteger(Number(route.category))) ||
      Number(route.category) < 1 ||
        Number(route.category) > 10
    ) {
      throw new Error(`Invalid route data: ${key}`);
    }

    if (route.ownership_status !== "owned") {
      throw new Error(`Non-owned route: ${key}`);
    }
  }

  // Validate pricing records and scan consistency.
  for (const price of candidate.pricing) {
    const hub = normaliseHub(price.hub);
    const key = keyOf(price);

    if (
  price.route_id === null ||
  price.route_id === undefined ||
  String(price.route_id).trim() === "" ||
  !Number.isSafeInteger(Number(price.route_id)) ||
  Number(price.route_id) <= 0
) {
  throw new Error(
    `Invalid pricing route ID: ${price.route_id}`
  );
}

    if (
  price.distance_km === null ||
  price.distance_km === undefined ||
  String(price.distance_km).trim() === "" ||
  !Number.isFinite(Number(price.distance_km)) ||
  Number(price.distance_km) <= 0
) {
  throw new Error(
    `Invalid pricing distance: ${key}`
  );
}

    const pricingDestination = String(
  price.airport_code ?? ""
).trim().toUpperCase();

const expectedRoute = `${hub}/${pricingDestination}`;

if (
  !/^[A-Z0-9]{3,5}$/.test(pricingDestination) ||
  String(price.route ?? "").trim().toUpperCase() !== expectedRoute
) {
  throw new Error(
    `Invalid pricing destination or route: ${key}`
  );
}

    

    if (!requiredHubs.includes(hub)) {
      throw new Error(`Unexpected pricing hub: ${hub}`);
    }

    if (!price.scan_id) {
      throw new Error(`Missing scan ID for pricing ${key}`);
    }

    if (String(price.status ?? "").trim().toLowerCase() !== "ok") {
      throw new Error(
        `Invalid pricing status for ${key}: ${price.status}`
      );
    }
        
    scanIds.add(price.scan_id);

    if (pricingKeys.has(key)) {
      throw new Error(`Duplicate pricing: ${key}`);
    }
    pricingKeys.add(key);

const rawValues = [
  price.current_price_economy,
  price.current_price_cargo,
  price.current_demand_economy,
  price.current_demand_cargo
];

if (rawValues.some(value =>
  value === null ||
  value === undefined ||
  String(value).trim() === ""
)) {
  throw new Error(`Missing pricing values: ${key}`);
}

const values = rawValues.map(Number);
    
    if (
      values.some(value => !Number.isFinite(value)) ||
      values[0] <= 0 ||
      values[1] <= 0 ||
      values[2] < 0 ||
      values[3] < 0
    ) {
      throw new Error(`Invalid pricing: ${key}`);
    }
  }

  if (scanIds.size !== 1) {
    throw new Error(
      `Inconsistent Supabase scan IDs: ${[...scanIds].join(", ")}`
    );
  }

    // Every owned route must have pricing, except BOM/MPM.
  const allowedUnpricedRoutes = new Set(["BOM:MPM"]);

  for (const route of candidate.routes) {
    const hub = normaliseHub(route.hub);
    const destination = String(route.airport_code ?? "")
      .trim()
      .toUpperCase();

    const key = `${hub}:${String(route.route_id)}`;

    const routeDestination = String(
  route.airport_code ?? ""
).trim().toUpperCase();

const expectedRoute = `${hub}/${routeDestination}`;

if (
  !/^[A-Z0-9]{3,5}$/.test(routeDestination) ||
  String(route.route ?? "").trim().toUpperCase() !== expectedRoute
) {
  throw new Error(
    `Invalid owned-route destination or route: ${key}`
  );
}
    
    const routeName = `${hub}:${destination}`;

if (
  !excludedDestinationsForPricing.has(destination) &&
  !pricingKeys.has(key) &&
  !allowedUnpricedRoutes.has(routeName)
) {
  throw new Error(
        `Missing pricing for owned route ${hub}/${destination} ` +
        `(route ID ${route.route_id})`
      );
    }
  }

  // The known exception must not hide other pricing problems.
  console.info(
    "[Rotation Optimiser] Route-to-pricing consistency validated."
  );

  // Verify that each pricing record matches its owned route.
const routesByKey = new Map(
  candidate.routes.map(route => [
    `${normaliseHub(route.hub)}:${String(route.route_id)}`,
    route
  ])
);

for (const price of candidate.pricing) {
  const key =
    `${normaliseHub(price.hub)}:${String(price.route_id)}`;

  const route = routesByKey.get(key);

  // Pricing may include affiliated routes excluded from
  // the owned-route dataset.
  if (!route) continue;

  if (
    route.route !== price.route ||
    Number(route.distance_km) !== Number(price.distance_km)
  ) {
    throw new Error(
      `Route/pricing mismatch: ${key}`
    );
  }
}

console.info(
  "[Rotation Optimiser] Route destinations and distances validated."
);
  
    
  // Guard against an incomplete aircraft catalogue.
  // The current validated catalogue contains 150 records.
  const MIN_AIRCRAFT_RECORDS = 150;
  
  if (candidate.aircraft.length < MIN_AIRCRAFT_RECORDS) {
    throw new Error(
      `Incomplete aircraft catalogue — ` +
      `${candidate.aircraft.length} records received; ` +
      `minimum ${MIN_AIRCRAFT_RECORDS} expected`
    );
  }
  
  const aircraftIds = new Set();

  for (const aircraft of candidate.aircraft) {
    const id = String(aircraft.aircraft_id ?? "").trim();

    if (!id) {
      throw new Error("Aircraft record has no aircraft_id");
    }

    if (aircraftIds.has(id)) {
      throw new Error(`Duplicate aircraft ID: ${id}`);
    }

const rawAircraftValues = [
  aircraft.category,
  aircraft.range_km,
  aircraft.speed_kmh,
  aircraft.max_seats,
  aircraft.payload_tonnes
];

if (rawAircraftValues.some(value =>
  value === null ||
  value === undefined ||
  String(value).trim() === ""
)) {
  throw new Error(
    `Missing aircraft specifications: ${id}`
  );
}

const aircraftValues = rawAircraftValues.map(Number);
    
    if (
      !String(aircraft.model ?? "").trim() ||
      aircraftValues.some(value => !Number.isFinite(value)) ||
      !Number.isInteger(aircraftValues[0]) ||
      aircraftValues[0] < 1 ||
      aircraftValues[0] > 10 ||
      aircraftValues[1] <= 0 ||
      aircraftValues[2] <= 0 ||
      !Number.isInteger(aircraftValues[3]) ||
      aircraftValues[3] < 0 ||
      aircraftValues[4] <= 0
    ) {
      throw new Error(
        `Invalid aircraft specifications: ${id}`
      );
    }
    
    aircraftIds.add(id);
  }
  
  // Validate the prepared datasets using the existing engine.
  for (const hub of requiredHubs) {
    const routes = candidate.routes.filter(
      r => normaliseHub(r.hub) === hub
    );
    const pricing = candidate.pricing.filter(
      p => normaliseHub(p.hub) === hub
    );

    if (!routes.length || !pricing.length) {
      throw new Error(`${hub}: missing routes or pricing`);
    }

    const prepared = prepare(routes, pricing, candidate.aircraft);

    if (!prepared?.routes?.length) {
      throw new Error(`${hub}: no prepared routes`);
    }



  const excludedDestinations = new Set(["BKK", "CGK", "DEL"]);
  
  const expectedPreparedRoutes = routes.filter(route =>
    !excludedDestinations.has(
      String(route.airport_code ?? "").trim().toUpperCase()
    )
  ).length;
  
  if (prepared.routes.length !== expectedPreparedRoutes) {
    throw new Error(
      `${hub}: route preparation mismatch — ` +
      `${expectedPreparedRoutes} eligible routes expected, ` +
      `${prepared.routes.length} prepared`
    );
  }

const validPricingKeys = new Set(
  pricing
    .filter(price =>
      String(price.status ?? "").trim().toLowerCase() === "ok"
    )
    .map(price =>
      `${normaliseHub(price.hub)}:${String(price.route_id)}`
    )
);

    const expectedPricedRoutes = routes.filter(route =>
      !excludedDestinations.has(
        String(route.airport_code ?? "").trim().toUpperCase()
      ) &&
      validPricingKeys.has(
        `${normaliseHub(route.hub)}:${String(route.route_id)}`
      )
    ).length;


    
    const actualPricedRoutes = prepared.routes.filter(
      route => route.pricingValid
    ).length;
    
    if (actualPricedRoutes !== expectedPricedRoutes) {
      throw new Error(
        `${hub}: pricing preparation mismatch — ` +
        `${expectedPricedRoutes} routes expected to be priced, ` +
        `${actualPricedRoutes} recognised by engine`
      );
    }

    if (!getSupportedAircraft(prepared).length) {
      throw new Error(`${hub}: no supported aircraft`);
    }

    for (const route of prepared.routes) {
      if (!route.pricingValid) continue;

      if (
        ![
          route.ecoDemand,
          route.cargoDemand,
          route.ecoFare,
          route.cargoFare
        ].every(Number.isFinite) ||
        route.ecoDemand < 0 ||
        route.cargoDemand < 0 ||
        route.ecoFare <= 0 ||
        route.cargoFare <= 0
      ) {
        throw new Error(
          `${hub}: invalid prepared pricing for route ${route.id}`
        );
      }
    }

    console.info(
      `[Rotation Optimiser] ${hub}: independent Supabase validation passed ` +
      `(${prepared.routes.length} routes; ` +
      `${prepared.routes.filter(r => r.pricingValid).length} priced).`
    );
  }

  console.info(
    `[Rotation Optimiser] Validated Supabase scan: ${[...scanIds][0]}`
  );
}

function getConfiguredFleet() {
  if (!preparedData) {
    return [];
  }

  return getSupportedAircraft(preparedData);
}

function renderConfigurations(fleet) {
  const tbody = $("fleet-configurations");

  if (!tbody) {
    return;
  }

  tbody.replaceChildren();

  for (const aircraft of fleet) {
    appendRow(tbody, [
      aircraft.model,
      formatNumber(aircraft.eco),
      formatNumber(aircraft.cargo),
      aircraft.category,
      formatNumber(aircraft.range),
      formatNumber(aircraft.speed)
    ]);
  }
}

async function loadData() {
  const generation = ++loadGeneration;

  preparedData = null;
  optimisationResult = null;
  clearResults();
  updateButtons();

  setStatus("Loading and validating Supabase data…");

  try {
    let dataset;
    let sourceMessage;

    try {
      // Supabase is now the primary data source.
      const candidate = await loadSupabaseData();

      validateSupabaseData(candidate);

      dataset = candidate;
      activeDataSource = "Supabase";
      sourceMessage = "Supabase (independently validated)";

    } catch (error) {
      console.warn(
        "[Rotation Optimiser] Supabase validation failed:",
        error
      );

      // CSV is retained as an emergency fallback.
      setStatus("Supabase unavailable. Loading CSV fallback…");

      const [csvRoutes, csvPricing, csvAircraft] =
        await Promise.all(DATA_FILES.map(loadCSVFile));

      dataset = {
        routes: csvRoutes,
        pricing: csvPricing,
        aircraft: csvAircraft
      };

      activeDataSource = "CSV";
      sourceMessage =
        `CSV fallback — Supabase validation failed: ${error.message}`;
    }

    if (generation !== loadGeneration) return;

    rawRoutes = dataset.routes;
    rawPricing = dataset.pricing;
    rawAircraft = dataset.aircraft;

    availableHubs = discoverHubs(rawRoutes, rawPricing);

    if (!availableHubs.length) {
      throw new Error("No matching hubs in route and pricing data");
    }

    HUB = availableHubs.includes(HUB)
      ? HUB
      : availableHubs[0];

    activateHub(HUB);

    const normalStatus = $("status")?.textContent ?? "";
    setStatus(`${sourceMessage}. ${normalStatus}`);

  } catch (error) {
    console.error(
      "[Rotation Optimiser] Data loading failed:",
      error
    );

    preparedData = null;
    setStatus(`Data loading error: ${error.message}`);
    updateButtons();
  }
}

// ============================================================
// RENDER ROTATIONS
// ============================================================

function renderResults() {
  const tbody = $("results");

  if (!tbody) {
    return;
  }

  tbody.replaceChildren();

  if (!optimisationResult?.rotations) {
    return;
  }

  for (const rotation of optimisationResult.rotations) {
    appendRow(tbody, [
      rotation.id,
      rotation.model,
      `${rotation.eco}E + ${rotation.cargo}C`,
      Number(rotation.hours).toFixed(2),
      rotation.legs.map(leg => leg.code).join(", "),
      formatMoney(rotation.revenue)
    ]);
  }
}

// ============================================================
// RENDER FLEET SUMMARY
// ============================================================

function renderFleetSummary() {
  const tbody = $("fleet-results");

  if (!tbody) {
    return;
  }

  tbody.replaceChildren();

  const summary = optimisationResult?.fleetSummary;

  if (!summary) {
    return;
  }

  let totalGroups = 0;
  let totalAircraft = 0;
  let totalServices = 0;
  let totalRevenue = 0;

const allocatedFleet = Object.values(summary)
  .filter(item => item.groups > 0)
  .sort((a, b) => b.weeklyRevenue - a.weeklyRevenue);

for (const item of allocatedFleet) {
  appendRow(tbody, [
      item.model,
      `${item.eco}E + ${item.cargo}C`,
      formatNumber(item.groups),
      formatNumber(item.aircraftCount),
      formatNumber(item.services),
      formatMoney(item.weeklyRevenue)
    ]);

    totalGroups += item.groups;
    totalAircraft += item.aircraftCount;
    totalServices += item.services;
    totalRevenue += item.weeklyRevenue;
  }

  appendRow(tbody, [
    "TOTAL",
    "Mixed fleet",
    formatNumber(totalGroups),
    formatNumber(totalAircraft),
    formatNumber(totalServices),
    formatMoney(totalRevenue)
  ]);
}

// ============================================================
// RENDER DEMAND SUMMARY
// ============================================================

function renderDemandSummary() {
  const tbody = $("demand-results");

  if (!tbody) {
    return;
  }

  tbody.replaceChildren();

  const demand = optimisationResult?.demandSummary;

  if (!demand) {
    return;
  }

  appendRow(tbody, [
    "Economy",
    formatNumber(demand.startingEconomy),
    formatNumber(demand.allocatedEconomy),
    formatNumber(demand.remainingEconomy),
    percentage(
      demand.remainingEconomy,
      demand.startingEconomy
    )
  ]);

  appendRow(tbody, [
    "Cargo",
    formatNumber(demand.startingCargo),
    formatNumber(demand.allocatedCargo),
    formatNumber(demand.remainingCargo),
    percentage(
      demand.remainingCargo,
      demand.startingCargo
    )
  ]);
}

// ============================================================
// RUN OPTIMISER
// ============================================================

function runOptimiser() {
  if (isRunning || !preparedData) {
    return;
  }

  const groupText = $("groups")?.value.trim() ?? "";

  // Blank = unlimited.
  const groups = groupText === ""
    ? null
    : Number(groupText);

  if (
    groups !== null &&
    (
      !Number.isSafeInteger(groups) ||
      groups < 1
    )
  ) {
    setStatus(
      "Enter a positive whole number or leave blank for unlimited."
    );

    return;
  }

  optimisationResult = null;
  resultHub = null;
  clearResults();

  if (worker) {
    worker.terminate();
    worker = null;
  }

  isRunning = true;
  updateButtons();

  const groupDescription =
    groups === null
      ? "unlimited groups"
      : `up to ${groups} groups`;

  setStatus(
    `Optimising ${HUB}: ${groupDescription} across ` +
    `${getConfiguredFleet().length} aircraft models…`
  );

  try {
    const activeWorker = new Worker(
      "./js/worker.js",
      {
        type: "module"
      }
    );

    worker = activeWorker;

    activeWorker.onmessage = event => {
      if (worker !== activeWorker) {
        return;
      }

      const {
        type,
        data: payload,
        message
      } = event.data;

      if (type === "progress") {
        const countDescription =
          groups === null
            ? `${payload.completed} groups`
            : `${payload.completed} of ${groups} groups`;

        setStatus(
          `${HUB}: built ${countDescription} · ` +
          `provisional $${formatBillions(payload.total)}bn/week`
        );

        return;
      }

      if (type === "error") {
        console.error(
          "[Rotation Optimiser] Engine error:",
          message
        );

        isRunning = false;

        setStatus(
          `Optimisation error: ${message}`
        );

        activeWorker.terminate();
        worker = null;

        updateButtons();
        return;
      }

      if (type === "result") {
        optimisationResult = payload;
        resultHub = HUB;

        isRunning = false;

        activeWorker.terminate();
        worker = null;

        renderResults();
        renderFleetSummary();
        renderDemandSummary();

        const completed =
          optimisationResult.rotations.length;

        const allocatedFleet = Object.values(
          optimisationResult.fleetSummary ?? {}
        ).filter(item => item.groups > 0);
        
        const fleetText = allocatedFleet
          .sort((a, b) => b.weeklyRevenue - a.weeklyRevenue)
          .map(item => `${item.model}: ${item.groups} groups`)
          .join(" · ");
        
        setStatus(
          `${HUB}: completed ${completed} groups · ` +
          `${fleetText} · ` +
          `provisional $${formatBillions(
            optimisationResult.total
          )}bn/week · NOT game validated`
        );

        updateButtons();
      }
    };

    activeWorker.onerror = event => {
      if (worker !== activeWorker) {
        return;
      }

      console.error(
        "[Rotation Optimiser] Worker error:",
        event
      );

      isRunning = false;

      setStatus(
        "The optimisation worker failed. " +
        "Check the browser console for details."
      );

      activeWorker.terminate();
      worker = null;

      updateButtons();
    };

    activeWorker.postMessage({
      type: "run",
      data: preparedData,
      settings: {
        groups,
        x380PlusAvailableGroups: confirmedX380Hub && confirmedX380Hub !== HUB ? 0 : 1
      }
    });

  } catch (error) {
    console.error(
      "[Rotation Optimiser] Could not start:",
      error
    );

    isRunning = false;

    setStatus(
      `Could not start optimiser: ${error.message}`
    );

    updateButtons();
  }
}

// ============================================================
// STOP OPTIMISER
// ============================================================

function stopOptimiser() {
  if (!isRunning) {
    return;
  }

  if (worker) {
    worker.terminate();
    worker = null;
  }

  isRunning = false;
  optimisationResult = null;

  clearResults();

  setStatus(
    "Optimisation stopped. Run again to obtain a complete result."
  );

  updateButtons();
}


  // ============================================================
  // EXPORT CIRCUITS FOR TESTING
  // ============================================================

  function downloadRotations() {
    if (!optimisationResult?.rotations?.length) {
      return;
    }

    const lines = optimisationResult.rotations.map(
      (rotation, index) => {
        const circuitId = `${HUB}-C${1001 + index}`;

        const destinations = rotation.legs
          .map(leg => leg.code)
          .join(",");

        return (
          `${HUB} | ${rotation.model} | ` +
          `${circuitId} | ${destinations}`
        );
      }
    );

    const blob = new Blob(
      [lines.join("\n") + "\n"],
      { type: "text/plain;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${HUB}_Circuits_For_Testing.txt`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

// ============================================================
// EVENTS AND INITIALISATION
// ============================================================

function initialiseEvents() {
  $("hub-select")?.addEventListener("change", event => activateHub(event.target.value));
  $("confirm-x380")?.addEventListener("click", confirmX380);
  $("release-x380")?.addEventListener("click", releaseX380);
  $("run")?.addEventListener(
    "click",
    runOptimiser
  );

  $("stop")?.addEventListener(
    "click",
    stopOptimiser
  );

  $("download")?.addEventListener(
    "click",
    downloadRotations
  );
}

async function initialise() {
  initialiseEvents();
  updateButtons();
  await loadData();
}

initialise();
