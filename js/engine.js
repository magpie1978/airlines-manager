
/**
 * Airlines Manager Rotation Optimiser
 * engine.js v1.0
 *
 * Scenario A: Rebuild selected-hub schedules from total demand.
 *
 * A380-800: fixed 852E + 4C
 * A350-900ULR: fixed 430E + 1C
 *
 * Other passenger aircraft:
 * - Maximise Economy seats
 * - Allocate remaining payload to whole Cargo units
 *
 * Dedicated freighters:
 * - Zero Economy seats
 * - Cargo capacity based on whole tonnes of payload
 *
 * One model and configuration per seven-aircraft group.
 * Maximum base rotation: 168 hours.
 *
 * Selection: highest weekly gross revenue per group.
 * This is a greedy fleet optimiser, not a global optimum.
 */

export const EXCLUDED = new Set([
  "BKK", "DEL"
]);

/**
 * Coin-restricted aircraft IDs (27 models), verified against the game's
 * aircraft.csv catalogue. These are never eligible for optimisation.
 * IDs are strings because prepare() normalises aircraft_id to String.
 * Fail closed: do not rely on model-name fuzzy matching.
 */
export const COIN_RESTRICTED_AIRCRAFT_IDS = new Set([
  "116", // 747-300
  "115", // Cargo 747-200F
  "114", // 747-200B
  "64", // Concorde
  "62", // MD-11
  "113", // 747-100B
  "151", // 747SP
  "198", // DC-10-30
  "178", // L-1011-200
  "158", // L-1011-500
  "201", // L-1011-100
  "109", // 707-320C
  "121", // Cargo DC8-73AF
  "120", // DC8-73
  "207", // VC10
  "203", // Il-86
  "122", // Cargo DC8-55CF
  "123", // DC8-55
  "202", // 727-200
  "61", // B727-100
  "63", // Caravelle 12
  "157", // L-100
  "98", // F-100
  "209", // DH Comet 4
  "179", // L-1049G
  "206", // L-188C
  "77", // DC-3
]);

export const FIXED_AIRCRAFT = Object.freeze({
  "A380-800": Object.freeze({
    eco: 852,
    cargo: 4
  }),
  "A350-900ULR": Object.freeze({
    eco: 430,
    cargo: 1
  }),
  "X380Plus": Object.freeze({
    eco: 930,
    cargo: 1
  })
});

export const SCENARIO = "REBUILD_FROM_SCRATCH";
export const ROTATION_HOURS = 168;
export const AIRCRAFT_PER_GROUP = 7;
export const ECONOMY_PAYLOAD_TONNES = 0.1;

const QUARTERS = ROTATION_HOURS * 4;
const EPSILON = 1e-7;

// ============================================================
// CSV PARSING
// ============================================================

export function csv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  text = String(text).replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (
      (char === "\n" || char === "\r") &&
      !quoted
    ) {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }

      row.push(cell);

      if (row.some(value => value !== "")) {
        rows.push(row);
      }

      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const [headers, ...records] = rows;

  return records.map(values => {
    const record = {};

    headers.forEach((header, index) => {
      record[header.trim()] = values[index] ?? "";
    });

    return record;
  });
}

function numeric(value, fallback = 0) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return fallback;
  }

  const result = Number(
    String(value).replaceAll(",", "").trim()
  );

  return Number.isFinite(result) ? result : fallback;
}

function category(value) {
  const result = numeric(value, NaN);

  return Number.isInteger(result) &&
    result >= 1 &&
    result <= 10
      ? result
      : null;
}

function validNumber(value) {
  return Number.isFinite(numeric(value, NaN));
}

// ============================================================
// DATA PREPARATION
// ============================================================

