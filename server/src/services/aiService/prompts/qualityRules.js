/**
 * qualityRules.js
 *
 * Canonical Terminal-Bench instruction.md quality rules extracted directly from
 * the skill documentation.  Import this and embed it into every prompt that
 * either generates or reviews instruction.md so all rules are always in sync.
 */

// ── A1: Banned words / phrases ────────────────────────────────────────────────
export const A1_BANNED = `\
A1 — BANNED words / phrases (NEVER appear in instruction.md):
  Teaching:      homework, exercise, learn, tutorial, course, experiment,
                 lab, assignment, practice
  Casual:        haha, hehe, good luck, try it out, give it a shot, play around
  Over-polite:   please help, sorry to bother, thank you for cooperation, appreciate it
  Vague:         probably, maybe, perhaps, try to, approximately, basically,
                 kind of, sort of
  Teaching lead: let's, first let's learn, now we will practice, through this exercise`;

// ── A2: Opening style ─────────────────────────────────────────────────────────
export const A2_OPENING = `\
A2 — OPENING STYLE — the very first word(s) of instruction.md MUST be one of:
  ✅ Imperative verb  : Build / Implement / Create / Write / Set up / Configure /
                        Install / Compile / Analyze / Deploy / Extract / Parse /
                        Optimize / Refactor / Generate / Measure / Benchmark…
  ✅ Task statement   : "Your task is to…"  /  "You are given…"  /  "You need to…"
  ✅ Direct description: "The file…"  /  "Compile…"  /  "Analyze…"

  ❌ FORBIDDEN first words / patterns:
      "You are a…"  /  "You are an…"   ← persona framing, strictly forbidden
      "Hello"  /  "Hi there"           ← greetings
      "In this task"  /  "In this exercise"  /  "In this lab"  ← teaching framing
      "Let's"  /  "We will"  /  "Now we"     ← collaborative lead-in`;

// ── A3: Path & version precision ──────────────────────────────────────────────
export const A3_PATHS = `\
A3 — PATHS & VERSIONS:
  • All file paths must be absolute or unambiguous (e.g. /app/data.csv, not "a JSON file")
  • Third-party tools/libraries must include exact version (e.g. grpcio==1.73.0)
    – Standard system utilities (bash, awk, sed, curl…) are exempt
  • Output file path / name / format must be stated explicitly`;

// ── A4: Technical precision ───────────────────────────────────────────────────
export const A4_TECHNICAL = `\
A4 — TECHNICAL PRECISION:
  • Use standard technical verbs; no vague language: "deal with", "fix up", "make it work"
  • Command / function / parameter names must be accurate`;

// ── A5: Language ──────────────────────────────────────────────────────────────
export const A5_LANGUAGE = `\
A5 — LANGUAGE:
  • Entire instruction.md must be written in English only
  • No Chinese, Japanese, Korean, or any non-English characters`;

// ── B1–B4: Important rules ────────────────────────────────────────────────────
export const B_RULES = `\
B1 — STRUCTURAL COMPLETENESS (should have all of):
  • 1–3 sentence task objective summary
  • Numbered/bulleted requirement list
  • Technical constraints (allowed/forbidden tools or methods)
  • Input/output specification with exact paths, formats, field names
  • Success criteria (how to verify completion)

B2 — FORMAT CONVENTIONS:
  • Uses Markdown (headers, lists, code blocks, tables where helpful)

B3 — INFORMATION COMPLETENESS:
  • Inputs, outputs, success criteria, and constraints are all present and unambiguous

B4 — TONE CONSISTENCY:
  • Consistent person (2nd-person or imperative), tense, and formality throughout`;

// ── Full A1–A5 + B1–B4 block (ready to paste into prompts) ───────────────────
export const ALL_QUALITY_RULES = `\
${A1_BANNED}

${A2_OPENING}

${A3_PATHS}

${A4_TECHNICAL}

${A5_LANGUAGE}

--- Important (B rules — should pass) ---

${B_RULES}`;

// ── Compact reviewer prompt (for InstrQuality check — mirrors TB Step 4) ─────
// TB platform uses gemini-2.5-pro for this step; call with that model.
export const INSTR_QUALITY_REVIEWER_SYSTEM = `\
You are a Terminal-Bench instruction.md quality reviewer (mirrors Step 4 of the TB submission pipeline).
Evaluate the instruction strictly against ALL rules below.

${ALL_QUALITY_RULES}

Scoring:
- A rules are CRITICAL — any single A violation → passed: false
- B rules are IMPORTANT — violations should be listed as issues even if not blocking

Return ONLY valid JSON with no markdown fences:
{"passed": true|false, "issues": ["<rule id + specific violation + location>", ...]}

"passed" must be true only when there are zero A-rule violations.
Be strict and specific — quote the offending phrase / missing element in every issue.`;

// ── Fix guidance (for AI fix pass — must be self-contained, no "see above") ──
export const INSTR_FIX_GUIDANCE = `\
instruction-quality fixes — apply ALL of the following to instruction.md:

A1 — Remove EVERY occurrence of these banned words/phrases:
  homework, exercise, learn, tutorial, course, experiment, lab, assignment, practice,
  haha, hehe, good luck, try it out, give it a shot, play around,
  please help, sorry to bother, thank you for cooperation, appreciate it,
  probably, maybe, perhaps, try to, approximately, basically, kind of, sort of,
  let's, first let's learn, now we will practice, through this exercise

A2 — Fix the opening line:
  FORBIDDEN first words → rewrite immediately:
    "You are a…" / "You are an…"  → replace with an imperative verb
    "Hello" / "Hi there"          → replace with an imperative verb
    "In this task/exercise/lab"   → replace with an imperative verb
    "Let's" / "We will" / "Now we"→ replace with an imperative verb
  ALLOWED openings: imperative verb (Build/Implement/Configure/…),
    "Your task is to…", "You are given…", "You need to…", "The file…"

A3 — Paths & versions:
  Replace every vague path with an absolute path (e.g. /app/data.csv).
  Add exact version to every named third-party library (e.g. grpcio==1.73.0).
  State output file path/name/format explicitly.

A4 — Technical precision:
  Replace vague verbs ("deal with", "fix up", "make it work") with precise ones.

A5 — English only:
  Translate any non-English text to English.`;
