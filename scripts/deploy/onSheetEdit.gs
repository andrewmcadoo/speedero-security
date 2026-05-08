// scripts/deploy/onSheetEdit.gs
//
// Bound script for the master schedule sheet. Install as an installable
// "On edit" trigger so it can call UrlFetchApp (simple onEdit cannot).
//
// Setup:
//   1. Open the master sheet → Extensions → Apps Script.
//   2. Paste this file's contents into Code.gs.
//   3. Project Settings → Script Properties → add:
//        WEBHOOK_SECRET = <same value as SHEET_WEBHOOK_SECRET on server>
//   4. Triggers (clock icon) → Add Trigger:
//        Function:     onSheetEdit
//        Event source: From spreadsheet
//        Event type:   On edit
//   5. Save → grant UrlFetchApp scope when prompted.

const WEBHOOK_URL = 'https://clipper.speedero.com/SecApp/api/sheet-changed';

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
}

function onSheetEdit(_e) {
  const secret = getSecret_();
  if (!secret) {
    console.warn('WEBHOOK_SECRET not set in Script Properties; skipping.');
    return;
  }

  const body = '';
  const sigBytes = Utilities.computeHmacSha256Signature(body, secret);
  const sig = sigBytes
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');

  try {
    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      headers: { 'X-Signature': sig },
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.warn('sheet webhook failed', err);
  }
}
