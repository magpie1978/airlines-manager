
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
  getSupportedAircraft,
  setAffiliatedDestinations
} from "./engine.js";

let HUB = "BOM";
let rawRoutes = [];
let rawPricing = [];
let rawAircraft = [];
let availableHubs = [];
let affiliatedOrigins = null; // Null means unverified: fail closed.
let loadGeneration = 0;
let activeDataSource = "CSV";
// Fleet allocations are authoritative in Supabase, not browser memory.
let fleetState = null;
let resultHub = null;
let resultFleetVersion = null;
function x380GroupsInResult() {
  return optimisationResult?.rotations?.filter(r => r.model === "X380Plus").length ?? 0;
}
function fleetVersion(f) {
  return JSON.stringify([f.owned_count,f.group_size,f.allocations]);
}
function allocatedHere() {
  return Number(fleetState?.allocations?.[HUB] || 0);
}
function originAllowed(hub = HUB) {
  return affiliatedOrigins instanceof Set && !affiliatedOrigins.has(normaliseHub(hub));
}

function freeGroups() {
  if (!fleetState) return 0;
  const used = Object.values(fleetState.allocations).reduce((sum,n)=>sum+Number(n),0);
  return Math.max(0,Math.floor((fleetState.owned_count-used)/fleetState.group_size));
}
function updateX380Controls() {
  const status = $("x380-status");
  if (status) {
    if (!fleetState) status.textContent = "Fleet register unavailable — optimisation blocked.";
    else {
      const used = Object.values(fleetState.allocations).reduce((sum,n)=>sum+Number(n),0);
      const allocations = Object.entries(fleetState.allocations).filter(([,n])=>n>0).map(([hub,n])=>`${hub}: ${n}`).join(" · ");
      status.textContent = `${fleetState.owned_count} owned · ${used} allocated (${allocations||"none"}) · ${fleetState.owned_count-used} free · ${freeGroups()} new seven-aircraft groups available. Existing allocations are not automatically reused.`;
    }
  }
  const confirm = $("confirm-x380");
  if (confirm) confirm.disabled = isRunning || !fleetState || !optimisationResult || resultHub !== HUB ||
    x380GroupsInResult() < 1 || !originAllowed() || resultFleetVersion !== fleetVersion(fleetState);
  const release = $("release-x380");
  if (release) release.disabled = isRunning || !fleetState || allocatedHere() === 0;
}
async function fleetRequest(action, params={}) {
  if (!accessToken || !scannerEndpoint) throw new Error("Sign in to access the fleet register");
  const url = new URL(scannerEndpoint);
  url.searchParams.set("action",action);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
  const response = await fetch(url,{method: action === "fleet-reserve" ? "POST":"GET",cache:"no-store",
    headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${accessToken}`}});
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
async function refreshFleet() {
  const body = await fleetRequest("fleet-status");
  const f=body.fleet;
  if (!f || !Number.isSafeInteger(f.owned_count) || !Number.isSafeInteger(f.group_size) || f.group_size!==7 || !f.allocations)
    throw new Error("Invalid X380Plus fleet register response");
  fleetState=f;
  updateX380Controls();
  return f;
}
async function confirmX380() {
  if (isRunning || !originAllowed() || !optimisationResult || resultHub !== HUB || !x380GroupsInResult()) return;
  try {
    const latestAffiliations = await loadAffiliatedHubs();
    affiliatedOrigins = new Set(latestAffiliations.map(normaliseHub));
    if (!originAllowed()) throw new Error(`${HUB} is now affiliated`);
    const latest=await refreshFleet();
    if (fleetVersion(latest)!==resultFleetVersion) throw new Error("Fleet allocation changed; rerun optimisation before confirming");
    const groups=x380GroupsInResult();
    if (groups>freeGroups()) throw new Error("Not enough unallocated aircraft for this proposal");
    await fleetRequest("fleet-reserve",{hub:HUB,groups});
    await refreshFleet();
    optimisationResult=null; resultHub=null; resultFleetVersion=null; clearResults();updateButtons();
    setStatus(`${groups*7} X380Plus aircraft allocated to ${HUB} in Supabase. Run optimisation again for further proposals.`);
  } catch(e) {setStatus(`Fleet reservation rejected: ${e.message}`);}
}
async function releaseX380() {
  if (isRunning || !fleetState || !allocatedHere()) return;
  if (!window.confirm(`Release ${allocatedHere()} X380Plus aircraft allocated to ${HUB}? Only do this if the game allocation has actually been removed.`)) return;
  try {
    await fleetRequest("fleet-reserve",{hub:HUB,groups:0});
    await refreshFleet();
    optimisationResult=null;resultHub=null;resultFleetVersion=null;clearResults();updateButtons();
    setStatus(`Released ${HUB} X380Plus allocation in Supabase.`);
  } catch(e) {setStatus(`Release failed: ${e.message}`);}
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
    option.textContent = originAllowed(hub) ? hub : `${hub} — affiliated (disabled)`;
    option.disabled = !originAllowed(hub);
    select.appendChild(option);
  }
  select.value = HUB;
  select.disabled = availableHubs.filter(originAllowed).length < 2 || isRunning;
}

function activateHub(hub) {
  if (isRunning) return;
  const selected = normaliseHub(hub);
  if (!availableHubs.includes(selected) || !originAllowed(selected)) {
    setStatus(`${selected}: affiliated hub origins cannot be optimised.`);
    renderHubOptions();
    return;
  }
  HUB = selected;
  updateHubHeading();
  optimisationResult = null;
  resultHub = null;
  resultFleetVersion = null;
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
    const missingCategory = preparedData.routes.filter(r=>r.category===null).length;
    const missingPricing = preparedData.routes.filter(r=>!r.pricingValid).length;
    if (missingCategory || missingPricing) {
      throw new Error(`${missingCategory} owned routes missing airport categories; ${missingPricing} missing valid pricing. Resolve these before optimisation.`);
    }
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

  if ($("hub-select")) $("hub-select").disabled = isRunning || availableHubs.filter(originAllowed).length < 2;

  if (runButton) {
    runButton.disabled =
      isRunning || preparedData === null || fleetState === null || !originAllowed();
  }

  if (stopButton) {
    stopButton.disabled = !isRunning;
  }

  updateX380Controls();

  if (downloadButton) {
    downloadButton.disabled =
      isRunning ||
      !optimisationResult ||
      !originAllowed() ||
      resultFleetVersion !== fleetVersion(fleetState) ||
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

// Authenticated production data reader. Access tokens remain in memory only.
const SUPABASE_URL = "https://eukgodthgusongsbhdwg.supabase.co";
const SUPABASE_KEY = "sb_publishable_pBMWDgyFgIUGetg6NwkKkA_rMa1--kc";
let accessToken = null;
let scannerEndpoint = "";

// v7: Shared authentication is owned by the parent Airlines Manager page.
// Never request a second password or persist access tokens here.
async function connectSharedSession() {
  if (!window.parent?.amSharedAuth?.token) {
    throw new Error("Open Rotation Optimiser from the main Airlines Manager website and sign in using its header.");
  }
  const token = await window.parent.amSharedAuth.token();
  if (!token || typeof token !== "string") throw new Error("Shared sign-in has expired. Sign in again in the main header.");
  accessToken = token;
  scannerEndpoint = `${SUPABASE_URL}/functions/v1/am-auth-test`;
  $("db-auth-status").textContent = "Authenticated through Airlines Manager";
}

async function reloadSharedData() {
  try {
    await connectSharedSession();
    await loadData();
  } catch (error) {
    accessToken = null; fleetState = null; affiliatedOrigins = null;
    preparedData = null; updateButtons();
    $("db-auth-status").textContent = "Shared sign-in required";
    setStatus(`Cannot load production data: ${error.message}`);
  }
}

async function readProductionHub(hub) {
  if (!accessToken || !scannerEndpoint) throw new Error("Sign in to load production data");
  const url = new URL(scannerEndpoint);
  url.searchParams.set("action","optimizer-data");
  url.searchParams.set("hub",hub);
  const response = await fetch(url, {headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${accessToken}`}});
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || `HTTP ${response.status}`);
  if (!Array.isArray(result.routes) || !Array.isArray(result.pricing)) throw new Error("Unexpected scanner response");
  return result;
}