export function prepare(routes, pricing, aircraft) {
  const routeHubs = new Set(routes.map(r => String(r.hub ?? "").trim().toUpperCase()));
  if (routeHubs.size !== 1 || !/^[A-Z0-9]{3,5}$/.test([...routeHubs][0])) {
    throw new Error("Preparation requires exactly one valid hub code.");
  }
  const selectedHub = [...routeHubs][0];
  const pricingByRoute = new Map();

  for (const record of pricing) {
    if (
      String(record.status ?? "")
        .trim()
        .toLowerCase() !== "ok"
    ) {
      continue;
    }

    const id = String(record.route_id ?? "").trim();
    const priceHub = String(record.hub ?? "").trim().toUpperCase();
    if (id && priceHub === selectedHub) {
      if (pricingByRoute.has(id)) throw new Error(`Duplicate pricing route ${selectedHub}/${id}`);
      pricingByRoute.set(id, record);
    }
  }

  const preparedRoutes = [];
  const seenRouteIds = new Set();

  for (const record of routes) {
    const ownership = String(
      record.ownership_status ?? ""
    ).trim().toLowerCase();

    const code = String(
      record.airport_code ?? ""
    ).trim().toUpperCase();

    if (
      ownership !== "owned" ||
      EXCLUDED.has(code)
    ) {
      continue;
    }

    const id = String(record.route_id ?? "").trim();
    if (!id || seenRouteIds.has(id)) throw new Error(`Missing/duplicate route ID in ${selectedHub}: ${id}`);
    seenRouteIds.add(id);
    const price = pricingByRoute.get(id);
    if (price && String(price.airport_code ?? "").trim().toUpperCase() !== code) {
      throw new Error(`Pricing destination mismatch for ${selectedHub}/${id}`);
    }

    const pricingValid =
      price !== undefined &&
      validNumber(price.current_demand_economy) &&
      validNumber(price.current_demand_cargo);

    preparedRoutes.push({
      id,
      code,
      distance: numeric(record.distance_km),
      category: category(record.category),

      ecoDemand: pricingValid
        ? Math.max(
            0,
            numeric(price.current_demand_economy)
          )
        : 0,

      cargoDemand: pricingValid
        ? Math.max(
            0,
            numeric(price.current_demand_cargo)
          )
        : 0,

      ecoFare: Math.max(
        0,
        numeric(price?.current_price_economy)
      ),

      cargoFare: Math.max(
        0,
        numeric(price?.current_price_cargo)
      ),

      pricingValid
    });
  }

  const preparedAircraft = [];

  for (const record of aircraft) {
    // Coin-unlock aircraft are not eligible for optimisation.
    if (COIN_RESTRICTED_AIRCRAFT_IDS.has(String(record.aircraft_id ?? "").trim())) continue;
    const item = {
      id: String(record.aircraft_id ?? "").trim(),
      model: String(record.model ?? "").trim(),
      category: category(record.category),
      range: numeric(record.range_km),
      speed: numeric(record.speed_kmh),
      seats: Math.floor(numeric(record.max_seats)),
      payload: numeric(record.payload_tonnes)
    };

    if (
      !item.model ||
      item.category === null ||
      item.range <= 0 ||
      item.speed <= 0 ||
      item.seats < 0 ||
      item.payload <= 0
    ) {
      continue;
    }

    preparedAircraft.push(item);
  }

  return {
    hub: selectedHub,
    routes: preparedRoutes,
    aircraft: preparedAircraft,
    scenario: SCENARIO
  };
}

// ============================================================
// AIRCRAFT CONFIGURATION
// ============================================================

/**
 * Exported so app.js can display the exact
 * same fleet configurations as the engine.
 *
 * Automatic Economy-first:
 *
 * Economy = minimum of maximum seats and
 *           seats supported by payload.
 *
 * Cargo = whole tonnes left after Economy.
 *
 * Fixed exceptions always take precedence.
 *
 * Freighters with zero passenger seats use
 * their payload for whole Cargo units.
 */

