// ==== Tone Test collector · v3 (2026-10-28) · 贴完记得 Ctrl+S，然后运行 authorize ====
/**
 * ============================================================================
 * Google Apps Script collector — field names match the JSON payload exactly
 * (camelCase, case-sensitive), so nothing has to be renamed anywhere.
 * ----------------------------------------------------------------------------
 * SETUP
 *  1. Open your Google Sheet. Extensions > Apps Script. Paste this file. Save.
 *  2. In the toolbar, select the function "authorize" and click Run ONCE.
 *     Google asks for permission — review it and allow. (Running doPost by
 *     hand is pointless: it only makes sense when the web page calls it,
 *     and Google will refuse to run it before this step is done.)
 *  3. Deploy > New deployment > type "Web app".
 *       Execute as:     Me
 *       Who has access: Anyone
 *     Deploy, authorise, copy the Web app URL (it ends with /exec).
 *  4. Paste that URL into ENDPOINT at the top of assets/app.js.
 *  5. Check the deployment by opening the /exec URL in a browser: it must
 *     print {"ok":true,"message":"Tone test endpoint is live.",...}.
 *
 *  Tabs used:
 *    responses    one row per answered item  (20 payload fields)
 *    submissions  one row per submission     (10 envelope fields)
 *
 *  Both tabs are created automatically with the header row below. If you
 *  prefer to paste the header yourself (see sheet-headers-responses.tsv),
 *  do that first and name the tab exactly "responses" — this script reads
 *  row 1 of whatever it finds and fills by COLUMN NAME, so the column order
 *  in your sheet is what wins. Rename a header and that field stops landing.
 * ============================================================================
 */

/** Leave "" to use the spreadsheet this script is bound to. */
const SHEET_ID = "";

const RESPONSES_SHEET = "responses";
const SUBMISSIONS_SHEET = "submissions";

/** Exact payload keys, in payload order. One row per answer. */
const RESPONSE_HEADER = [
  "testType", "testLabel", "studentName", "major", "submittedAt", "maxPlays",
  "totalItems", "scoredItems", "correctCount", "scorePercent",
  "question", "audioFile", "response", "responseLabel", "answerKey", "answerKeyLabel",
  "correct", "result", "playsUsed", "timeSeconds"
];

/** Exact envelope keys. One row per submission. */
const SUBMISSION_HEADER = [
  "testType", "testLabel", "studentName", "major", "submittedAt", "maxPlays",
  "totalItems", "scoredItems", "correctCount", "scorePercent"
];

/** Fields that must land in the sheet as numbers, not text. */
const NUMERIC_KEYS = [
  "maxPlays", "totalItems", "scoredItems", "correctCount", "scorePercent",
  "question", "response", "answerKey", "correct", "playsUsed", "timeSeconds"
];

/* ---------------------------------------------------------------------------
 *  Entry points
 * ------------------------------------------------------------------------- */

/**
 * RUN THIS ONE FIRST (and only once), from the editor toolbar:
 * select "authorize" and click Run. It walks you through Google's permission
 * dialog and then proves the script can reach your spreadsheet.
 *
 * Nothing is written except the two header rows, and only if those tabs do
 * not exist yet. Safe to run again at any time.
 */
