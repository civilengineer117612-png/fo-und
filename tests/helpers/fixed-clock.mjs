// Preload for the DATE GUARD (owner, Nov 12, L9): `TEST_NOW=<ISO instant> NODE_OPTIONS="--import ./tests/helpers/fixed-clock.mjs" npm test` runs the
// whole suite as if today were that instant. `new Date()` and `Date.now()` answer TEST_NOW; a date built from arguments is untouched, and timers and
// `performance.now()` keep real time (so a speed test still measures). NODE_OPTIONS (not a flag) so a helper process a test starts is on the same day.
// Used by `npm run test:dates`; with no TEST_NOW it does nothing.
const at = process.env.TEST_NOW ? Date.parse(process.env.TEST_NOW) : NaN;
if (process.env.TEST_NOW && Number.isNaN(at)) throw new Error("TEST_NOW is not a date: " + process.env.TEST_NOW);
if (!Number.isNaN(at)) {
  const Real = Date;
  class Fixed extends Real {
    constructor(...args) { if (args.length === 0) super(at); else super(...args); }
    static now() { return at; }
  }
  globalThis.RealDate = Real;   // for the one test that compares with a helper program outside Node (the staging step runs the system `date`)
  globalThis.Date = Fixed;
}
