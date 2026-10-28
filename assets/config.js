/* ============================================================================
   Mandarin Tone Perception Test — CONFIGURATION
   ----------------------------------------------------------------------------
   Everything you normally need to change lives in this one file.

   HOW TO FILL IN AN ITEM
       { audio: "audio/p1.mp3", answer: 2 }

       audio   Path to the sound file, relative to the HTML file
               (e.g. "audio/p1.mp3"), or a full https:// URL.
               Leave "" if you prefer to load the files at run time from the
               "Setup (teacher only)" panel on the start screen
               (multi-select files, or pick a whole folder — items are filled
               in the order the filenames sort: 1, 2, 3 ... 10, 11).

       answer  1 / 2 / 3 / 4  = the correct tone.
               0  = answer key not entered yet. The item still runs and the
                    response is still recorded, but it is reported as
                    "Not scored" instead of correct / incorrect.

   HOW MANY ITEMS
       Add or delete lines freely. The number of items is whatever is in the
       list — the page adapts automatically. pilot and main are independent,
       so the pilot can be short (5) while the main test is long (20+).
   ========================================================================== */

const SETTINGS = {
  /* How many times a single item may be replayed. */
  maxPlays: 2,

  /* true  = present the items in a random order each session
     false = present them in the order written below */
  shuffleItems: false,

  /* true  = the Next button stays locked until a tone is chosen */
  requireAnswerBeforeNext: true
};


const AUDIO_CONFIG = {

  /* --------------------------------------------------------------------
     PILOT TEST  (预测试)
     -------------------------------------------------------------------- */
  pilot: [
    { audio: "", answer: 0 },   // Q1
    { audio: "", answer: 0 },   // Q2
    { audio: "", answer: 0 },   // Q3
    { audio: "", answer: 0 },   // Q4
    { audio: "", answer: 0 }    // Q5
  ],

  /* --------------------------------------------------------------------
     MAIN TEST  (正式测试)
     -------------------------------------------------------------------- */
  main: [
    { audio: "", answer: 0 },   // Q1
    { audio: "", answer: 0 },   // Q2
    { audio: "", answer: 0 },   // Q3
    { audio: "", answer: 0 },   // Q4
    { audio: "", answer: 0 },   // Q5
    { audio: "", answer: 0 },   // Q6
    { audio: "", answer: 0 },   // Q7
    { audio: "", answer: 0 },   // Q8
    { audio: "", answer: 0 },   // Q9
    { audio: "", answer: 0 }    // Q10
  ]
};
