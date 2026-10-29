/* ============================================================================
   Mandarin Tone Perception Test — CONFIGURATION
   ----------------------------------------------------------------------------
   Everything you normally need to change lives in this one file.
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
     PILOT TEST  (预测试: 8题) — 每题两个音节，answer: [a, b] 分别是两音节的声调
     -------------------------------------------------------------------- */
  pilot: [
    { audio: "audio/Perception_Pilot%20(1).mp3", answer: [3, 4] },   
    { audio: "audio/Perception_Pilot%20(2).mp3", answer: [4, 2] },
    { audio: "audio/Perception_Pilot%20(3).mp3", answer: [2, 4] },
    { audio: "audio/Perception_Pilot%20(4).mp3", answer: [1, 2] },
    { audio: "audio/Perception_Pilot%20(5).mp3", answer: [1, 3] },
    { audio: "audio/Perception_Pilot%20(6).mp3", answer: [4, 1] },
    { audio: "audio/Perception_Pilot%20(7).mp3", answer: [2, 3] },
    { audio: "audio/Perception_Pilot%20(8).mp3", answer: [3, 1] }
  ],

  /* --------------------------------------------------------------------
     MAIN TEST  (正式测试: 40题)
     -------------------------------------------------------------------- */
  main: [
    { audio: "audio/Perception_Pre%20(1).mp3", answer: [4, 2] },
    { audio: "audio/Perception_Pre%20(2).mp3", answer: [2, 1] },
    { audio: "audio/Perception_Pre%20(3).mp3", answer: [3, 3] },
    { audio: "audio/Perception_Pre%20(4).mp3", answer: [4, 3] },
    { audio: "audio/Perception_Pre%20(5).mp3", answer: [4, 3] },
    { audio: "audio/Perception_Pre%20(6).mp3", answer: [3, 4] },
    { audio: "audio/Perception_Pre%20(7).mp3", answer: [3, 2] },
    { audio: "audio/Perception_Pre%20(8).mp3", answer: [2, 2] },
    { audio: "audio/Perception_Pre%20(9).mp3", answer: [3, 3] },
    { audio: "audio/Perception_Pre%20(10).mp3", answer: [1, 3] },
    { audio: "audio/Perception_Pre%20(11).mp3", answer: [3, 4] },
    { audio: "audio/Perception_Pre%20(12).mp3", answer: [4, 4] },
    { audio: "audio/Perception_Pre%20(13).mp3", answer: [1, 2] },
    { audio: "audio/Perception_Pre%20(14).mp3", answer: [3, 1] },
    { audio: "audio/Perception_Pre%20(15).mp3", answer: [3, 3] },
    { audio: "audio/Perception_Pre%20(16).mp3", answer: [2, 3] },
    { audio: "audio/Perception_Pre%20(17).mp3", answer: [1, 2] },
    { audio: "audio/Perception_Pre%20(18).mp3", answer: [1, 2] },
    { audio: "audio/Perception_Pre%20(19).mp3", answer: [2, 2] },
    { audio: "audio/Perception_Pre%20(20).mp3", answer: [2, 4] },
    { audio: "audio/Perception_Pre%20(21).mp3", answer: [2, 4] },
    { audio: "audio/Perception_Pre%20(22).mp3", answer: [4, 3] },
    { audio: "audio/Perception_Pre%20(23).mp3", answer: [1, 4] },
    { audio: "audio/Perception_Pre%20(24).mp3", answer: [1, 1] },
    { audio: "audio/Perception_Pre%20(25).mp3", answer: [2, 2] },
    { audio: "audio/Perception_Pre%20(26).mp3", answer: [4, 4] },
    { audio: "audio/Perception_Pre%20(27).mp3", answer: [1, 1] },
    { audio: "audio/Perception_Pre%20(28).mp3", answer: [4, 1] },
    { audio: "audio/Perception_Pre%20(29).mp3", answer: [1, 3] },
    { audio: "audio/Perception_Pre%20(30).mp3", answer: [4, 4] },
    { audio: "audio/Perception_Pre%20(31).mp3", answer: [2, 1] },
    { audio: "audio/Perception_Pre%20(32).mp3", answer: [1, 4] },
    { audio: "audio/Perception_Pre%20(33).mp3", answer: [1, 1] },
    { audio: "audio/Perception_Pre%20(34).mp3", answer: [4, 1] },
    { audio: "audio/Perception_Pre%20(35).mp3", answer: [2, 3] },
    { audio: "audio/Perception_Pre%20(36).mp3", answer: [3, 1] },
    { audio: "audio/Perception_Pre%20(37).mp3", answer: [3, 2] },
    { audio: "audio/Perception_Pre%20(38).mp3", answer: [4, 2] },
    { audio: "audio/Perception_Pre%20(39).mp3", answer: [3, 4] },
    { audio: "audio/Perception_Pre%20(40).mp3", answer: [2, 1] }
  ]
};