async function loadAffiliatedHubs() {
  if (!accessToken || !scannerEndpoint) throw new Error("Sign in to load affiliated hubs");
  const url = new URL(scannerEndpoint);
  url.searchParams.set("action", "affiliated-hubs");
  const response = await fetch(url, {cache:"no-store",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${accessToken}`}});
  const body = await response.json();
  if (!response.ok || body.ok === false || !Array.isArray(body.hubs))
    throw new Error(body.error || "Affiliated hub register unavailable");
  const codes = body.hubs.filter(x=>x.is_affiliated===true).map(x=>String(x.hub).toUpperCase());
  if (!codes.length) throw new Error("No affiliated hubs returned — check the register before optimising");
  setAffiliatedDestinations(codes);
  return codes;
}

async function loadSupabaseData() {
  if (!(affiliatedOrigins instanceof Set)) throw new Error("Affiliated hub register not verified");
  const hubs = ["BOM","CGK","MPM","BKK","DEL"].filter(hub => !affiliatedOrigins.has(hub));
  if (!hubs.length) throw new Error("No eligible origin hubs");
  const batches = await Promise.all(hubs.map(readProductionHub));
  const aircraft = await loadCSVFile("./data/aircraft.csv");
  return {routes:batches.flatMap(x=>x.routes),pricing:batches.flatMap(x=>x.pricing),aircraft};
}

function validateSupabaseData(candidate) {
  if (!candidate.aircraft.length) throw new Error("Aircraft catalogue missing");
  const routeKeys = new Set();
  for (const r of candidate.routes) {
    const key = `${r.hub}:${r.airport_code}`;
    if (routeKeys.has(key)) throw new Error(`Duplicate route ${key}`);
    routeKeys.add(key);
  }
  const priceKeys = new Set();
  for (const p of candidate.pricing) {
    const key = `${p.hub}:${p.airport_code}`;
    if (priceKeys.has(key)) throw new Error(`Duplicate pricing ${key}`);
    priceKeys.add(key);
  }
  const missingCategories = candidate.routes.filter(r=>r.ownership_status === "owned" &&
    (r.category == null || !Number.isInteger(Number(r.category)) || Number(r.category)<1 || Number(r.category)>10));
  if (missingCategories.length) {
    console.warn(`[Rotation Optimiser] ${missingCategories.length} owned routes missing airport category. Optimisation will remain blocked for affected hubs.`);
  }
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
  await connectSharedSession();
  fleetState = null;
  affiliatedOrigins = null;
  const generation = ++loadGeneration;
  preparedData = null; optimisationResult = null;
  clearResults(); updateButtons();
  setStatus("Loading production routes and pricing from Supabase…");
  try {
    const affiliatedHubs = await loadAffiliatedHubs();
    if (generation !== loadGeneration) return;
    affiliatedOrigins = new Set(affiliatedHubs.map(normaliseHub));
    const [dataset] = await Promise.all([loadSupabaseData(), refreshFleet()]);
    validateSupabaseData(dataset);
    if (generation !== loadGeneration) return;
    rawRoutes = dataset.routes; rawPricing = dataset.pricing; rawAircraft = dataset.aircraft;
    activeDataSource = "Supabase";
    affiliatedOrigins = new Set(affiliatedHubs.map(normaliseHub));
    availableHubs = discoverHubs(rawRoutes,rawPricing);
    if (!availableHubs.length) throw new Error("No hubs with both routes and pricing");
    const eligibleOrigins = availableHubs.filter(originAllowed);
    if (!eligibleOrigins.length) throw new Error("No non-affiliated origin hubs with routes and pricing");
    HUB = eligibleOrigins.includes(HUB) ? HUB : eligibleOrigins[0];
    activateHub(HUB);
    const status = $("status")?.textContent || "";
    setStatus(`Production Supabase data loaded. Affiliated destinations excluded: ${affiliatedHubs.join(", ")}. ${status}`);
  } catch (error) {
    console.error("[Rotation Optimiser] Supabase load failed",error);
    affiliatedOrigins = null; preparedData = null; updateButtons();
    setStatus(`Supabase loading failed: ${error.message}. No CSV fallback was used.`);
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

async function runOptimiser() {
  if (isRunning || !preparedData || !fleetState || !originAllowed()) {
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

  // Fail closed if the fleet register is unreachable or has changed.
  try {
    const latestAffiliations = await loadAffiliatedHubs();
    affiliatedOrigins = new Set(latestAffiliations.map(normaliseHub));
    if (!originAllowed()) throw new Error(`${HUB} is now affiliated; optimisation disabled`);
    await refreshFleet();
  }
  catch(error) { fleetState=null;updateButtons();setStatus(`Cannot optimise without fleet status: ${error.message}`);return; }
  if (isRunning || !preparedData) return;
  optimisationResult = null;
  resultHub = null;
  resultFleetVersion = null;
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
        const proposedX380=(payload.rotations||[]).filter(r=>r.model==="X380Plus").length;
        if (proposedX380>freeGroups()) {
          isRunning=false;activeWorker.terminate();worker=null;
          optimisationResult=null;clearResults();updateButtons();
          setStatus("Invalid engine output: X380Plus exceeds unallocated fleet. Result discarded.");return;
        }
        optimisationResult = payload;
        resultHub = HUB;
        resultFleetVersion = fleetVersion(fleetState);

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
        x380PlusAvailableGroups: freeGroups()
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

  async function downloadRotations() {
    try { await refreshFleet(); } catch(e) { setStatus(`Cannot export without checking fleet: ${e.message}`); return; }
    if (!originAllowed()) {setStatus("Affiliated hub origin: export blocked.");return;}
    if (resultFleetVersion !== fleetVersion(fleetState)) {setStatus("Fleet allocation changed; rerun optimisation before export.");return;}
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
  setStatus("Connecting to the shared Airlines Manager session…");
  $("reload-production")?.addEventListener("click", reloadSharedData);
  await reloadSharedData();
  window.addEventListener("focus", () => {
    if (!accessToken) reloadSharedData();
  });
}

initialise();
