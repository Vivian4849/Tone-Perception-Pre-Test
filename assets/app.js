/* ============================================================================
   Mandarin Tone Perception Test — application logic
   Shared by pilot.html and main.html. The page type comes from
   <body data-test-type="pilot|main">.

   One item = TWO syllables. Each syllable gets its own row of four tone
   buttons, and both rows must be answered before "Next" unlocks.
   ========================================================================== */

(function () {
  "use strict";

  /* ==========================================================================
     [1]  GOOGLE APPS SCRIPT ENDPOINT
     --------------------------------------------------------------------------
     Two ways to set it — pick ONE:

     (a) RECOMMENDED — put it in assets/config.js, so you never touch this file:

             window.TONE_TEST_ENDPOINT = "https://script.google.com/macros/s/AKfy.../exec";

     (b) or paste it below between the quotes.

     Leave both empty and the page simply skips the network call — the CSV
     download keeps working, so nothing breaks before you are ready.
     ========================================================================== */
  const ENDPOINT_INLINE = "";

  const ENDPOINT = (function () {
    const inline = String(ENDPOINT_INLINE || "").trim();
    if (inline) return inline;
    try {
      const fromConfig = (typeof window !== "undefined" && window.TONE_TEST_ENDPOINT)
        ? String(window.TONE_TEST_ENDPOINT).trim()
        : "";
      return fromConfig || "";
    } catch (err) {
      return "";
    }
  })();

  /* Shown only when an upload fails, so a screenshot tells us which build ran. */
  const BUILD = "v2.3-2026-10-29";

  function endpointHost() {
    if (!ENDPOINT) return "(none)";
    try { return new URL(ENDPOINT).host; } catch (err) { return ENDPOINT.slice(0, 60); }
  }

  /* ==========================================================================
     [2]  Test definition (read from assets/config.js)
     ========================================================================== */
  const TEST_TYPE = (document.body.getAttribute("data-test-type") || "main").toLowerCase();
  const IS_PILOT = TEST_TYPE === "pilot";
  const TYPE_LABEL = IS_PILOT ? "Pilot Test" : "Main Test";

  /* Set on <body data-next="main.html"> — the page to open automatically once
     this test has been submitted. Empty on the last test in the chain. */
  const NEXT_PAGE = (document.body.getAttribute("data-next") || "").trim();

  /* How long the "well done" screen stays up before the next section starts. */
  const ADVANCE_MS = 6000;

  const TONES = [
    { id: 1, mark: "\u02C9", name: "High level" },
    { id: 2, mark: "\u02CA", name: "Rising" },
    { id: 3, mark: "\u02C7", name: "Dipping" },
    { id: 4, mark: "\u02CB", name: "Falling" }
  ];

  /* The four tone contours, drawn as strokes instead of relying on the tiny
     modifier letters (ˉ ˊ ˇ ˋ), which almost disappear at small sizes. */
  const TONE_PATHS = {
    1: "M5 17H35",
    2: "M6 28L34 6",
    3: "M6 6Q20 38 34 6",
    4: "M6 6L34 28"
  };

  const CFG_ITEMS = (typeof AUDIO_CONFIG !== "undefined" && Array.isArray(AUDIO_CONFIG[TEST_TYPE]))
    ? AUDIO_CONFIG[TEST_TYPE].filter(function (x) { return x && typeof x === "object"; })
    : [];

  const MAX_PLAYS = (typeof SETTINGS !== "undefined" && Number(SETTINGS.maxPlays) > 0)
    ? Math.floor(Number(SETTINGS.maxPlays)) : 2;

  const REQUIRE_ANSWER = !(typeof SETTINGS !== "undefined" && SETTINGS.requireAnswerBeforeNext === false);
  const SHUFFLE = !!(typeof SETTINGS !== "undefined" && SETTINGS.shuffleItems);

  const KEY_STORAGE = "ttp.answerKey.v2." + TEST_TYPE;
  const NAME_STORAGE = "ttp.student";

  /* ==========================================================================
     [3]  State
     ========================================================================== */
  const state = {
    phase: "start",          // start | test | done
    student: { name: "", major: "" },
    items: [],
    pos: 0,
    uploads: [],             // [{ name, src }]  loaded at run time
    keyOverride: null,       // flat array of 0..4, or null
    qStart: 0,
    active: 0,               // flat index of the syllable the keyboard acts on
    blockEls: [],            // [{ group, stim, el }]  for the current item
    playerUI: [],            // [{ g, btn, status, hint, count }]
    playingGroup: null,
    playTimer: null,
    audio: null,
    submitted: false,
    postSettled: false,
    postOk: null,
    settledAt: 0,
    advTimer: null
  };

  const $ = function (id) { return document.getElementById(id); };
  const els = {};

  /* ==========================================================================
     [4]  Boot
     ========================================================================== */
  // If the previous section failed to upload, say so on this page instead of
  // letting it disappear with the page the student already left.
  function showUploadBanner() {
    let info = null;
    try {
      const raw = sessionStorage.getItem("tpUploadFailed");
      if (!raw) return;
      sessionStorage.removeItem("tpUploadFailed");
      info = JSON.parse(raw);
    } catch (e) { return; }
    if (!info) return;

    const bar = document.createElement("div");
    bar.setAttribute("role", "alert");
    bar.style.cssText = "margin:0 0 18px;padding:12px 16px;border:1px solid #e2b1aa;" +
      "border-left:4px solid #b4231a;border-radius:10px;background:#fdf1ef;color:#8a1b12;" +
      "font-size:13.5px;line-height:1.55";
    const which = info.test === "pilot" ? "Pilot" : "Main";
    bar.textContent = "Heads-up: the " + which + " results could not be uploaded to the spreadsheet (" +
      info.message + "). The CSV file on this computer is complete \u2014 please tell the researcher before continuing.";

    const host = document.querySelector(".card") || document.body;
    host.insertBefore(bar, host.firstChild);
  }

  function boot() {
    els.screens = {
      start: $("screen-start"),
      test: $("screen-test"),
      done: $("screen-done")
    };
    els.form = $("startForm");
    els.nameInput = $("nameInput");
    els.majorInput = $("majorInput");
    els.formError = $("formError");
    els.startBtn = $("startBtn");

    els.qNum = $("qNum");
    els.qTotal = $("qTotal");
    els.bar = $("bar");
    els.whoMeta = $("whoMeta");
    els.playsPill = $("playsPill");
    els.players = $("players");
    els.syllables = $("syllables");
    els.prevBtn = $("prevBtn");
    els.nextBtn = $("nextBtn");
    els.audioNote = $("audioNote");

    els.setupWarning = $("setupWarning");
    els.audioFiles = $("audioFiles");
    els.audioFolder = $("audioFolder");
    els.audioStatus = $("audioStatus");
    els.keyInput = $("keyInput");
    els.keyStatus = $("keyStatus");
    els.applyKey = $("applyKey");
    showUploadBanner();
    els.clearKey = $("clearKey");

    els.doneName = $("doneName");
    els.scoreValue = $("scoreValue");
    els.scoreDen = $("scoreDen");
    els.scoreSub = $("scoreSub");
    els.summaryBody = $("summaryBody");
    els.downloadBtn = $("downloadBtn");
    els.finishBtn = $("finishBtn");
    els.postStatus = $("postStatus");
    els.nextBox = $("nextBox");
    els.countdown = $("countdown");
    els.nextNowBtn = $("nextNowBtn");
    els.toast = $("toast");

    // Load a previously saved answer key for this test type.
    try {
      const saved = localStorage.getItem(KEY_STORAGE);
      if (saved) {
        const parsed = parseKeyList(saved);
        if (parsed.length === totalSyllables()) state.keyOverride = parsed;
      }
    } catch (err) { /* storage blocked — not fatal */ }

    syncKeyInput();
    refreshAudioStatus();
    refreshWarning();

    els.form.addEventListener("submit", onStart);

    [els.nameInput, els.majorInput].forEach(function (input) {
      input.addEventListener("input", function () {
        if (!els.formError.hidden) els.formError.hidden = true;
      });
    });

    els.prevBtn.addEventListener("click", function () { if (state.pos > 0) goTo(state.pos - 1); });
    els.nextBtn.addEventListener("click", onNext);

    if (els.audioFiles) els.audioFiles.addEventListener("change", function () { onFilesPicked(this.files); });
    if (els.audioFolder) els.audioFolder.addEventListener("change", function () { onFilesPicked(this.files); });
    els.applyKey.addEventListener("click", onApplyKey);
    els.clearKey.addEventListener("click", onClearKey);

    els.downloadBtn.addEventListener("click", function () { downloadCsv(); });
    els.finishBtn.addEventListener("click", function () {
      if (IS_PILOT) window.location.reload();
      else window.location.href = "index.html";
    });
    if (NEXT_PAGE) els.finishBtn.hidden = true;
    if (els.nextNowBtn) els.nextNowBtn.addEventListener("click", goNext);

    document.addEventListener("keydown", onKeydown);

    window.addEventListener("beforeunload", function (e) {
      if (state.phase === "test") {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    });

    resume();
  }

  /* --------------------------------------------------------------------------
     Hand-off from the previous page: ?name=…&major=…&from=…
     If the audio for this section is fully available, the test starts at once.
     If it is not (nothing configured yet), the start screen stays up so the
     teacher can load the files in the setup panel first.
     -------------------------------------------------------------------------- */
  function resume() {
    const q = parseQuery();
    let name = q.name;
    let major = q.major;

    if (!name || !major) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(NAME_STORAGE) || "null");
        if (saved && saved.name && saved.major) {
          name = name || saved.name;
          major = major || saved.major;
        }
      } catch (err) { /* ignore */ }
    }

    if (name) els.nameInput.value = name;
    if (major) els.majorInput.value = major;

    if (!name || !major) return;
    if (!CFG_ITEMS.length) return;

    if (audioReady()) {
      beginSession(name, major);
    }
  }

  function parseQuery() {
    const out = { name: "", major: "", from: "" };
    const search = String(window.location.search || "").replace(/^\?/, "");
    if (!search) return out;
    search.split("&").forEach(function (pair) {
      const bits = pair.split("=");
      const k = decodeURIComponent(bits[0] || "");
      let v = (bits[1] || "").replace(/\+/g, " ");
      try { v = decodeURIComponent(v); } catch (err) { /* keep raw */ }
      if (k === "name" || k === "major" || k === "from") out[k] = v;
    });
    return out;
  }

  /* ==========================================================================
     [5]  Audio pool (batch files / whole folder)
     ========================================================================== */
  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }

  function onFilesPicked(fileList) {
    if (!fileList || !fileList.length) return;

    const picked = Array.prototype.slice.call(fileList)
      .filter(function (f) { return /^audio\//i.test(f.type) || /\.(mp3|wav|m4a|ogg|aac|flac|webm)$/i.test(f.name); })
      .sort(function (a, b) { return naturalCompare(a.name, b.name); });

    if (!picked.length) {
      toast("No audio files found in that selection.");
      return;
    }

    state.uploads.forEach(function (u) { if (u.src.indexOf("blob:") === 0) URL.revokeObjectURL(u.src); });
    state.uploads = picked.map(function (f) {
      return { name: f.name, src: URL.createObjectURL(f) };
    });

    refreshAudioStatus();
    refreshWarning();
    if (state.phase === "test") renderItem();
  }

  function syllableCountOf(item) {
    if (Array.isArray(item.answer) && item.answer.length) return Math.max(1, item.answer.length);
    if (Array.isArray(item.audio) && item.audio.length) return Math.max(1, item.audio.length);
    if (typeof item.answer === "number") return 1;
    return 2;
  }

  function totalSyllables() {
    return CFG_ITEMS.reduce(function (sum, it) { return sum + syllableCountOf(it); }, 0);
  }

  /* Resolve the sound for syllable `s` of item `i`:
     a path from config.js wins, otherwise the files loaded in this session. */
  function resolveAudio(i, s, n) {
    const it = CFG_ITEMS[i] || {};
    const a = it.audio;
    let cfg = "";
    if (Array.isArray(a)) cfg = String(a[Math.min(s, a.length - 1)] || "").trim();
    else if (a) cfg = String(a).trim();

    if (cfg) return { src: cfg, name: cfg.split(/[\\/]/).pop() };

    const up = state.uploads;
    if (!up.length) return { src: "", name: "" };

    let file = null;
    if (up.length >= CFG_ITEMS.length * n) file = up[i * n + s];   // two files per item
    else file = up[i];                                            // one file per item

    return file ? { src: file.src, name: file.name } : { src: "", name: "" };
  }

  function audioReady() {
    let total = 0;
    let ok = 0;
    CFG_ITEMS.forEach(function (it, i) {
      const n = syllableCountOf(it);
      for (let s = 0; s < n; s++) {
        total += 1;
        if (resolveAudio(i, s, n).src) ok += 1;
      }
    });
    return total > 0 && ok === total;
  }

  function parseKeyList(text) {
    const out = [];
    String(text || "").split(/[\s,;]+/).forEach(function (token) {
      if (!token) return;
      token.split(/[-/|]/).forEach(function (part) {
        if (part === "") return;
        const n = parseInt(part, 10);
        out.push(n >= 1 && n <= 4 ? n : 0);
      });
    });
    return out;
  }

  function baseKeys() {
    const flat = [];
    CFG_ITEMS.forEach(function (it) {
      const n = syllableCountOf(it);
      for (let s = 0; s < n; s++) {
        let v = Array.isArray(it.answer) ? it.answer[s] : (n === 1 ? it.answer : 0);
        v = Number(v);
        flat.push(v >= 1 && v <= 4 ? v : 0);
      }
    });
    return flat;
  }

  function resolveKeys() {
    if (state.keyOverride && state.keyOverride.length === totalSyllables()) return state.keyOverride.slice();
    return baseKeys();
  }

  function keysToText(keys) {
    const pairs = [];
    for (let i = 0; i < keys.length; i += 2) {
      pairs.push(keys[i + 1] === undefined ? String(keys[i]) : keys[i] + "-" + keys[i + 1]);
    }
    return pairs.join(", ");
  }

  function syncKeyInput() {
    if (state.keyOverride) {
      els.keyInput.value = keysToText(state.keyOverride);
      els.keyStatus.textContent = "Using the key saved on this device (" + state.keyOverride.length + " syllables).";
      els.keyStatus.className = "status-line is-ok";
      return;
    }
    els.keyInput.value = keysToText(baseKeys());
    els.keyStatus.textContent = "Loaded from assets/config.js.";
    els.keyStatus.className = "status-line";
  }

  function onApplyKey() {
    const parsed = parseKeyList(els.keyInput.value);
    const expected = totalSyllables();

    if (expected === 0) {
      toast("There are no items configured for this test yet.");
      return;
    }
    if (parsed.length !== expected) {
      toast("Expected " + expected + " values (2 per item), got " + parsed.length + ". Nothing was applied.");
      return;
    }
    const known = parsed.filter(function (n) { return n >= 1; }).length;
    if (known === 0) {
      toast("That key has no valid 1\u20134 values.");
      return;
    }

    state.keyOverride = parsed;
    try { localStorage.setItem(KEY_STORAGE, parsed.join(",")); } catch (err) { /* ignore */ }
    syncKeyInput();
    refreshWarning();
    toast("Answer key applied: " + known + " of " + parsed.length + " syllables scored.");
  }

  function onClearKey() {
    state.keyOverride = null;
    try { localStorage.removeItem(KEY_STORAGE); } catch (err) { /* ignore */ }
    syncKeyInput();
    refreshWarning();
    toast("Saved key cleared \u2014 config.js is used again.");
  }

  function refreshAudioStatus() {
    if (!els.audioStatus) return;

    const items = CFG_ITEMS.length;
    const trials = totalSyllables();
    const n = items ? syllableCountOf(CFG_ITEMS[0]) : 2;

    if (!state.uploads.length) {
      let fromCfg = 0;
      CFG_ITEMS.forEach(function (it, i) {
        const m = syllableCountOf(it);
        for (let s = 0; s < m; s++) if (resolveAudio(i, s, m).src) fromCfg += 1;
      });
      els.audioStatus.textContent = fromCfg
        ? fromCfg + " of " + trials + " syllable sound(s) have a path in config.js; no files loaded in this session."
        : "No files loaded in this session and no audio path in config.js yet.";
      els.audioStatus.className = "status-line";
      return;
    }

    let msg = state.uploads.length + " audio file(s) loaded: " +
      state.uploads.slice(0, 3).map(function (u) { return u.name; }).join(", ");
    if (state.uploads.length > 3) msg += " \u2026";

    if (state.uploads.length === items * n) {
      msg += " \u2014 matched as " + n + " files per item (" + items + " items).";
      els.audioStatus.className = "status-line is-ok";
    } else if (state.uploads.length === items) {
      msg += " \u2014 matched as one file per item, used for both syllables.";
      els.audioStatus.className = "status-line is-ok";
    } else {
      msg += " \u2014 expected " + items + " or " + (items * n) + " files for " + items + " items.";
      els.audioStatus.className = "status-line is-warn";
    }
    els.audioStatus.textContent = msg;
  }

  function refreshWarning() {
    if (!els.setupWarning) return;
    const problems = [];

    if (!CFG_ITEMS.length) {
      problems.push("No test items are configured for the " + TYPE_LABEL + ". Add entries to the \"" +
        TEST_TYPE + "\" list in assets/config.js.");
    } else {
      const trials = totalSyllables();
      let withAudio = 0;
      CFG_ITEMS.forEach(function (it, i) {
        const n = syllableCountOf(it);
        for (let s = 0; s < n; s++) if (resolveAudio(i, s, n).src) withAudio += 1;
      });

      if (withAudio === 0) {
        problems.push("No audio is attached yet, so the " + TYPE_LABEL + " will run silently. Open " +
          "\u201cSetup (teacher only)\u201d below to load files, or add paths in assets/config.js.");
      } else if (withAudio < trials) {
        problems.push(withAudio + " of " + trials + " syllable sounds have audio; the rest will be silent.");
      }

      const keyed = resolveKeys().filter(function (k) { return k >= 1; }).length;
      if (keyed === 0) {
        problems.push("No answer key is set, so responses will be recorded but not scored. " +
          "Add answers in config.js or apply a key below.");
      } else if (keyed < trials) {
        problems.push(keyed + " of " + trials + " syllables have an answer key; the rest will be marked \u201cNot scored\u201d.");
      }
    }

    if (!problems.length) {
      els.setupWarning.hidden = true;
      els.setupWarning.textContent = "";
      return;
    }
    els.setupWarning.hidden = false;
    els.setupWarning.innerHTML = "";
    problems.forEach(function (p) {
      const line = document.createElement("div");
      line.textContent = p;
      els.setupWarning.appendChild(line);
    });
  }

  /* ==========================================================================
     [6]  Start a session
     ========================================================================== */
  function onStart(e) {
    e.preventDefault();

    const name = els.nameInput.value.trim();
    const major = els.majorInput.value.trim();

    if (!name || !major) {
      els.formError.hidden = false;
      els.formError.textContent = "Please fill in both Student Name and Major before starting.";
      (!name ? els.nameInput : els.majorInput).focus();
      return;
    }
    els.formError.hidden = true;

    if (!CFG_ITEMS.length) {
      els.formError.hidden = false;
      els.formError.textContent = "No test items are configured. Add entries to \"" + TEST_TYPE + "\" in assets/config.js.";
      return;
    }

    beginSession(name, major);
  }

  function beginSession(name, major) {
    buildItems();
    state.student = { name: name, major: major };
    state.pos = 0;
    state.phase = "test";
    state.qStart = performance.now();

    try {
      sessionStorage.setItem(NAME_STORAGE, JSON.stringify({ name: name, major: major }));
    } catch (err) { /* ignore */ }

    els.whoMeta.textContent = name + "  \u00B7  " + major + "  \u00B7  " + TYPE_LABEL;
    show("test");
    renderItem();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildItems() {
    const keys = resolveKeys();
    let k = 0;

    let items = CFG_ITEMS.map(function (it, i) {
      const n = syllableCountOf(it);
      const groups = [];

      for (let s = 0; s < n; s++) {
        const a = resolveAudio(i, s, n);
        let g = null;
        for (let j = 0; j < groups.length; j++) if (groups[j].src === a.src) g = groups[j];
        if (!g) {
          g = { src: a.src, file: a.name, plays: 0, stims: [] };
          groups.push(g);
        }
        g.stims.push({ syll: s + 1, key: keys[k] || 0, choice: 0 });
        k += 1;
      }

      return { n: i + 1, groups: groups, timeMs: 0 };
    });

    if (SHUFFLE) items = shuffle(items);
    items.forEach(function (it, i) { it.n = i + 1; });
    state.items = items;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ==========================================================================
     [7]  Rendering the test screen
     ========================================================================== */
  function currentItem() { return state.items[state.pos] || null; }

  function renderItem() {
    const item = currentItem();
    if (!item) return;

    els.qNum.textContent = String(state.pos + 1);
    els.qTotal.textContent = String(state.items.length);
    els.bar.style.width = ((state.pos + 1) / state.items.length * 100).toFixed(1) + "%";

    const multi = item.groups.length > 1;
    let hasAudio = false;

    els.players.innerHTML = "";
    els.syllables.innerHTML = "";
    state.playerUI = [];
    state.blockEls = [];

    if (!multi) {
      if (item.groups[0].src) hasAudio = true;
      els.players.appendChild(makePlayer(item.groups[0], false));
    }

    let flat = 0;

    item.groups.forEach(function (g, gi) {
      if (g.src) hasAudio = true;

      g.stims.forEach(function (stim) {
        const block = document.createElement("section");
        block.className = "syllable";

        const head = document.createElement("div");
        head.className = "syllable-head";

        const label = document.createElement("p");
        label.className = "syllable-label";
        label.textContent = "Syllable " + stim.syll;
        head.appendChild(label);

        if (multi) head.appendChild(makePlayer(g, true));
        block.appendChild(head);

        const opts = document.createElement("div");
        opts.className = "options";
        opts.setAttribute("role", "group");
        opts.setAttribute("aria-label", "Tone options for syllable " + stim.syll);

        TONES.forEach(function (t) { opts.appendChild(makeOption(t, flat)); });
        block.appendChild(opts);

        block.addEventListener("click", function () {
          if (state.active !== flat) { state.active = flat; paintBlocks(); updatePlayers(); }
        });

        els.syllables.appendChild(block);
        state.blockEls.push({ group: gi, stim: stim, el: block });
        flat += 1;
      });
    });

    const firstUnanswered = state.blockEls.findIndex(function (b) { return b.stim.choice < 1; });
    state.active = firstUnanswered >= 0 ? firstUnanswered : 0;

    paintBlocks();
    updatePlayers();
    updateNav();

    els.audioNote.textContent = hasAudio ? "" : "No audio file is attached to this item.";
    els.audioNote.hidden = hasAudio;
  }

  function makePlayer(g, compact) {
    const wrap = document.createElement("div");
    wrap.className = "player" + (compact ? " player--sm" : "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "play-btn";
    btn.setAttribute("aria-label", "Play the audio for this syllable");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const first = g.stims[0];
      const idx = state.blockEls.findIndex(function (b) { return b.stim === first; });
      if (idx >= 0) { state.active = idx; paintBlocks(); }
      playGroup(g);
    });

    const info = document.createElement("div");
    info.className = "player-info";

    const status = document.createElement("p");
    status.className = "player-status";

    const hint = document.createElement("p");
    hint.className = "player-hint";

    const count = document.createElement("span");
    count.className = "play-count";

    info.appendChild(status);
    info.appendChild(hint);
    info.appendChild(count);
    wrap.appendChild(btn);
    wrap.appendChild(info);

    state.playerUI.push({ g: g, btn: btn, status: status, hint: hint, count: count });
    return wrap;
  }

  function makeOption(t, flat) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    btn.dataset.tone = String(t.id);
    btn.setAttribute("aria-pressed", "false");

    const head = document.createElement("span");
    head.className = "option-head";

    const num = document.createElement("span");
    num.className = "option-num";
    num.textContent = String(t.id);

    const mark = document.createElement("span");
    mark.className = "option-mark";
    mark.innerHTML = '<svg viewBox="0 0 40 34" aria-hidden="true" focusable="false">' +
      '<path d="' + TONE_PATHS[t.id] + '" /></svg>';

    head.appendChild(num);
    head.appendChild(mark);

    const label = document.createElement("span");
    label.className = "option-name";
    label.textContent = t.name;

    btn.appendChild(head);
    btn.appendChild(label);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      choose(flat, t.id);
    });

    return btn;
  }

  function paintBlocks() {
    state.blockEls.forEach(function (b, i) {
      b.el.classList.toggle("is-active", i === state.active);
      b.el.classList.toggle("is-answered", b.stim.choice >= 1);
    });
  }

  function updateNav() {
    const item = currentItem();
    if (!item) return;

    els.prevBtn.disabled = state.pos === 0;

    const last = state.pos === state.items.length - 1;
    els.nextBtn.textContent = last ? "Finish & submit" : "Next \u2192";
    els.nextBtn.disabled = REQUIRE_ANSWER ? !allAnswered() : false;
  }

  function activeGroup() {
    const b = state.blockEls[state.active];
    const item = currentItem();
    if (!b || !item) return item ? item.groups[0] : null;
    return item.groups[b.group] || item.groups[0];
  }

  function updatePlayers() {
    const g = activeGroup();

    state.playerUI.forEach(function (ui) {
      const grp = ui.g;
      const left = Math.max(0, MAX_PLAYS - grp.plays);
      const playing = state.playingGroup === grp;

      ui.count.textContent = grp.plays + " / " + MAX_PLAYS;
      // While the sound is playing the button does nothing (a second click is
      // ignored), so disable it — otherwise it looks clickable and feels broken.
      ui.btn.disabled = left === 0 || !grp.src || playing;
      ui.btn.classList.toggle("is-playing", playing);

      if (playing) {
        ui.status.textContent = "Playing\u2026";
        ui.hint.textContent = "Listen carefully.";
      } else if (!grp.src) {
        ui.status.textContent = "No audio";
        ui.hint.textContent = "This item has no sound file attached.";
      } else if (left === 0) {
        ui.status.textContent = "No plays left";
        ui.hint.textContent = "You have used all " + MAX_PLAYS + " plays. Choose the tone you heard.";
      } else {
        ui.status.textContent = "Ready to play";
        ui.hint.textContent = left === MAX_PLAYS
          ? "You may play this sound " + MAX_PLAYS + " times in total."
          : "You may play this sound " + left + " more time" + (left === 1 ? "" : "s") + ".";
      }
    });

    if (els.playsPill && g) {
      const left = Math.max(0, MAX_PLAYS - g.plays);
      els.playsPill.textContent = left === 0
        ? "No plays left"
        : left + (left === 1 ? " play left" : " plays left");
      els.playsPill.classList.toggle("is-empty", left === 0);
    }
  }

  function allAnswered() {
    const item = currentItem();
    if (!item) return false;
    return item.groups.every(function (g) {
      return g.stims.every(function (s) { return s.choice >= 1; });
    });
  }

  /* ==========================================================================
     [8]  Interactions
     ========================================================================== */
  function choose(flat, toneId) {
    const item = currentItem();
    if (!item) return;

    const block = state.blockEls[flat];
    if (!block) return;

    block.stim.choice = toneId;

    Array.prototype.forEach.call(block.el.querySelectorAll(".option"), function (btn) {
      const on = Number(btn.dataset.tone) === toneId;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    const nextUnanswered = state.blockEls.findIndex(function (b) { return b.stim.choice < 1; });
    state.active = nextUnanswered >= 0 ? nextUnanswered : flat;

    paintBlocks();
    updatePlayers();
    updateNav();
  }

  function playGroup(g) {
    if (!g) return;
    if (!g.src) { toast("No audio file is attached to this item."); return; }
    if (g.plays >= MAX_PLAYS) { toast("You have already used all " + MAX_PLAYS + " plays for this sound."); return; }
    if (state.playingGroup === g) return;

    if (!state.audio) {
      state.audio = new Audio();
      state.audio.preload = "auto";
      state.audio.addEventListener("ended", onPlayEnd);
      state.audio.addEventListener("error", function () {
        onPlayEnd();
        toast("That audio file could not be loaded. Check the path or file name.");
      });
    }

    try { state.audio.pause(); } catch (err) { /* first play — nothing to pause */ }

    state.playingGroup = g;
    updatePlayers();

    state.audio.src = g.src;
    try { state.audio.currentTime = 0; } catch (err) { /* not seekable yet */ }

    const p = state.audio.play();
    if (p && typeof p.then === "function") {
      p.then(function () {
        g.plays += 1;
        updatePlayers();
        clearTimeout(state.playTimer);
        // Safety net: never leave the button locked if "ended" does not fire.
        state.playTimer = setTimeout(onPlayEnd, 30000);
      }).catch(function () {
        onPlayEnd();
        toast("Playback was blocked. Click the play button once more.");
      });
    } else {
      g.plays += 1;
      updatePlayers();
    }
  }

  function onPlayEnd() {
    clearTimeout(state.playTimer);
    state.playingGroup = null;
    updatePlayers();
  }

  function onNext() {
    const item = currentItem();
    if (!item) return;

    if (REQUIRE_ANSWER && !allAnswered()) {
      toast("Choose a tone for both syllables before moving on.");
      return;
    }

    if (state.pos === state.items.length - 1) {
      finish();
      return;
    }
    goTo(state.pos + 1);
  }

  function goTo(pos) {
    const item = currentItem();
    if (item) item.timeMs += performance.now() - state.qStart;

    state.pos = pos;
    state.qStart = performance.now();
    renderItem();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onKeydown(e) {
    if (state.phase !== "test") return;
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key >= "1" && e.key <= "4") {
      e.preventDefault();
      choose(state.active, Number(e.key));
    } else if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      playGroup(activeGroup());
    } else if (e.key === "Tab") {
      // Switch the keyboard target to the other syllable.
      e.preventDefault();
      if (!state.blockEls.length) return;
      state.active = (state.active + 1) % state.blockEls.length;
      paintBlocks();
      updatePlayers();
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      onNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (state.pos > 0) goTo(state.pos - 1);
    }
  }

  /* ==========================================================================
     [9]  Finish, scoring, CSV
     ========================================================================== */
  function finish() {
    const item = currentItem();
    if (item) item.timeMs += performance.now() - state.qStart;

    state.phase = "done";
    state.submitted = true;

    show("done");
    renderSummary();
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Save a copy right away — nothing is lost if the student walks away.
    downloadCsv();

    // Show the hand-off box and start the countdown immediately. Waiting for the
    // POST first means a slow (or unresponsive) Apps Script leaves the student
    // staring at a frozen screen with no way forward.
    if (NEXT_PAGE && els.nextBox) {
      els.nextBox.hidden = false;
      startAdvance();
    }

    postResults(buildPayload()).then(function (result) {
      state.postSettled = true;
      state.postOk = !!(result && result.ok);
      state.settledAt = Date.now();

      if (els.nextNowBtn) {
        els.nextNowBtn.disabled = false;
        els.nextNowBtn.textContent = "Start the " + nextLabel() + " now";
      }
    });
  }

  function nextLabel() {
    const match = NEXT_PAGE.match(/([a-z0-9_-]+)\.html/i);
    if (!match) return "next section";
    return match[1].toLowerCase() === "main" ? "Main Test" : match[1];
  }

  function startAdvance() {
    if (!NEXT_PAGE || state.advTimer) return;
    if (els.nextBox) els.nextBox.hidden = false;

    const started = Date.now();

    const tick = function () {
      const elapsed = Date.now() - started;
      const left = Math.max(0, Math.ceil((ADVANCE_MS - elapsed) / 1000));
      if (els.countdown) {
        els.countdown.textContent = left > 0
          ? left + " s"
          : (state.postSettled ? (state.postOk === false ? "error" : "now") : "sending\u2026");
      }

      // Success: leave as soon as the countdown ends.
      // Failure: wait until the red line has been readable for a few seconds.
      // Still sending: hard cap, so nobody is stuck on a dead server.
      let go;
      if (state.postSettled === false) {
        go = elapsed >= ADVANCE_MS + 24000;
      } else if (state.postOk) {
        go = elapsed >= ADVANCE_MS;
      } else {
        go = elapsed >= ADVANCE_MS && (Date.now() - state.settledAt) >= 4000;
      }

      if (go) {
        clearInterval(state.advTimer);
        state.advTimer = null;
        goNext();
      }
    };

    state.advTimer = setInterval(tick, 200);
    tick();
  }

  function goNext() {
    if (!NEXT_PAGE) return;
    clearInterval(state.advTimer);
    state.advTimer = null;

    const q = [];
    q.push("name=" + encodeURIComponent(state.student.name));
    q.push("major=" + encodeURIComponent(state.student.major));
    q.push("from=" + encodeURIComponent(TEST_TYPE));

    window.location.href = NEXT_PAGE + "?" + q.join("&");
  }

  function toneLabel(id) {
    const t = TONES.filter(function (x) { return x.id === id; })[0];
    return t ? "Tone " + t.id + " (" + t.name.toLowerCase() + ")" : "";
  }

  function collectRows() {
    const rows = [];

    state.items.forEach(function (item) {
      item.groups.forEach(function (g) {
        g.stims.forEach(function (st) {
          const answered = st.choice >= 1;
          const hasKey = st.key >= 1;
          const correct = answered && hasKey ? (st.choice === st.key ? 1 : 0) : "";

          let result;
          if (!answered) result = "No answer";
          else if (!hasKey) result = "Not scored";
          else result = st.choice === st.key ? "Correct" : "Incorrect";

          rows.push({
            question: item.n,
            syllable: st.syll,
            audioFile: g.file || "",
            response: answered ? st.choice : "",
            responseLabel: answered ? toneLabel(st.choice) : "",
            answerKey: hasKey ? st.key : "",
            answerKeyLabel: hasKey ? toneLabel(st.key) : "",
            correct: correct,
            result: result,
            playsUsed: g.plays,
            timeSeconds: st.syll === 1 ? (item.timeMs / 1000).toFixed(1) : ""
          });
        });
      });
    });

    return rows;
  }

  function score() {
    const rows = collectRows();
    const scored = rows.filter(function (r) { return r.correct !== ""; });
    const correct = scored.filter(function (r) { return r.correct === 1; });
    return {
      rows: rows,
      total: rows.length,
      scoredTotal: scored.length,
      correctCount: correct.length,
      percent: scored.length ? Math.round(correct.length / scored.length * 100) : null,
      answered: rows.filter(function (r) { return r.response !== ""; }).length
    };
  }

  function renderSummary() {
    const s = score();
    els.doneName.textContent = state.student.name;

    if (s.percent === null) {
      els.scoreValue.textContent = "\u2014";
      els.scoreDen.textContent = "";
      els.scoreSub.textContent = "No answer key was available, so this session was recorded but not scored. " +
        "(" + s.answered + " of " + s.total + " syllables answered.)";
    } else {
      els.scoreValue.textContent = String(s.correctCount);
      els.scoreDen.textContent = "/ " + s.scoredTotal;
      els.scoreSub.textContent = s.percent + "% correct  \u00B7  " + s.scoredTotal + " of " + s.total +
        " syllables scored  \u00B7  " + state.student.major;
    }

    els.summaryBody.innerHTML = "";
    s.rows.forEach(function (r) {
      const tr = document.createElement("tr");

      const cells = [
        { text: r.question + "." + r.syllable, cls: "num" },
        { text: r.audioFile || "\u2014" },
        { text: r.response === "" ? "\u2014" : String(r.response) + " \u00B7 " + toneShort(r.response), cls: "num" },
        { text: r.answerKey === "" ? "\u2014" : String(r.answerKey), cls: "num" },
        { text: String(r.playsUsed), cls: "num" },
        { text: r.result, tag: r.result }
      ];

      cells.forEach(function (c) {
        const td = document.createElement("td");
        if (c.cls) td.className = c.cls;
        if (c.tag) {
          const span = document.createElement("span");
          span.className = "tag " + (c.tag === "Correct" ? "tag-correct" : c.tag === "Incorrect" ? "tag-wrong" : "tag-neutral");
          span.textContent = c.tag;
          td.appendChild(span);
        } else {
          td.textContent = c.text;
        }
        tr.appendChild(td);
      });

      els.summaryBody.appendChild(tr);
    });
  }

  function toneShort(id) {
    const t = TONES.filter(function (x) { return x.id === id; })[0];
    return t ? t.name.toLowerCase() : "";
  }

  function csvCell(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function stamp(d) {
    const p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function buildCsv() {
    const s = score();
    const now = new Date();
    const ts = stamp(now);

    const header = [
      "Timestamp", "Test Type", "Student Name", "Major", "Question", "Syllable", "Audio File",
      "Response", "Response Label", "Answer Key", "Answer Key Label",
      "Correct (1/0)", "Result", "Plays Used", "Time on Item (s)"
    ];

    const rows = [header];
    s.rows.forEach(function (r) {
      rows.push([
        ts, TEST_TYPE, state.student.name, state.student.major, r.question, r.syllable, r.audioFile,
        r.response, r.responseLabel, r.answerKey, r.answerKeyLabel,
        r.correct, r.result, r.playsUsed, r.timeSeconds
      ]);
    });

    rows.push([
      ts, TEST_TYPE, state.student.name, state.student.major, "TOTAL", "", "",
      s.answered, "", "", "",
      s.correctCount, s.percent === null ? "Not scored" : s.percent + "%", "", ""
    ]);

    return "\uFEFF" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  function csvFileName() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? "0" : "") + n; };
    const slug = (state.student.name || "student")
      .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "student";
    return "tone-test_" + TEST_TYPE + "_" + slug + "_" +
      d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) +
      ".csv";
  }

  function downloadCsv() {
    if (!state.submitted) return;
    try {
      const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = csvFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast("CSV saved: " + a.download);
    } catch (err) {
      toast("The browser blocked the CSV download. Use \u201cDownload CSV again\u201d.");
    }
  }

  /* ==========================================================================
     [10]  POST to Google Apps Script
     ========================================================================== */
  function buildPayload() {
    const s = score();
    return {
      testType: TEST_TYPE,
      testLabel: TYPE_LABEL,
      studentName: state.student.name,
      major: state.student.major,
      submittedAt: new Date().toISOString(),
      maxPlays: MAX_PLAYS,
      totalItems: s.total,
      scoredItems: s.scoredTotal,
      correctCount: s.correctCount,
      scorePercent: s.percent,
      subId: newSubId(),
      responses: s.rows
    };
  }

  // One id per submission, reused by the background retry so the server can
  // drop the second copy instead of writing every row twice.
  let pendingSubId = "";
  function newSubId() {
    if (pendingSubId) return pendingSubId;
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) pendingSubId = crypto.randomUUID();
    } catch (err) { pendingSubId = ""; }
    if (!pendingSubId) pendingSubId = "s" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    return pendingSubId;
  }

  function setPostStatus(kind, text) {
    if (!els.postStatus) return;
    els.postStatus.textContent = text;
    els.postStatus.className = "post-status" + (kind === "ok" ? " is-ok" : kind === "err" ? " is-err" : "");
  }

  function postResults(payload) {
    if (!ENDPOINT) {
      setPostStatus("idle", "No server endpoint configured yet (add window.TONE_TEST_ENDPOINT = \"\u2026/exec\" to assets/config.js) \u2014 the CSV above already holds this result.");
      return Promise.resolve({ ok: false, skipped: true });
    }

    setPostStatus("pending", "Sending results to the server\u2026");

    // text/plain keeps this a "simple request", so Google Apps Script answers
    // without a CORS preflight. The body is still plain JSON.
    // keepalive lets the request finish even if the page navigates to the next
    // test — without it, Pilot's upload dies the moment Main opens.
    const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;

    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) {
        return res.text().then(function (text) {
          const raw = String(text || "");
          const head = raw.trim().charAt(0);

          // A web app answers a POST with a redirect. If the deployment is not
          // shared with "Anyone" (or this browser is signed in with a different
          // Google account than the sheet owner), that redirect lands on a
          // sign-in page: HTTP 200, HTML. Treating that as success silently
          // loses the whole run, so fail loudly instead.
          if (head === "<") {
            throw new Error("Google returned a sign-in / error page instead of a result. " +
              "Most likely the deployment is not shared with \"Anyone\", or this browser " +
              "is signed in with a Google account different from the sheet owner.");
          }

          let data = null;
          try { data = JSON.parse(raw); } catch (err) { data = null; }

          if (!data) {
            throw new Error("Unexpected reply from the server: " +
              raw.replace(/\s+/g, " ").trim().slice(0, 120));
          }
          if (data.ok === false) {
            throw new Error(data.error || data.message || ("HTTP " + res.status));
          }

          const written = data.duplicate
            ? "already stored, not written twice"
            : (data.rows !== undefined ? data.rows + " row(s) written" : "ok");
          const where = data.spreadsheet ? " \u2192 " + data.spreadsheet : "";
          setPostStatus("ok", "Results sent to the server (" + written + where + ").");
          return { ok: true };
        });
      })
      .catch(function (err) {
        let msg = (err && err.name === "AbortError")
          ? "no reply within 25 seconds"
          : (err && err.message ? err.message : String(err));

        // "Failed to fetch" is what a blocked / redirected reply looks like
        // from the page: it hides the real reason, so spell out the usual ones.
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          msg += " (the browser blocked the reply — check that the /exec URL is exact " +
            "and that the deployment is shared with \"Anyone\")";
        }
        setPostStatus("err", "Could not send to the server: " + msg + " [" + endpointHost() + " \u00b7 " + BUILD + "]" +
          " \u2014 the CSV above is complete, so this run is not lost. " +
          "If it keeps failing, open the /exec?diag=1 URL in a browser.");

        // Carry the warning to the next page: the student may already have
        // moved on before anyone read this line.
        try {
          sessionStorage.setItem("tpUploadFailed", JSON.stringify({ test: TEST_TYPE, message: msg, at: new Date().toISOString() }));
        } catch (e) { /* storage disabled — the CSV is still on disk */ }

        // Best-effort insurance: fire the same payload again in the background.
        // The payload carries a subId, so the script drops the second copy.
        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(payload)], { type: "text/plain;charset=utf-8" }));
          }
        } catch (e) { /* ignore */ }

        return { ok: false, error: String(err) };
      })
      .then(function (result) {
        if (timer) clearTimeout(timer);
        return result;
      });
  }

  /* ==========================================================================
     [11]  Helpers
     ========================================================================== */
  function show(which) {
    Object.keys(els.screens).forEach(function (k) {
      if (els.screens[k]) els.screens[k].hidden = (k !== which);
    });
  }

  let toastTimer = null;
  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("is-visible"); }, 3200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