export function configureAircraft(aircraft) {
  const fixed = FIXED_AIRCRAFT[aircraft.model];

  let eco;
  let cargo;

  if (fixed) {
    eco = fixed.eco;
    cargo = fixed.cargo;
  } else if (aircraft.seats === 0) {
    // Dedicated freighters carry cargo only.
    eco = 0;
    cargo = Math.floor(aircraft.payload + EPSILON);
  } else {
    eco = Math.min(
      Math.floor(aircraft.seats),
      Math.floor(
        (
          aircraft.payload + EPSILON
        ) / ECONOMY_PAYLOAD_TONNES
      )
    );

    cargo = Math.max(
      0,
      Math.floor(
        aircraft.payload -
        eco * ECONOMY_PAYLOAD_TONNES +
        EPSILON
      )
    );
  }

  const requiredPayload =
    eco * ECONOMY_PAYLOAD_TONNES + cargo;

  if (
    eco < 0 ||
    eco > aircraft.seats ||
    (aircraft.seats > 0 && eco === 0) ||
    (eco === 0 && cargo === 0) ||
    cargo < 0 ||
    requiredPayload > aircraft.payload + EPSILON
  ) {
    throw new Error(
      `Invalid configuration for ${aircraft.model}: ` +
      `${eco}E + ${cargo}C.`
    );
  }

  return {
    ...aircraft,
    eco,
    cargo,
    requiredPayload,
    configurationMode: fixed
      ? "FIXED"
      : aircraft.seats === 0
        ? "AUTO_CARGO_ONLY"
        : "AUTO_ECONOMY_FIRST"
  };
}

export function getSupportedAircraft(data) {
  const byModel = new Map();

  for (const record of data.aircraft) {
    // Protect callers that bypass prepare().
    if (COIN_RESTRICTED_AIRCRAFT_IDS.has(String(record.id ?? record.aircraft_id ?? "").trim())) continue;
    if (!record.model) {
      continue;
    }

    // A model must have one unambiguous set of specs.
    if (byModel.has(record.model)) {
      const previous = byModel.get(record.model);

      const fields = [
        "category",
        "range",
        "speed",
        "seats",
        "payload"
      ];

      if (
        fields.some(
          field => previous[field] !== record[field]
        )
      ) {
        throw new Error(
          `Conflicting catalogue specifications for ` +
          `${record.model}.`
        );
      }

      continue;
    }

    byModel.set(record.model, record);
  }

  for (const model of Object.keys(FIXED_AIRCRAFT)) {
    if (!byModel.has(model)) {
      throw new Error(
        `Required fixed aircraft ${model} is missing ` +
        "from the usable catalogue."
      );
    }
  }

  return Array.from(byModel.values()).map(
    configureAircraft
  );
}

// ============================================================
// VALIDATION
// ============================================================

export function validateData(data) {
  if (!Array.isArray(data?.routes) ||
      data.routes.length === 0) {
    throw new Error("No eligible owned routes loaded.");
  }

  if (!Array.isArray(data?.aircraft) ||
      data.aircraft.length === 0) {
    throw new Error("No usable aircraft loaded.");
  }

  const invalidCategories = data.routes.filter(
    route => route.category === null
  );

  if (invalidCategories.length > 0) {
    throw new Error(
      `${invalidCategories.length} routes have ` +
      "invalid airport categories."
    );
  }

  const missingTotalDemand = data.routes.filter(
    route => !route.pricingValid
  ).length;

  if (missingTotalDemand === data.routes.length) {
    throw new Error(
      "No valid total-demand records in pricing.csv."
    );
  }

  return {
    routeCount: data.routes.length,
    aircraftCount: data.aircraft.length,
    missingTotalDemand,
    validPricingRoutes:
      data.routes.length - missingTotalDemand,
    scenario: SCENARIO
  };
}

// ============================================================
// ELIGIBILITY, DURATION, REVENUE
// ============================================================

export function isEligible(aircraft, route) {
  if (COIN_RESTRICTED_AIRCRAFT_IDS.has(String(aircraft.id ?? aircraft.aircraft_id ?? "").trim())) return false;
  return (
    route.category !== null &&
    aircraft.category !== null &&
    route.category >= aircraft.category &&
    route.distance > 0 &&
    route.distance <= aircraft.range &&
    aircraft.speed > 0
  );
}

