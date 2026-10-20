// Giới hạn của gói miễn phí. Dùng chung cho popup, menu chuột phải, trang cắt ảnh
// và dashboard, nên mọi đường lưu ký ức đều áp cùng một luật.
var MNEMONICS_FREE_MONTHLY_LIMIT = 50;
var MNEMONICS_QUOTA_MESSAGE = 'Gói miễn phí lưu tối đa ' + MNEMONICS_FREE_MONTHLY_LIMIT +
  ' ký ức mỗi tháng. Mở Bảng điều khiển → Gói dịch vụ để nâng cấp Mastery và lưu không giới hạn.';

// Mastery còn hạn khi tài khoản đang đăng nhập có proUntil ở tương lai
function mnemonicsIsPro(user) {
  return Boolean(user && user.email && user.proUntil && Date.now() < Date.parse(user.proUntil));
}

function mnemonicsSavedThisMonth(items) {
  var now = new Date();
  return (items || []).filter(function(item) {
    var d = new Date(item.savedAt || 0);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
}

// cb({ allowed, pro, used, limit }) — đọc thẳng từ bộ nhớ của extension
function mnemonicsCheckQuota(cb) {
  chrome.storage.local.get(['mnemonics_current_user', 'mnemonics_items'], function(r) {
    var pro = mnemonicsIsPro(r.mnemonics_current_user);
    var used = mnemonicsSavedThisMonth(r.mnemonics_items);
    cb({ allowed: pro || used < MNEMONICS_FREE_MONTHLY_LIMIT, pro: pro, used: used, limit: MNEMONICS_FREE_MONTHLY_LIMIT });
  });
}
