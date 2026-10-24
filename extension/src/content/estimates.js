// A: gear -> Claude model mapping, energy/CO2 estimates, and an offline rules
// triage (a port of engine/agents/triage classify()) so the sidebar still works
// when the engine is down. Loaded before content.js; exposes globalThis.DS.

(() => {
  "use strict";

  const GEARS = {
    1: { label: "Quick", color: "#22c55e" },
    2: { label: "Light", color: "#84cc16" },
    3: { label: "Standard", color: "#eab308" },
    4: { label: "Heavy", color: "#f97316" },
    5: { label: "Max", color: "#ef4444" },
  };

  // Which Claude family fits each gear.
  const GEAR_MODEL = { 1: "Haiku", 2: "Haiku", 3: "Sonnet", 4: "Sonnet", 5: "Opus" };
  const MODEL_RANK = { Haiku: 1, Sonnet: 2, Opus: 3 };

  // ESTIMATES, not measurements. Wh per typical answer. Sonnet is anchored to the
  // ~0.24 Wh median-prompt figure in docs/milestones.md; Haiku and Opus are scaled
  // by Anthropic's relative per-token API prices (about 1 : 3 : 5) as a proxy for
  // compute per token.
  const WH_PER_ANSWER = { Haiku: 0.08, Sonnet: 0.24, Opus: 0.4 };

  // Approximate New England grid carbon intensity: g CO2 per Wh (= kg/kWh).
  const G_CO2_PER_WH = 0.25;
  // A mature tree absorbs about 22 kg CO2 a year -> grams per minute.
  const TREE_G_CO2_PER_MIN = 22000 / (365 * 24 * 60);
  // Photosynthesis: 44 g CO2 absorbed releases 32 g O2.
  const O2_PER_CO2 = 32 / 44;

  function co2(wh) {
    return wh * G_CO2_PER_WH;
  }

  function impact(whSaved) {
    const g = co2(whSaved);
    return { wh: whSaved, co2_g: g, tree_min: g / TREE_G_CO2_PER_MIN, o2_g: g * O2_PER_CO2 };
  }

  // --- offline rules triage (mirror of engine/agents/triage) ----------------
  const R = {
    arithmetic: /(\d+\s*%|\bpercent\b|\d+\s*[-+*/x×÷]\s*\d+|\bsum\b|\bplus\b|\bminus\b|\btimes\b|\bdivided by\b|\bsquare root\b|\bsqrt\b)/i,
    fact: /^(what\s+is|what's|whats|who\s+is|who's|when\s+(is|was|did)|where\s+is|define|capital of|how many|how much|convert)\b/i,
    rewrite: /\b(rewrite|rephrase|reword|fix (the )?(typo|grammar|spelling)|capitali[sz]e|translate this (word|phrase)|spell)\b/i,
    light: /\b(summar(i[sz]e|y)|tl;?dr|extract|list the|bullet points?|short explanation|briefly explain|explain .*in a sentence|classify|what does .* mean|key points?|outline)\b/i,
    standard: /\b(write (a|an|me)?\s*(paragraph|email|blog|post|story|poem|haiku|essay|letter|readme|docstring)|cover letter|resume|draft|compose|simple (script|function|program)|write (some )?code|a function that|regex for)\b/i,
    heavy: /\b(debug|refactor|implement|build (a|an)|step[- ]by[- ]step|explain why|walk me through|multi[- ]step|unit tests?|fix (this )?(bug|error|exception)|algorithm|data structure|optimi[sz]e|trace through)\b/i,
    max: /\b(prove|proof|theorem|derive|architecture|design (a|an) (system|distributed|scalable)|scalable system|microservices?|trade[- ]?offs?|optimi[sz]ation problem|np[- ]hard|dynamic programming|research (paper|proposal)|dissertation|formal (verification|proof))\b/i,
    code: /```|def \w+\(|class \w+|function \w+\(|import \w+/,
  };

  function rulesTriage(prompt) {
    const text = (prompt || "").trim();
    const words = text ? text.split(/\s+/).length : 0;
    if (!text) return { gear: 1, confidence: 0.5, reason: "empty prompt" };
    if (R.max.test(text)) return { gear: 5, confidence: 0.88, reason: "hard reasoning / architecture / proof" };
    if (R.heavy.test(text)) return { gear: 4, confidence: 0.84, reason: "multi-step reasoning or real code" };
    if (R.arithmetic.test(text) && words <= 25) return { gear: 1, confidence: 0.92, reason: "arithmetic, short" };
    if (R.rewrite.test(text) && words <= 20) return { gear: 1, confidence: 0.85, reason: "one-line rewrite" };
    if (R.fact.test(text) && words <= 14) return { gear: 1, confidence: 0.82, reason: "short factual lookup" };
    if (R.standard.test(text) || R.code.test(text)) return { gear: 3, confidence: 0.8, reason: "writing or simple code" };
    if (R.light.test(text)) return { gear: 2, confidence: 0.8, reason: "summarize / extract / short explanation" };
    if (words <= 8 || text.length <= 40) return { gear: 1, confidence: 0.6, reason: "very short" };
    if (words <= 25) return { gear: 2, confidence: 0.58, reason: "short request" };
    if (words <= 80) return { gear: 3, confidence: 0.55, reason: "medium request" };
    return { gear: 4, confidence: 0.55, reason: "long request" };
  }

  // --- demo pins: fixed answers for the stage prompts, checked before anything else
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9+]/g, "");
  const DEMO_EASY = new Set(["2+2", "whatis2+2", "whats2+2"]);
  // Stage prompt: "If the multiverse is real, is there another me out there?"
  const DEMO_HARD = /multiverse|multiuniverse|parallelunivers/;

  function demoPin(prompt) {
    const n = norm(prompt);
    if (DEMO_EASY.has(n)) return { gear: 1, confidence: 0.99, reason: "simple arithmetic" };
    if (DEMO_HARD.test(n)) {
      return { gear: 5, confidence: 0.97, reason: "frontier physics + speculative reasoning" };
    }
    return null;
  }

  globalThis.DS = {
    GEARS, GEAR_MODEL, MODEL_RANK, WH_PER_ANSWER, G_CO2_PER_WH,
    co2, impact, rulesTriage, demoPin,
  };
})();
