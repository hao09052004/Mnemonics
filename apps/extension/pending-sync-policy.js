// Pure retry policy shared by the extension background sync and tests.
// Delays are intentionally bounded so a long-lived offline browser does not
// hammer the API when connectivity returns intermittently.
var MNEMONICS_SYNC_POLICY = {
  MAX_ATTEMPTS: 8,
  BASE_DELAY_MS: 30 * 1000,
  MAX_DELAY_MS: 60 * 60 * 1000,

  nextDelayMs: function(attempts) {
    var exponent = Math.max(0, Number(attempts || 0));
    return Math.min(this.BASE_DELAY_MS * Math.pow(2, exponent), this.MAX_DELAY_MS);
  },

  nextRetryAt: function(nowMs, attempts) {
    return new Date(Number(nowMs || Date.now()) + this.nextDelayMs(attempts)).toISOString();
  },

  shouldRetry: function(item, nowMs) {
    if (!item || item.pendingUpload !== true) return false;
    var attempts = Number(item.syncAttempts || 0);
    if (attempts >= this.MAX_ATTEMPTS) return false;
    var next = item.nextRetryAt ? Date.parse(item.nextRetryAt) : 0;
    return !next || next <= Number(nowMs || Date.now());
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MNEMONICS_SYNC_POLICY;
}
