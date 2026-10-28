/* ============================================================================
   Mandarin Tone Perception Test — application logic
   Shared by pilot.html and main.html. The page type comes from
   <body data-test-type="pilot|main">.
   ========================================================================== */

(function () {
  "use strict";

  /* ==========================================================================
     [1]  GOOGLE APPS SCRIPT ENDPOINT   <-- THE PLACE YOU PASTE YOUR URL
     --------------------------------------------------------------------------
     Paste the Web App URL of your Apps Script between the quotes, e.g.

         const ENDPOINT = "https://script.google.com/macros/s/AKfycbzEnGUaZqxQP-zJGYppXOWB8vFpe3ltPvW9LSM6cEX4OS7p8TP2xlt7deLSNHz2XstvzA/exec";

     Leave it as "" and the page simply skips the network call — the CSV
     download keeps working, so nothing breaks before you are ready.
     See apps-script-sample.gs in this folder for the matching server code.
     ========================================================================== */
  const ENDPOINT = "";

  /* ==========================================================================
     [2]  Test definition (read from assets/config.js)
     ========================================================================== */
  const TEST_TYPE = (document.body.getAttribute("data-test-type") || "main").toLowerCase();
  const IS_PILOT = TEST_TYPE === "pilot";
  const TYPE_LABEL = IS_PILOT ? "Pilot Test" : "Main Test";

  const TONES = [
    { id: 1, mark: "\u02C9", name: "High level", sample: "m\u0101" },
    { id: 2, mark: "\u02CA", name: "Rising",     sample: "m\u00E1" },
    { id: 3, mark: "\u02C7", name: "Dipping",    sample: "m\u01CE" },
    { id: 4, mark: "\u02CB", name: "Falling",    sample: "m\u00E0" }
  ];

  const CFG_ITEMS = (typeof AUDIO_CONFIG !== "undefined" && Array.isArray(AUDIO_CONFIG[TEST_TYPE]))
    ? AUDIO_CONFIG[TEST_TYPE].filter(function (x) { return x && typeof x === "object"; })
    : [];

  const MAX_PLAYS = (typeof SETTINGS !== "undefined" && Number(SETTINGS.maxPlays) > 0)
    ? Math.floor(Number(SETTINGS.maxPlays)) : 2;

  const REQUIRE_ANSWER = !(typeof SETTINGS !== "undefined" && SETTINGS.requireAnswerBeforeNext === false);
  const SHUFFLE = !!(typeof SETTINGS !== "undefined" && SETTINGS.shuffleItems);

  const KEY_STORAGE = "ttp.answerKey." + TEST_TYPE;

  /* ==========================================================================
     [3]  State
     ========================================================================== */
  const state = {
    phase: "start",          // start | test | done
    student: { name: "", major: "" },
    items: [],
    pos: 0,
    uploads: [],             // [{ name, src }]  loaded at run time
    keyOverride: null,       // array of 0..4, or null
    qStart: 0,
    playing: false,
    playTimer: null,
    audio: null,
    submitted: false,
    csvSaved: false
  };

  const $ = function (id) { return document.getElementById(id); };
  const els = {};

  /* ==========================================================================
     [4]  Boot
     ========================================================================== */
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
    els.playBtn = $("playBtn");
    els.playStatus = $("playStatus");
    els.playHint = $("playHint");
    els.playCount = $("playCount");
    els.options = $("options");
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
    els.clearKey = $("clearKey");

    els.doneName = $("doneName");
    els.scoreValue = $("scoreValue");
    els.scoreDen = $("scoreDen");
    els.scoreSub = $("scoreSub");
    els.summaryBody = $("summaryBody");
    els.downloadBtn = $("downloadBtn");
    els.restartBtn = $("restartBtn");
    els.postStatus = $("postStatus");
    els.toast = $("toast");

    // Load a previously saved answer key for this test type.
    try {
      const saved = localStorage.getItem(KEY_STORAGE);
      if (saved) {
        const parsed = parseKeyList(saved);
        if (parsed.length === CFG_ITEMS.length) state.keyOverride = parsed;
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

    els.playBtn.addEventListener("click", play);
    els.prevBtn.addEventListener("click", function () { if (state.pos > 0) goTo(state.pos - 1); });
    els.nextBtn.addEventListener("click", onNext);

    els.audioFiles.addEventListener("change", function () { onFilesPicked(this.files); });
    els.audioFolder.addEventListener("change", function () { onFilesPicked(this.files); });
    els.applyKey.addEventListener("click", onApplyKey);
    els.clearKey.addEventListener("click", onClearKey);

    els.downloadBtn.addEventListener("click", function () { downloadCsv(); });
    els.restartBtn.addEventListener("click", restart);

    document.addEventListener("keydown", onKeydown);

    window.addEventListener("beforeunload", function (e) {
      if (state.phase === "test") {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    });
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

    // Revoke the previous batch so we do not leak blob URLs.
    state.uploads.forEach(function (u) { if (u.src.indexOf("blob:") === 0) URL.revokeObjectURL(u.src); });
    state.uploads = picked.map(function (f) {
      return { name: f.name, src: URL.createObjectURL(f) };
    });

    refreshAudioStatus();
    refreshWarning();
  }

  function onAnswerKeyText(text) {
    return parseKeyList(text);
  }

  function parseKeyList(text) {
    return String(text || "")
      .split(/[\s,;]+/)
      .filter(function (s) { return s !== ""; })
      .map(function (s) {
        const n = parseInt(s, 10);
        return (n >= 1 && n <= 4) ? n : 0;
      });
  }

  function syncKeyInput() {
    if (state.keyOverride) {
      els.keyInput.value = state.keyOverride.join(",");
      els.keyStatus.textContent = "Using the key saved on this device (" + state.keyOverride.length + " items).";
      els.keyStatus.className = "status-line is-ok";
      return;
    }
    els.keyInput.value = CFG_ITEMS.map(function (it) {
      const a = Number(it.answer);
      return (a >= 1 && a <= 4) ? a : 0;
    }).join(",");
    els.keyStatus.textContent = "Loaded from assets/config.js.";
    els.keyStatus.className = "status-line";
  }

  function onApplyKey() {
    const parsed = onAnswerKeyText(els.keyInput.value);

    if (parsed.length !== CFG_ITEMS.length) {
      toast("Expected " + CFG_ITEMS.length + " values, got " + parsed.length + ". Nothing was applied.");
      return;
    }
    const known = parsed.filter(function (n) { return n >= 1; }).length;
    if (known === 0) {
      toast("That key has no valid 1–4 values.");
      return;
    }

    state.keyOverride = parsed;
    try { localStorage.setItem(KEY_STORAGE, parsed.join(",")); } catch (err) { /* ignore */ }
    syncKeyInput();
    refreshWarning();
    toast("Answer key applied: " + known + " of " + parsed.length + " items scored.");
  }

  function onClearKey() {
    state.keyOverride = null;
    try { localStorage.removeItem(KEY_STORAGE); } catch (err) { /* ignore */ }
    syncKeyInput();
    refreshWarning();
    toast("Saved key cleared — config.js is used again.");
  }

  function refreshAudioStatus() {
    if (!els.audioStatus) return;
    const total = CFG_ITEMS.length;
    if (!state.uploads.length) {
      const fromCfg = CFG_ITEMS.filter(function (it) { return it.audio && String(it.audio).trim(); }).length;
      els.audioStatus.textContent = fromCfg
        ? fromCfg + " of " + total + " item(s) have an audio path in config.js; no files loaded in this session."
        : "No files loaded in this session and no audio path in config.js yet.";
      els.audioStatus.className = "status-line";
      return;
    }
    let msg = state.uploads.length + " audio file(s) loaded: " + state.uploads.slice(0, 3).map(function (u) { return u.name; }).join(", ");
    if (state.uploads.length > 3) msg += " …";
    if (state.uploads.length < total) {
      msg += " — that is fewer than the " + total + " item(s) configured.";
      els.audioStatus.className = "status-line is-warn";
    } else {
      els.audioStatus.className = "status-line is-ok";
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
      const withAudio = resolveSources().filter(function (s) { return !!s.src; }).length;
      if (withAudio === 0) {
        problems.push("No audio is attached yet, so the " + TYPE_LABEL + " will run silently. Open " +
          "\u201cSetup (teacher only)\u201d below to load files, or add paths in assets/config.js.");
      } else if (withAudio < CFG_ITEMS.length) {
        problems.push(withAudio + " of " + CFG_ITEMS.length + " items have audio; the rest will be silent.");
      }

      const keyed = resolveKeys().filter(function (k) { return k >= 1; }).length;
      if (keyed === 0) {
        problems.push("No answer key is set, so responses will be recorded but not scored. " +
          "Add answers in config.js or apply a key below.");
      } else if (keyed < CFG_ITEMS.length) {
        problems.push(keyed + " of " + CFG_ITEMS.length + " items have an answer key; the rest will be marked \u201cNot scored\u201d.");
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

  function resolveSources() {
    return CFG_ITEMS.map(function (it, i) {
      const cfgPath = (it.audio && String(it.audio).trim()) || "";
      if (cfgPath) return { src: cfgPath, name: cfgPath.split(/[\\/]/).pop() };
      if (state.uploads[i]) return { src: state.uploads[i].src, name: state.uploads[i].name };
      return { src: "", name: "" };
    });
  }

  function resolveKeys() {
    return CFG_ITEMS.map(function (it, i) {
      if (state.keyOverride && state.keyOverride.length === CFG_ITEMS.length) {
        const v = state.keyOverride[i];
        return (v >= 1 && v <= 4) ? v : 0;
      }
      const a = Number(it.answer);
      return (a >= 1 && a <= 4) ? a : 0;
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

    buildItems();
    state.student = { name: name, major: major };
    state.pos = 0;
    state.phase = "test";
    state.qStart = performance.now();

    els.whoMeta.textContent = name + "  \u00B7  " + major + "  \u00B7  " + TYPE_LABEL;
    show("test");
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildItems() {
    const sources = resolveSources();
    const keys = resolveKeys();

    let items = sources.map(function (s, i) {
      return {
        n: i + 1,
        src: s.src,
        file: s.name,
        key: keys[i],
        choice: 0,
        plays: 0,
        timeMs: 0
      };
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

  function renderQuestion() {
    const item = currentItem();
    if (!item) return;

    els.qNum.textContent = String(state.pos + 1);
    els.qTotal.textContent = String(state.items.length);
    els.bar.style.width = ((state.pos + 1) / state.items.length * 100).toFixed(1) + "%";

    renderOptions();
    updatePlayUI();

    els.prevBtn.disabled = state.pos === 0;

    const last = state.pos === state.items.length - 1;
    els.nextBtn.textContent = last ? "Finish & submit" : "Next \u2192";
    els.nextBtn.disabled = REQUIRE_ANSWER && !item.choice;

    els.audioNote.textContent = item.src ? "" : "No audio file is attached to this item.";
    els.audioNote.hidden = !!item.src;
  }

  function renderOptions() {
    const item = currentItem();
    els.options.innerHTML = "";
    TONES.forEach(function (t) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option" + (item.choice === t.id ? " is-selected" : "");
      btn.setAttribute("aria-pressed", item.choice === t.id ? "true" : "false");
      btn.dataset.tone = String(t.id);

      const num = document.createElement("span");
      num.className = "option-num";
      num.textContent = String(t.id);

      const mark = document.createElement("span");
      mark.className = "option-mark";
      mark.textContent = t.mark;

      const head = document.createElement("span");
      head.className = "option-head";
      head.appendChild(num);
      head.appendChild(mark);

      const label = document.createElement("span");
      label.className = "option-name";
      label.textContent = t.name;

      const sample = document.createElement("span");
      sample.className = "option-sample";
      sample.textContent = t.sample;

      btn.appendChild(head);
      btn.appendChild(label);
      btn.appendChild(sample);

      btn.addEventListener("click", function () { choose(t.id); });
      els.options.appendChild(btn);
    });
  }

  function updatePlayUI() {
    const item = currentItem();
    if (!item) return;

    const left = Math.max(0, MAX_PLAYS - item.plays);

    els.playCount.textContent = item.plays + " / " + MAX_PLAYS;
    els.playsPill.textContent = left === 0
      ? "No plays left"
      : left + (left === 1 ? " play left" : " plays left");
    els.playsPill.classList.toggle("is-empty", left === 0);

    els.playBtn.disabled = state.playing || left === 0 || !item.src;
    els.playBtn.classList.toggle("is-playing", state.playing);

    if (state.playing) {
      els.playStatus.textContent = "Playing\u2026";
      els.playHint.textContent = "Listen carefully.";
    } else if (!item.src) {
      els.playStatus.textContent = "No audio";
      els.playHint.textContent = "This item has no sound file attached.";
    } else if (left === 0) {
      els.playStatus.textContent = "No plays left";
      els.playHint.textContent = "You have used all " + MAX_PLAYS + " plays for this item. Choose the tone you heard.";
    } else {
      els.playStatus.textContent = "Ready to play";
      els.playHint.textContent = left === MAX_PLAYS
        ? "You may play this item " + MAX_PLAYS + " times in total."
        : "You may play this item " + left + " more time" + (left === 1 ? "" : "s") + ".";
    }
  }

  /* ==========================================================================
     [8]  Interactions
     ========================================================================== */
  function choose(toneId) {
    const item = currentItem();
    if (!item) return;

    item.choice = toneId;

    Array.prototype.forEach.call(els.options.children, function (btn) {
      const on = Number(btn.dataset.tone) === toneId;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    els.nextBtn.disabled = false;
  }

  function play() {
    const item = currentItem();
    if (!item || state.playing) return;

    if (!item.src) { toast("No audio file is attached to this item."); return; }
    if (item.plays >= MAX_PLAYS) { toast("You have already used all " + MAX_PLAYS + " plays for this item."); return; }

    if (!state.audio) {
      state.audio = new Audio();
      state.audio.preload = "auto";
      state.audio.addEventListener("ended", function () {
        clearTimeout(state.playTimer);
        state.playing = false;
        updatePlayUI();
      });
      state.audio.addEventListener("error", function () {
        clearTimeout(state.playTimer);
        state.playing = false;
        updatePlayUI();
        toast("That audio file could not be loaded. Check the path or file name.");
      });
    }

    try { state.audio.pause(); } catch (err) { /* first play — nothing to pause */ }

    state.playing = true;
    updatePlayUI();

    state.audio.src = item.src;
    try { state.audio.currentTime = 0; } catch (err) { /* not seekable yet */ }

    const p = state.audio.play();
    if (p && typeof p.then === "function") {
      p.then(function () {
        item.plays += 1;
        updatePlayUI();
        // Safety net: never leave the button locked if "ended" does not fire.
        clearTimeout(state.playTimer);
        state.playTimer = setTimeout(function () {
          state.playing = false;
          updatePlayUI();
        }, 30000);
      }).catch(function () {
        clearTimeout(state.playTimer);
        state.playing = false;
        updatePlayUI();
        toast("Playback was blocked. Click the play button once more.");
      });
    } else {
      item.plays += 1;
      updatePlayUI();
    }
  }

  function onNext() {
    const item = currentItem();
    if (!item) return;

    if (REQUIRE_ANSWER && !item.choice) {
      toast("Choose one of the four tones before moving on.");
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
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onKeydown(e) {
    if (state.phase !== "test") return;
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key >= "1" && e.key <= "4") {
      e.preventDefault();
      choose(Number(e.key));
    } else if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      play();
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

    postResults(buildPayload());
  }

  function toneLabel(id) {
    const t = TONES.filter(function (x) { return x.id === id; })[0];
    // The sample syllable carries the tone diacritic, which survives small
    // type and spreadsheet fonts far better than a bare modifier letter.
    return t ? "Tone " + t.id + " (" + t.sample + ")" : "";
  }

  function toneSample(id) {
    const t = TONES.filter(function (x) { return x.id === id; })[0];
    return t ? t.sample : "";
  }

  function collectRows() {
    return state.items.map(function (item) {
      const answered = item.choice >= 1;
      const hasKey = item.key >= 1;
      const correct = answered && hasKey ? (item.choice === item.key ? 1 : 0) : "";

      let result;
      if (!answered) result = "No answer";
      else if (!hasKey) result = "Not scored";
      else result = item.choice === item.key ? "Correct" : "Incorrect";

      return {
        question: item.n,
        audioFile: item.file || "",
        response: answered ? item.choice : "",
        responseLabel: answered ? toneLabel(item.choice) : "",
        answerKey: hasKey ? item.key : "",
        answerKeyLabel: hasKey ? toneLabel(item.key) : "",
        correct: correct,
        result: result,
        playsUsed: item.plays,
        timeSeconds: (item.timeMs / 1000).toFixed(1)
      };
    });
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
        "(" + s.answered + " of " + s.total + " items answered.)";
    } else {
      els.scoreValue.textContent = String(s.correctCount);
      els.scoreDen.textContent = "/ " + s.scoredTotal;
      els.scoreSub.textContent = s.percent + "% correct  \u00B7  " + s.scoredTotal + " of " + s.total +
        " items scored  \u00B7  " + state.student.major;
    }

    els.summaryBody.innerHTML = "";
    s.rows.forEach(function (r) {
      const tr = document.createElement("tr");

      const cells = [
        { text: String(r.question), cls: "num" },
        { text: r.audioFile || "\u2014" },
        { text: r.response === "" ? "\u2014" : String(r.response) + " \u00B7 " + toneSample(r.response), cls: "num" },
        { text: r.answerKey === "" ? "\u2014" : String(r.answerKey), cls: "num" },
        { text: String(r.playsUsed), cls: "num" },
        { text: r.result, cls: "", tag: r.result }
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
      "Timestamp", "Test Type", "Student Name", "Major", "Question", "Audio File",
      "Response", "Response Label", "Answer Key", "Answer Key Label",
      "Correct (1/0)", "Result", "Plays Used", "Time on Item (s)"
    ];

    const rows = [header];
    s.rows.forEach(function (r) {
      rows.push([
        ts, TEST_TYPE, state.student.name, state.student.major, r.question, r.audioFile,
        r.response, r.responseLabel, r.answerKey, r.answerKeyLabel,
        r.correct, r.result, r.playsUsed, r.timeSeconds
      ]);
    });

    // One trailing summary row keeps the file readable for a human,
    // while the per-item rows above stay clean for analysis.
    rows.push([
      ts, TEST_TYPE, state.student.name, state.student.major, "TOTAL", "",
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
      state.csvSaved = true;
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
      responses: s.rows
    };
  }

  function setPostStatus(kind, text) {
    if (!els.postStatus) return;
    els.postStatus.textContent = text;
    els.postStatus.className = "post-status" + (kind === "ok" ? " is-ok" : kind === "err" ? " is-err" : "");
  }

  function postResults(payload) {
    if (!ENDPOINT) {
      setPostStatus("idle", "No server endpoint configured yet (ENDPOINT is empty in assets/app.js) \u2014 the CSV above already holds this result.");
      return Promise.resolve({ ok: false, skipped: true });
    }

    setPostStatus("pending", "Sending results to the server\u2026");

    // text/plain keeps this a "simple request", so Google Apps Script answers
    // without a CORS preflight. The body is still plain JSON.
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    })
      .then(function (res) {
        return res.text().then(function (text) {
          let ok = res.ok;
          let detail = text;
          try {
            const json = JSON.parse(text);
            if (json && json.ok === false) ok = false;
            if (json && json.rows !== undefined) detail = json.rows + " row(s) written";
            else if (json && json.message) detail = json.message;
          } catch (err) { /* not JSON — keep the raw text */ }

          if (!ok) throw new Error(detail || ("HTTP " + res.status));
          setPostStatus("ok", "Results sent to the server (" + detail + ").");
          return { ok: true };
        });
      })
      .catch(function (err) {
        setPostStatus("err", "Could not reach the server: " + (err && err.message ? err.message : err) +
          " \u2014 the CSV above is still complete, so nothing is lost.");
        return { ok: false, error: String(err) };
      });
  }

  /* ==========================================================================
     [11]  Helpers
     ========================================================================== */
  function show(which) {
    Object.keys(els.screens).forEach(function (k) {
      els.screens[k].hidden = (k !== which);
    });
  }

  function restart() {
    if (!confirm("Start a new student? The current responses stay in the CSV you already downloaded.")) return;
    window.location.reload();
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