export function duration(distance, speed) {
  if (!(distance > 0) || !(speed > 0)) {
    return Infinity;
  }

  return Math.ceil(
    2 * (distance / speed + 1) * 4
  ) / 4;
}

export function calculateLegRevenue(
  route,
  eco,
  cargo
) {
  const economyRevenue =
    AIRCRAFT_PER_GROUP * 2 * eco * route.ecoFare;

  const cargoRevenue =
    AIRCRAFT_PER_GROUP * 2 * cargo * route.cargoFare;

  return {
    economyRevenue,
    cargoRevenue,
    totalRevenue: economyRevenue + cargoRevenue
  };
}

export function hasDemand(
  remaining,
  routeId,
  eco,
  cargo,
  services = 1
) {
  const available = remaining.get(routeId);

  return !!available &&
    available.eco + EPSILON >= services * 2 * eco &&
    available.cargo + EPSILON >= services * 2 * cargo;
}

function maximumServices(
  available,
  aircraft,
  quarters
) {
  if (
    !available ||
    quarters <= 0 ||
    quarters > QUARTERS
  ) {
    return 0;
  }

  const economyLimit = aircraft.eco > 0
    ? Math.floor(
        (available.eco + EPSILON) /
        (2 * aircraft.eco)
      )
    : Infinity;

  // Zero-cargo configurations do not require
  // any cargo demand.
  const cargoLimit = aircraft.cargo > 0
    ? Math.floor(
        (available.cargo + EPSILON) /
        (2 * aircraft.cargo)
      )
    : Infinity;

  const timeLimit = Math.floor(
    QUARTERS / quarters
  );

  return Math.max(
    0,
    Math.min(
      economyLimit,
      cargoLimit,
      timeLimit
    )
  );
}

// ============================================================
// PRECOMPUTE ROUTES PER MODEL
// ============================================================

function buildCandidates(routes, aircraft) {
  const candidates = [];

  const stats = {
    categoryAndRangeEligible: 0,
    fareEligible: 0,
    demandEligible: 0
  };

  for (const route of routes) {
    if (!isEligible(aircraft, route)) {
      continue;
    }

    stats.categoryAndRangeEligible++;

    if (
      !route.pricingValid ||
      (aircraft.eco > 0 && route.ecoFare <= 0) ||
      (aircraft.cargo > 0 && route.cargoFare <= 0)
    ) {
      continue;
    }

    const hours = duration(
      route.distance,
      aircraft.speed
    );

    if (
      !Number.isFinite(hours) ||
      hours > ROTATION_HOURS
    ) {
      continue;
    }

    stats.fareEligible++;

    const quarters = Math.round(hours * 4);

    const revenue = calculateLegRevenue(
      route,
      aircraft.eco,
      aircraft.cargo
    ).totalRevenue;

    if (revenue <= 0) {
      continue;
    }

    candidates.push({
      route,
      hours,
      quarters,
      revenue
    });

    if (
      (aircraft.eco === 0 ||
        route.ecoDemand + EPSILON >= 2 * aircraft.eco) &&
      (
        aircraft.cargo === 0 ||
        route.cargoDemand + EPSILON >=
          2 * aircraft.cargo
      )
    ) {
      stats.demandEligible++;
    }
  }

  return {
    candidates,
    stats
  };
}

// ============================================================
// BUILD OPTIONS AND REVENUE UPPER BOUND
// ============================================================

/**
 * The fractional-knapsack upper bound is optimistic.
 * It cannot underestimate the best bounded-knapsack
 * revenue for the same candidate options.
 *
 * Therefore, if the upper bound cannot beat the
 * current best rotation, we can safely skip
 * that aircraft's expensive DP search.
 */