function authorize() {
  let ss;
  try {
    ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    const failed = "Cannot open the spreadsheet: " + ((err && err.message) || err) +
      " — check the value of SHEET_ID.";
    Logger.log(failed);
    return failed;
  }

  if (!ss) {
    const standalone = "This script is not attached to a spreadsheet, so SHEET_ID is required. " +
      "Either re-create the script from your Sheet (Extensions > Apps Script), or paste the " +
      "long ID from the Sheet URL (docs.google.com/spreadsheets/d/THIS_PART/edit) into SHEET_ID " +
      "at the top of this file.";
    Logger.log(standalone);
    return standalone;
  }

  ensureSheet(ss, RESPONSES_SHEET, RESPONSE_HEADER);
  ensureSheet(ss, SUBMISSIONS_SHEET, SUBMISSION_HEADER);

  const ok = "OK — connected to \"" + ss.getName() + "\". Tabs ready: " +
    RESPONSES_SHEET + " (" + RESPONSE_HEADER.length + " columns), " +
    SUBMISSIONS_SHEET + " (" + SUBMISSION_HEADER.length + " columns). " +
    "Next: Deploy > New deployment > Web app.";
  Logger.log(ok);
  return ok;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Empty request body. This function is called over HTTP by the test page, " +
        "so running it by hand always fails — run authorize() instead.");
    }

    const payload = JSON.parse(e.postData.contents);
    const ss = SHEET_ID
      ? SpreadsheetApp.openById(SHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error("No spreadsheet found. Set SHEET_ID.");

    if (!payload.studentName) throw new Error("Missing studentName.");
    if (!payload.testType) throw new Error("Missing testType.");

    const items = Array.isArray(payload.responses) ? payload.responses : [];

    // ---- one row per answered item -------------------------------------
    const respSheet = ensureSheet(ss, RESPONSES_SHEET, RESPONSE_HEADER);
    const respHeaders = readHeaders(respSheet, RESPONSE_HEADER);
    const records = items.map(function (item) {
      const merged = {};
      SUBMISSION_HEADER.forEach(function (key) {
        merged[key] = payload[key];
      });
      Object.keys(item).forEach(function (key) {
        merged[key] = item[key];
      });
      return merged;
    });
    const written = appendRecords(respSheet, respHeaders, records);

    // ---- one row per submission ----------------------------------------
    const subSheet = ensureSheet(ss, SUBMISSIONS_SHEET, SUBMISSION_HEADER);
    const subHeaders = readHeaders(subSheet, SUBMISSION_HEADER);
    appendRecords(subSheet, subHeaders, [payload]);

    return json({ ok: true, rows: written, studentName: payload.studentName });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Browsers may probe with GET before/after POST — answer politely. */
function doGet() {
  return json({
    ok: true,
    message: "Tone test endpoint is live.",
    responsesHeader: RESPONSE_HEADER,
    submissionsHeader: SUBMISSION_HEADER
  });
}

/* ---------------------------------------------------------------------------
 *  Sheet plumbing
 * ------------------------------------------------------------------------- */

function ensureSheet(ss, name, header) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Row 1 defines the columns. If it is blank we write the default header;
 * otherwise we respect whatever the sheet already says, so re-ordering the
 * columns in the sheet is safe.
 */
function readHeaders(sheet, fallback) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const row = sheet.getRange(1, 1, 1, width).getValues()[0];
  const cleaned = row.map(function (v) { return String(v == null ? "" : v).trim(); });

  const hasAny = cleaned.some(function (v) { return v !== ""; });
  if (!hasAny) {
    sheet.getRange(1, 1, 1, fallback.length).setValues([fallback]);
    sheet.getRange(1, 1, 1, fallback.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return fallback.slice();
  }
  return cleaned;
}

function appendRecords(sheet, headers, records) {
  if (!records || !records.length) return 0;

  const rows = records.map(function (rec) {
    return headers.map(function (key) {
      if (!key) return "";
      return cellValue(key, rec[key]);
    });
  });

  const startRow = sheet.getLastRow() + 1;
  ensureCapacity(sheet, startRow, rows.length);
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}

function cellValue(key, value) {
  if (value === undefined || value === null) return "";
  if (NUMERIC_KEYS.indexOf(key) !== -1) {
    if (value === "") return "";
    const n = Number(value);
    return isNaN(n) ? "" : n;
  }
  return value;
}

function ensureCapacity(sheet, startRow, count) {
  const needed = startRow + count - 1;
  const max = sheet.getMaxRows();
  if (needed > max) sheet.insertRowsAfter(max, needed - max);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
