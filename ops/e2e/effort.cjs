// Counts the effort a real person spends: every click, field typed, option chosen, box ticked and page opened.
// Patches Playwright's Locator so any script using it is measured without changing its steps.
const counts = { clicks: 0, fields: 0, selects: 0, checks: 0, files: 0, pages: 0 };
function instrument(page) {
  const proto = page.locator('body').constructor.prototype;
  if (!proto.__counted) {
    proto.__counted = true;
    for (const [m, k] of [['click', 'clicks'], ['fill', 'fields'], ['selectOption', 'selects'], ['check', 'checks'], ['uncheck', 'checks'], ['setInputFiles', 'files']]) {
      const orig = proto[m];
      proto[m] = function (...a) { counts[k] += 1; return orig.apply(this, a); };
    }
  }
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) counts.pages += 1; });
}
function snapshot() { return { ...counts }; }
function since(s) { const o = {}; for (const k of Object.keys(counts)) o[k] = counts[k] - s[k]; o.actions = o.clicks + o.fields + o.selects + o.checks + o.files; return o; }
module.exports = { instrument, snapshot, since };
