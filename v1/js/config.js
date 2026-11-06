// =====================================================================
//  BEER GAME SETTINGS
//  These are the defaults shown on the "Create session" form. You can
//  change any of them per session on that form, and the brewery, cost
//  and order-limit settings can also be changed mid-game from the
//  instructor dashboard.
// =====================================================================

// ---------------------------------------------------------------------
// 1. BACKEND
//    "local"    = test mode. Everything lives in this one browser.
//                 Open extra tabs to play several teams yourself.
//    "firebase" = classroom mode. Paste your Firebase config below
//                 (see README.md, step 2).
// ---------------------------------------------------------------------
export const BACKEND = "local";

export const FIREBASE_CONFIG = {
  apiKey: "PASTE-YOURS-HERE",
  authDomain: "PASTE-YOURS-HERE.firebaseapp.com",
  projectId: "PASTE-YOURS-HERE",
  storageBucket: "PASTE-YOURS-HERE.appspot.com",
  messagingSenderId: "PASTE-YOURS-HERE",
  appId: "PASTE-YOURS-HERE",
};

// ---------------------------------------------------------------------
// 2. GAME DEFAULTS
// ---------------------------------------------------------------------
export const DEFAULTS = {
  // "network" = one class-wide supply network (1 brewery feeding
  //             distributors, wholesalers and retailers)
  // "classic" = several independent four-team games
  mode: "network",

  // Network shape. Each tier is split evenly among the tier above it.
  networkDistributors: 2,
  networkWholesalers: 4,
  networkRetailers: 8,

  // Classic mode: target number of students on each role-team.
  // The number of games is worked out from how many students join.
  classicTeamSize: 3,

  // Length of the game in weeks. Students are never shown this.
  weeks: 36,

  // Customer demand at EACH retailer.
  // "step":   demandBase until demandStepWeek, then demandStepTo
  // "custom": comma-separated list, one number per week (last repeats)
  demandType: "step",
  demandBase: 4,
  demandStepWeek: 5,
  demandStepTo: 8,
  demandCustom: "",

  // Every team starts with this many weeks of its normal flow on hand
  // (classic: 3 x 4 = 12 cases, the traditional starting inventory)
  startingInventoryWeeks: 3,

  // Lead times, in weeks
  orderDelay: 2,       // an order takes this long to reach the supplier
  shipDelay: 2,        // a shipment takes this long to reach the customer
  productionDelay: 3,  // brewing takes this long

  // Costs per case per week
  holdingCost: 0.5,
  backorderCost: 1.0,

  // Brewery capacity, as multiples of the brewery's peak normal demand
  // (network default: peak demand 64/week -> normal 96, surge up to 192;
  //  calibrated with tools/simulate.mjs so the brewery feels the crunch
  //  but works off its backlog well before the game ends)
  normalCapacityFactor: 1.5,
  surgeCapacityFactor: 3,
  surgePremium: 1.0,   // extra cost for each case brewed above normal

  // Order checks
  // Warning: "are you sure?" when an order is more than this many times
  // the team's recent incoming orders (never less than its normal flow).
  warnMultiple: 3,
  // Hard maximum = this multiple x the team's normal weekly flow.
  // Grows upstream because real bullwhip peaks grow upstream.
  hardMaxRetailer: 10,
  hardMaxWholesaler: 15,
  hardMaxDistributor: 20,

  // Information sharing
  //   "off"   = classic: each team sees only its own numbers
  //   "on"    = every team also sees end-customer demand and each
  //             tier's total inventory and backorders
  //   "split" = classic mode only: half the games share, half do not
  sharing: "off",
};

export const TIERS = ["retailer", "wholesaler", "distributor", "brewery"];
export const TIER_LABELS = {
  retailer: "Retailer",
  wholesaler: "Wholesaler",
  distributor: "Distributor",
  brewery: "Brewery",
};
