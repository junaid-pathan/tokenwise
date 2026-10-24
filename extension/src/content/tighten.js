// A: "Tighten" — rewrites a prompt to say the same thing in fewer tokens.
// Rule-based, instant, no network. Exposes DS.tighten(text) and DS.estTokens(text).

(() => {
  "use strict";

  // Rough token count in the style of BPE tokenizers: common lowercase words
  // are ~1 token per 4 chars, ALL-CAPS words split into ~2-char pieces, each
  // punctuation mark and each newline is its own token.
  function estTokens(text) {
    let n = 0;
    for (const m of (text || "").matchAll(/[A-Za-z]+|\d+|\n|[^\sA-Za-z\d]/g)) {
      const s = m[0];
      if (s === "\n") n += 1;
      else if (/^[A-Z]{2,}$/.test(s)) n += Math.ceil(s.length / 2);
      else if (/^[A-Za-z]+$/.test(s)) n += Math.max(1, Math.ceil(s.length / 4));
      else if (/^\d+$/.test(s)) n += Math.ceil(s.length / 3);
      else n += 1;
    }
    return n;
  }

  // Short all-caps words that are real acronyms, kept as-is.
  const ACRONYM = /^(AI|API|CEO|CPU|GPU|USA|UK|EU|NASA|HTML|CSS|SQL|JSON|URL|PDF|FAQ|ID|OK|TV|PC|IT|HR|AWS|LLM|ML|UI|UX|ETA|ASAP|DIY|MIT|DNA|RNA|CO2|PhD|I)$/;

  // Filler that adds tokens but not meaning. Order matters: longest first.
  const FILLER = [
    /\b(hi|hey|hello)( there)?,?\s*(claude|chatgpt|ai)?[,!.]*\s+/gi,
    /\bi was (just )?wondering if you could\s+/gi,
    /\bi would (really )?(like|love) (for )?you to\s+/gi,
    /\bwould you (please |kindly )?be able to\s+/gi,
    /\b(could|can|would) you (please |kindly |possibly )*/gi,
    /\bplease (kindly )?/gi,
    /\bkindly\s+/gi,
    /\b(thank you|thanks)( so much| very much| a lot)?( in advance)?[!.]*\s*/gi,
    /\b(basically|literally|actually|honestly|just|really|totally|simply|very much),?\s+/gi,
    /\bif (that's|that is) (ok|okay|possible|alright)[,.!?]*\s*/gi,
    /\bas soon as possible\b/gi,
    /\bin order to\b/gi,
    /\bdue to the fact that\b/gi,
    /\bat this point in time\b/gi,
  ];
  const FILLER_REPLACE = { "as soon as possible": "ASAP", "in order to": "to", "due to the fact that": "because", "at this point in time": "now" };

  function decap(text) {
    const letters = text.replace(/[^A-Za-z]/g, "");
    const caps = letters.replace(/[^A-Z]/g, "").length;
    const shouting = letters.length >= 8 && caps / letters.length > 0.6;
    return text.replace(/\b[A-Z][A-Z']+\b/g, (w) => {
      if (ACRONYM.test(w)) return w;
      // Whole prompt in caps, or one long shouted word: lower it.
      return shouting || w.length >= 4 ? w.toLowerCase() : w;
    });
  }

  function sentenceCase(text) {
    return text.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  }

  function tighten(input) {
    let t = input || "";
    const changes = [];
    const step = (label, fn) => {
      const next = fn(t);
      if (next !== t) {
        changes.push(label);
        t = next;
      }
    };

    step("ALL CAPS", decap);
    step("stretched words (sooo)", (s) => s.replace(/([a-z])\1{2,}/gi, "$1"));
    step("filler words", (s) => {
      for (const re of FILLER) {
        s = s.replace(re, (m) => FILLER_REPLACE[m.toLowerCase()] ?? "");
      }
      return s;
    });
    step("extra !!! and ???", (s) =>
      s.replace(/([!?])[!?]+/g, "$1").replace(/\.{4,}/g, "...").replace(/,{2,}/g, ",")
    );
    step("repeated words", (s) => s.replace(/\b(\w+)(\s+\1\b)+/gi, "$1"));
    step("repeated emoji", (s) => s.replace(/(\p{Extended_Pictographic})(\s*\1)+/gu, "$1"));
    step("extra blank lines", (s) =>
      s.replace(/[ \t]+$/gm, "").replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").trim()
    );
    t = sentenceCase(t.replace(/^\s*[,.;:]\s*/, "").replace(/\s+([,.!?])/g, "$1").replace(/[,;:]+$/, ""));

    const before = estTokens(input);
    const after = estTokens(t);
    return { text: t, before, after, saved: before - after, changes };
  }

  globalThis.DS = Object.assign(globalThis.DS || {}, { tighten, estTokens });
})();