function buildOptions(
  candidates,
  aircraft,
  remaining
) {
  const options = [];

  for (const candidate of candidates) {
    const maxServices = maximumServices(
      remaining.get(candidate.route.id),
      aircraft,
      candidate.quarters
    );

    if (maxServices > 0) {
      options.push({
        ...candidate,
        maxServices
      });
    }
  }

  return options;
}

function revenueUpperBound(options) {
  const sorted = [...options].sort(
    (a, b) =>
      b.revenue / b.quarters -
      a.revenue / a.quarters
  );

  let capacity = QUARTERS;
  let upperBound = 0;

  for (const option of sorted) {
    if (capacity <= 0) {
      break;
    }

    const availableWeight =
      option.quarters * option.maxServices;

    const weight = Math.min(
      capacity,
      availableWeight
    );

    upperBound +=
      (weight / option.quarters) *
      option.revenue;

    capacity -= weight;
  }

  return upperBound;
}

// ============================================================
// BOUNDED-KNAPSACK SEARCH
// ============================================================

function bestCircuit(options, stop) {
  if (options.length === 0) {
    return null;
  }

  const bundles = [];

  for (const option of options) {
    let count = option.maxServices;

    for (
      let size = 1;
      count > 0;
      size *= 2
    ) {
      const take = Math.min(size, count);

      bundles.push({
        option,
        count: take,
        weight: option.quarters * take,
        value: option.revenue * take
      });

      count -= take;
    }
  }

  const dp = new Float64Array(QUARTERS + 1);
  dp.fill(-Infinity);
  dp[0] = 0;

  const paths = Array(QUARTERS + 1).fill(null);

  for (const bundle of bundles) {
    if (stop()) {
      return null;
    }

    for (
      let time = QUARTERS;
      time >= bundle.weight;
      time--
    ) {
      const previousRevenue =
        dp[time - bundle.weight];

      if (!Number.isFinite(previousRevenue)) {
        continue;
      }

      const candidateRevenue =
        previousRevenue + bundle.value;

      if (
        candidateRevenue >
        dp[time] + EPSILON
      ) {
        dp[time] = candidateRevenue;

        paths[time] = {
          bundle,
          previous: paths[time - bundle.weight]
        };
      }
    }
  }

  let bestTime = 0;

  for (let time = 1; time <= QUARTERS; time++) {
    if (!Number.isFinite(dp[time])) {
      continue;
    }

    if (
      dp[time] > dp[bestTime] + EPSILON ||
      (
        Math.abs(dp[time] - dp[bestTime]) <= EPSILON &&
        time > bestTime
      )
    ) {
      bestTime = time;
    }
  }

  if (!(dp[bestTime] > 0)) {
    return null;
  }

  const selected = [];
  let node = paths[bestTime];

  while (node) {
    for (
      let i = 0;
      i < node.bundle.count;
      i++
    ) {
      selected.push(node.bundle.option);
    }

    node = node.previous;
  }

  selected.sort(
    (a, b) =>
      b.revenue / b.hours -
      a.revenue / a.hours ||
      a.route.code.localeCompare(b.route.code)
  );

  let hours = 0;
  const legs = [];

  for (const option of selected) {
    legs.push({
      code: option.route.code,
      routeId: option.route.id,
      start: hours,
      duration: option.hours,
      revenue: option.revenue
    });

    hours += option.hours;
  }

  return {
    hours,
    revenue: dp[bestTime],
    legs
  };
}



/**
 * v0.7 — Pairwise network improvement
 *
 * Rebuilds pairs of existing rotations using the demand
 * released by those two rotations.
 *
 * A replacement is accepted only when:
 * - Both rotations remain feasible
 * - Total revenue increases
 * - Aircraft group count remains unchanged
 *
 * This is a bounded local search, not a global optimum.
 */

function improveRotations(
  rotations,
  remaining,
  aircraftList,
  fleetCandidates,
  stop = () => false,
  maxPasses = 3
) {
  const aircraftByModel = new Map(
    aircraftList.map(a => [a.model, a])
  );

  const baselineTotal = rotations.reduce(
    (sum, r) => sum + r.revenue,
    0
  );

  let improvements = 0;
  let gain = 0;
  let pairsTested = 0;

  function adjustDemand(rotation, direction) {
    for (const leg of rotation.legs) {
      const available = remaining.get(leg.routeId);

      available.eco += direction * 2 * rotation.eco;
      available.cargo += direction * 2 * rotation.cargo;
    }
  }

  function rebuild(rotation) {
    const aircraft = aircraftByModel.get(rotation.model);

    if (!aircraft) return null;

    const options = buildOptions(
      fleetCandidates.get(aircraft.model) ?? [],
      aircraft,
      remaining
    );

    const circuit = bestCircuit(options, stop);

    if (!circuit) return null;

    return {
      ...rotation,
      ...circuit
    };
  }

  function tryPair(i, j) {
    const originalA = rotations[i];
    const originalB = rotations[j];

    const originalRevenue =
      originalA.revenue + originalB.revenue;

    adjustDemand(originalA, +1);
    adjustDemand(originalB, +1);

    let bestPair = null;
    let bestRevenue = originalRevenue;

    // Test both aircraft allocation orders.
    for (const order of [
      [originalA, originalB],
      [originalB, originalA]
    ]) {
      if (stop()) break;

      const first = rebuild(order[0]);

      if (!first) continue;

      adjustDemand(first, -1);

      const second = rebuild(order[1]);

      adjustDemand(first, +1);

      if (!second) continue;

      const candidateRevenue =
        first.revenue + second.revenue;

      if (candidateRevenue > bestRevenue + EPSILON) {
        bestRevenue = candidateRevenue;

        // Restore original array positions.
        bestPair =
          order[0] === originalA
            ? [first, second]
            : [second, first];
      }
    }

    if (bestPair && !stop()) {
      adjustDemand(bestPair[0], -1);
      adjustDemand(bestPair[1], -1);

      rotations[i] = bestPair[0];
      rotations[j] = bestPair[1];

      improvements++;
      gain += bestRevenue - originalRevenue;

      return true;
    }

    // No improvement: restore original allocation.
    adjustDemand(originalA, -1);
    adjustDemand(originalB, -1);

    return false;
  }

  // Concentrate on the lower-revenue tail where
  // demand fragmentation is most significant.
  const windowSize = Math.min(80, rotations.length);
  const firstIndex = rotations.length - windowSize;

  for (let pass = 0; pass < maxPasses; pass++) {
    if (stop()) break;

    let changed = false;

    for (let i = firstIndex; i < rotations.length - 1; i++) {
      if (stop()) break;

      // Test nearby pairs and more widely separated pairs.
      for (const offset of [1, 2, 5, 10]) {
        const j = i + offset;

        if (j >= rotations.length) continue;

        pairsTested++;

        if (tryPair(i, j)) {
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  const improvedTotal = rotations.reduce(
    (sum, r) => sum + r.revenue,
    0
  );

  return {
    baselineTotal,
    improvedTotal,
    gain: improvedTotal - baselineTotal,
    improvements,
    pairsTested
  };
}



// ============================================================
// MAIN OPTIMISER
// ============================================================

export function optimise(
  data,
  {
    groups = null,
    x380PlusAvailableGroups = 1,
    onProgress = () => {},
    stop = () => false
  } = {}
) {
  const hub = String(data?.hub ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,5}$/.test(hub)) throw new Error("Invalid hub code.");
  const validation = validateData(data);
  const aircraftList = getSupportedAircraft(data);

  // X380Plus is rare: only ten owned, permitting one complete seven-aircraft group.
  // Increase this number when the owned fleet changes.
  const OWNED_X380PLUS = 10;
  const MAX_X380PLUS_GROUPS = Math.min(
    Math.floor(OWNED_X380PLUS / AIRCRAFT_PER_GROUP),
    Number(x380PlusAvailableGroups) === 0 ? 0 : 1
  );
  let allocatedX380PlusGroups = 0;

  const unlimited = groups === null || groups === "";

  const requestedGroups = unlimited
    ? Infinity
    : Number(groups);

  if (
    !unlimited &&
    (
      !Number.isSafeInteger(requestedGroups) ||
      requestedGroups < 1
    )
  ) {
    throw new Error(
      "Group count must be a positive whole number."
    );
  }

  // Total demand: Scenario A.
  const remaining = new Map();

  for (const route of data.routes) {
    remaining.set(route.id, {
      eco: route.ecoDemand,
      cargo: route.cargoDemand
    });
  }

  // Candidate routes are precomputed once.
  const fleetCandidates = new Map();
  const aircraftDiagnostics = {};
  const fleetSummary = {};

  for (const aircraft of aircraftList) {
    const prepared = buildCandidates(
      data.routes,
      aircraft
    );

    fleetCandidates.set(
      aircraft.model,
      prepared.candidates
    );

    aircraftDiagnostics[aircraft.model] = {
      configuration:
        `${aircraft.eco}E + ${aircraft.cargo}C`,
      configurationMode: aircraft.configurationMode,
      category: aircraft.category,
      range: aircraft.range,
      speed: aircraft.speed,
      ...prepared.stats
    };

    fleetSummary[aircraft.model] = {
      model: aircraft.model,
      eco: aircraft.eco,
      cargo: aircraft.cargo,
      configurationMode: aircraft.configurationMode,
      groups: 0,
      aircraftCount: 0,
      weeklyRevenue: 0,
      services: 0,
      scheduledHours: 0
    };
  }

  const diagnostics = {
    scenario: SCENARIO,
    totalRoutes: data.routes.length,
    aircraftModels: aircraftList.length,
    missingTotalDemand: validation.missingTotalDemand,
    aircraft: aircraftDiagnostics,
    groups: []
  };

  const rotations = [];
  let total = 0;

  for (
    let groupIndex = 0;
    groupIndex < requestedGroups && !stop();
    groupIndex++
  ) {
    const evaluations = [];

    // Compute feasible options and optimistic revenue
    // for every aircraft type.
    for (const aircraft of aircraftList) {
      if (aircraft.model === "X380Plus" && allocatedX380PlusGroups >= MAX_X380PLUS_GROUPS) continue;
      if (stop()) {
        break;
      }

      const candidates =
        fleetCandidates.get(aircraft.model) ?? [];

      const options = buildOptions(
        candidates,
        aircraft,
        remaining
      );

      if (options.length === 0) {
        continue;
      }

      evaluations.push({
        aircraft,
        options,
        upperBound: revenueUpperBound(options)
      });
    }

    // Search promising models first.
    evaluations.sort(
      (a, b) => b.upperBound - a.upperBound
    );

    let bestChoice = null;

    for (const evaluation of evaluations) {
      if (stop()) {
        break;
      }

      if (
        bestChoice &&
        evaluation.upperBound <=
          bestChoice.circuit.revenue + EPSILON
      ) {
        break;
      }

      const circuit = bestCircuit(
        evaluation.options,
        stop
      );

      if (!circuit) {
        continue;
      }

      if (
        !bestChoice ||
        circuit.revenue >
          bestChoice.circuit.revenue + EPSILON ||
        (
          Math.abs(
            circuit.revenue -
            bestChoice.circuit.revenue
          ) <= EPSILON &&
          circuit.hours > bestChoice.circuit.hours
        )
      ) {
        bestChoice = {
          aircraft: evaluation.aircraft,
          circuit,
          eligibleDestinations:
            evaluation.options.length
        };
      }
    }

    if (stop() || !bestChoice) {
      break;
    }

    const {
      aircraft,
      circuit,
      eligibleDestinations
    } = bestChoice;

    const rotation = {
      id:
        `${hub}-${String(
          groupIndex + 1
        ).padStart(3, "0")}`,

      model: aircraft.model,
      aircraftId: aircraft.id,
      eco: aircraft.eco,
      cargo: aircraft.cargo,
      configurationMode: aircraft.configurationMode,
      ...circuit
    };

    // Deduct daily demand from this new group.
    for (const leg of rotation.legs) {
      const available = remaining.get(leg.routeId);

      available.eco = Math.max(
        0,
        available.eco - 2 * aircraft.eco
      );

      available.cargo = Math.max(
        0,
        available.cargo - 2 * aircraft.cargo
      );
    }

    if (rotation.model === "X380Plus") allocatedX380PlusGroups++;

    rotations.push(rotation);
    total += rotation.revenue;

    const summary = fleetSummary[aircraft.model];

    summary.groups++;
    summary.aircraftCount += AIRCRAFT_PER_GROUP;
    summary.weeklyRevenue += rotation.revenue;
    summary.services += rotation.legs.length;
    summary.scheduledHours += rotation.hours;

    diagnostics.groups.push({
      id: rotation.id,
      model: aircraft.model,
      eligibleDestinations,
      services: rotation.legs.length,
      hours: rotation.hours,
      unusedHours: ROTATION_HOURS - rotation.hours,
      weeklyRevenue: rotation.revenue
    });

    onProgress({
      completed: rotations.length,
      total,
      rotation,
      fleetSummary
    });
  }

  
  // ==========================================================
  // v0.7 — NETWORK IMPROVEMENT
  // ==========================================================

  const improvement = improveRotations(
    rotations,
    remaining,
    aircraftList,
    fleetCandidates,
    stop,
    3
  );

  total = improvement.improvedTotal;

  // Recalculate fleet totals after accepted replacements.
  for (const summary of Object.values(fleetSummary)) {
    summary.groups = 0;
    summary.aircraftCount = 0;
    summary.weeklyRevenue = 0;
    summary.services = 0;
    summary.scheduledHours = 0;
  }

  for (const rotation of rotations) {
    const summary = fleetSummary[rotation.model];

    summary.groups++;
    summary.aircraftCount += AIRCRAFT_PER_GROUP;
    summary.weeklyRevenue += rotation.revenue;
    summary.services += rotation.legs.length;
    summary.scheduledHours += rotation.hours;
  }

  // Refresh diagnostics for the final accepted schedule.
  diagnostics.groups = rotations.map(rotation => ({
    id: rotation.id,
    model: rotation.model,
    services: rotation.legs.length,
    hours: rotation.hours,
    unusedHours: ROTATION_HOURS - rotation.hours,
    weeklyRevenue: rotation.revenue
  }));

  diagnostics.improvement = improvement;

  let startingEconomy = 0;
  let startingCargo = 0;
  let remainingEconomy = 0;
  let remainingCargo = 0;

  for (const route of data.routes) {
    startingEconomy += route.ecoDemand;
    startingCargo += route.cargoDemand;

    const available = remaining.get(route.id);

    remainingEconomy += available.eco;
    remainingCargo += available.cargo;
  }

  return {
    rotations,
    total,
    improvement,
    remaining,
    validation,
    diagnostics,
    fleetSummary,

    demandSummary: {
      startingEconomy,
      startingCargo,
      remainingEconomy,
      remainingCargo,
      allocatedEconomy:
        startingEconomy - remainingEconomy,
      allocatedCargo:
        startingCargo - remainingCargo
    },

    scenario: SCENARIO,
    demandSource: "TOTAL_CURRENT_DEMAND",
    method:
      "greedy-knapsack-with-pairwise-improvement",
    preflight: "NOT_RUN"
  };
}

// ============================================================
// CSV EXPORT
// ============================================================

export function exportCSV(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "";
  }

  const keys = Object.keys(rows[0]);

  const escapeCSV = value =>
    '"' +
    String(value ?? "").replaceAll('"', '""') +
    '"';

  return [
    keys.map(escapeCSV).join(","),
    ...rows.map(row =>
      keys.map(key => escapeCSV(row[key])).join(",")
    )
  ].join("\r\n");
}
