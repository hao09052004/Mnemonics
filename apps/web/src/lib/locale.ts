import { useCallback, useEffect, useState } from 'react';

export type Locale = 'en' | 'vi';

export const LOCALE_STORAGE_KEY = 'mnemonics_locale';
export const LOCALE_CHANGE_EVENT = 'mnemonics-locale-change';

export const DICTIONARY = {
  // Navigation & Header
  nav_product: { en: 'Product', vi: 'Sản phẩm' },
  nav_how_it_works: { en: 'How it works', vi: 'Cách hoạt động' },
  nav_pricing: { en: 'Pricing', vi: 'Bảng giá' },
  nav_extension: { en: 'Browser extension', vi: 'Tiện ích trình duyệt' },
  nav_privacy: { en: 'Privacy', vi: 'Quyền riêng tư' },
  nav_login: { en: 'Log in', vi: 'Đăng nhập' },
  nav_open_app: { en: 'Open Mnemonics', vi: 'Mở Mnemonics' },
  header_get_mnemonics: { en: 'Get Mnemonics', vi: 'Tải Mnemonics' },

  // Dashboard Nav & Shell
  brand_tagline: { en: 'Save once — Find anytime.', vi: 'Lưu một lần — Tìm mọi lúc.' },
  nav_everything: { en: 'Everything', vi: 'Mọi thứ' },
  nav_favorites: { en: 'Favorites', vi: 'Yêu thích' },
  nav_groups: { en: 'Groups', vi: 'Nhóm' },
  nav_spaces: { en: 'Spaces', vi: 'Bộ sưu tập' },
  nav_rediscover: { en: 'Rediscover', vi: 'Khám phá lại' },
  nav_reminders: { en: 'Reminders', vi: 'Nhắc nhở' },
  nav_analytics: { en: 'Analytics', vi: 'Phân tích' },
  nav_account: { en: 'Account', vi: 'Tài khoản' },
  nav_admin: { en: 'Admin', vi: 'Quản trị' },
  btn_capture: { en: 'Capture', vi: 'Thu thập' },
  btn_logout: { en: 'Log out', vi: 'Đăng xuất' },

  // Marketing Hero
  hero_pill_badge: { en: 'CHROME STORE', vi: 'CHROME STORE' },
  hero_pill_text: { en: 'Official extension is now live', vi: 'Tiện ích chính thức đã có mặt' },
  hero_headline_1: { en: 'Remember everything,', vi: 'Ghi nhớ tất cả,' },
  hero_headline_2: { en: 'without organising everything.', vi: 'mà không cần sắp xếp.' },
  hero_lead: {
    en: 'Mnemonics captures pages, thoughts, images and highlights — then quietly connects them so you can find them later by meaning, not by filename.',
    vi: 'Mnemonics ghi nhớ trang web, suy nghĩ, hình ảnh và trích dẫn — kết nối thông minh để bạn tìm lại theo ý nghĩa, không cần nhớ tên file.'
  },
  hero_add_chrome: { en: 'Add to Chrome', vi: 'Thêm vào Chrome' },
  hero_add_edge: { en: 'Add to Edge', vi: 'Thêm vào Edge' },
  hero_open_web_app: { en: 'Open the web app →', vi: 'Mở ứng dụng web →' },
  hero_browser_compat: {
    en: 'Chrome · Edge · Brave · Chromium-based browsers',
    vi: 'Chrome · Edge · Brave · Trình duyệt nhân Chromium'
  },

  // Final CTA
  cta_eyebrow: { en: 'Save it now', vi: 'Lưu lại ngay' },
  cta_headline: { en: 'Remember it later.', vi: 'Nhớ lại sau.' },
  cta_lead: {
    en: 'Mnemonics is a private, AI-shaped second brain. It works best when it lives where you already spend your day — the browser.',
    vi: 'Mnemonics là bộ não thứ hai riêng tư, định hình bởi AI. Hoạt động mượt mà nhất ngay tại nơi bạn làm việc mỗi ngày — trình duyệt web.'
  },
  cta_open_web_app: { en: 'Open web app', vi: 'Mở ứng dụng web' },

  // Capture Section
  capture_eyebrow: { en: 'Capture', vi: 'Thu thập' },
  capture_headline_1: { en: 'One click.', vi: 'Một lần nhấn.' },
  capture_headline_2: { en: 'Safely remembered.', vi: 'Ghi nhớ an toàn.' },
  capture_lead: {
    en: "Click the Mnemonics browser button while you're on a page. We save the article, the highlight, the screenshot — whichever you need — without you leaving the tab.",
    vi: 'Nhấn biểu tượng Mnemonics khi đang lướt web. Toàn bộ bài viết, trích dẫn, ảnh chụp màn hình được lưu lại tức thì mà không cần rời tab.'
  },
  capture_btn_install: { en: 'Get the browser extension', vi: 'Cài tiện ích trình duyệt' },

  // Capture Flow Section
  flow_eyebrow: { en: 'Flows', vi: 'Quy trình' },
  flow_headline_1: { en: 'Capture without leaving', vi: 'Thu thập mà không rời' },
  flow_headline_2: { en: "what you're doing.", vi: 'công việc đang làm.' },
  flow_lead: {
    en: 'Three gestures cover almost every web moment: highlight something you care about, right-click an image, or grab a screenshot. Mnemonics handles the rest.',
    vi: 'Ba thao tác đơn giản bao trọn mọi khoảnh khắc lướt web: bôi đen đoạn trích, nhấp chuột phải lưu ảnh hoặc chụp màn hình. Mnemonics sẽ lo phần còn lại.'
  },
  flow_tile_1_title: { en: 'Highlight text', vi: 'Bôi đen văn bản' },
  flow_tile_1_body: {
    en: 'Select any passage on a page. Right-click → Save to Mnemonics. The original source is kept, the quote is extracted, and the right tags appear without you typing them.',
    vi: 'Chọn bất kỳ đoạn văn nào trên trang. Chuột phải → Lưu vào Mnemonics. Nguồn gốc được lưu lại, trích dẫn được trích xuất và thẻ tag tự động xuất hiện.'
  },
  flow_tile_2_title: { en: 'Save an image', vi: 'Lưu hình ảnh' },
  flow_tile_2_body: {
    en: 'Right-click on an image → Save image. Mnemonics stores a local copy, fingerprints where it came from, and surfaces it whenever a related memory is recalled.',
    vi: 'Chuột phải vào hình ảnh → Lưu ảnh. Mnemonics lưu bản sao, ghi nhớ nguồn và hiển thị lại bất cứ khi nào bạn tìm kiếm nội dung liên quan.'
  },
  flow_tile_3_title: { en: 'Crop a screenshot', vi: 'Cắt ảnh màn hình' },
  flow_tile_3_body: {
    en: "Capture the visible tab, drag a rectangle around what matters, save. Screenshots get OCR'd and embedded, so a text search can find them later.",
    vi: 'Chụp tab đang xem, kéo chọn vùng quan trọng và lưu. Ảnh chụp được nhận dạng chữ (OCR) và nhúng AI để bạn tìm lại theo từ khóa.'
  },
  flow_guide_link: { en: 'Read the extension guide →', vi: 'Xem hướng dẫn tiện ích →' },

  // Memory Masonry
  masonry_eyebrow: { en: 'Formats', vi: 'Định dạng' },
  masonry_headline: { en: 'Save anything.', vi: 'Lưu giữ bất cứ điều gì.' },
  masonry_lead: {
    en: 'Articles, quotes, screenshots, thoughts, bookmarks. Every memory is indexed and ready to be recalled by meaning.',
    vi: 'Bài viết, trích dẫn, ảnh chụp, suy nghĩ, đánh dấu trang. Mọi ký ức đều được đánh chỉ mục và sẵn sàng tìm lại theo ý nghĩa.'
  },

  // AI Pipeline Section
  pipeline_eyebrow: { en: 'Understand', vi: 'Thấu hiểu' },
  pipeline_headline: { en: 'No folders required.', vi: 'Không cần tạo thư mục.' },
  pipeline_lead: {
    en: 'Mnemonics quietly processes what you save — extracting text, picking tags, embedding for search. By the time you go looking for it, the memory is ready.',
    vi: 'Mnemonics âm thầm xử lý những gì bạn lưu — trích xuất văn bản, gắn thẻ thông minh, nhúng vector tìm kiếm. Khi bạn cần tìm lại, ký ức đã sẵn sàng.'
  },
  pipeline_step_1_title: { en: 'Capture', vi: 'Thu thập' },
  pipeline_step_1_body: {
    en: 'Anything you save — page, highlight, image, screenshot — is forwarded to the API as a memory with a stable id.',
    vi: 'Bất cứ nội dung nào bạn lưu — trang web, trích dẫn, hình ảnh, ảnh chụp màn hình — được chuyển đến API với định danh duy nhất.'
  },
  pipeline_step_2_title: { en: 'Processing', vi: 'Xử lý OCR' },
  pipeline_step_2_body: {
    en: 'OCR runs on images and screenshots. The pipeline waits for it before generating tags or embeddings.',
    vi: 'Hệ thống tự động đọc chữ (OCR) trên ảnh và ảnh chụp màn hình trước khi tạo thẻ hoặc nhúng vector.'
  },
  pipeline_step_3_title: { en: 'Tags', vi: 'Gắn thẻ AI' },
  pipeline_step_3_body: {
    en: 'A small language model picks 1–5 tags from your existing tag set, falling back to new ones when needed.',
    vi: 'Mô hình ngôn ngữ tự động chọn 1–5 thẻ từ bộ thẻ của bạn, hoặc tạo thẻ mới phù hợp.'
  },
  pipeline_step_4_title: { en: 'Embedding', vi: 'Nhúng vector' },
  pipeline_step_4_body: {
    en: 'A vector embedding is computed for the memory so semantic search can find it by meaning.',
    vi: 'Vector embedding được tính toán để công nghệ tìm kiếm ngữ nghĩa (Semantic Search) tìm lại theo ý niệm.'
  },
  pipeline_step_5_title: { en: 'Ready', vi: 'Sẵn sàng' },
  pipeline_step_5_body: {
    en: 'The memory flips to ready. It now shows up in lists, tag filters, semantic search and related-memory rails.',
    vi: 'Ký ức chuyển sang trạng thái sẵn sàng, xuất hiện trong danh sách, bộ lọc thẻ và tìm kiếm ngữ nghĩa.'
  },

  // Semantic Search Demo
  semantic_eyebrow: { en: 'Recall', vi: 'Tìm lại' },
  semantic_headline: { en: 'Search the way you remember.', vi: 'Tìm kiếm theo cách bạn nhớ.' },
  semantic_lead: {
    en: "Type it the way you'd ask a friend. Mnemonics finds it by meaning, not by the words that happened to be in the title.",
    vi: 'Gõ như cách bạn hỏi một người bạn. Mnemonics tìm kiếm theo ý nghĩa, không phụ thuộc vào từ ngữ chính xác trong tiêu đề.'
  },
  semantic_sample_query: {
    en: 'the article about safe reinforcement learning',
    vi: 'bài viết về trí tuệ nhân tạo an toàn'
  },

  // Related Memories Demo
  related_eyebrow: { en: 'Connect', vi: 'Kết nối' },
  related_headline: { en: 'One memory leads to another.', vi: 'Ký ức này gợi mở ký ức khác.' },
  related_lead: {
    en: 'Save enough, and Mnemonics starts surfacing unexpected connections. Related memories appear inline so a single save can become the start of a long thread.',
    vi: 'Khi bạn lưu đủ nhiều, Mnemonics bắt đầu liên kết những ý tưởng bất ngờ. Các ký ức liên quan hiển thị liền mạch để một lần lưu mở ra cả dòng suy nghĩ.'
  },

  // Sync Section
  sync_eyebrow: { en: 'Access', vi: 'Truy cập' },
  sync_headline: { en: 'Your memories, wherever you need them.', vi: 'Ký ức của bạn, ở bất cứ nơi đâu.' },
  sync_lead: {
    en: 'Save from the browser, find it in the dashboard. Mnemonics is a small system with a single source of truth: the API.',
    vi: 'Lưu từ trình duyệt, tìm lại trên dashboard. Mnemonics đồng bộ tức thì qua hệ thống API tinh gọn.'
  },
  sync_card_1_title: { en: 'Browser extension', vi: 'Tiện ích trình duyệt' },
  sync_card_1_body: {
    en: 'Capture from any tab. Highlights, images, screenshots, the whole page.',
    vi: 'Thu thập từ mọi tab. Trích dẫn, hình ảnh, ảnh màn hình và toàn bộ trang.'
  },
  sync_card_2_title: { en: 'Mnemonics API', vi: 'Mnemonics API' },
  sync_card_2_body: {
    en: 'A single REST API processes your memories, runs OCR + tags, and stores vectors.',
    vi: 'Hệ thống REST API xử lý ký ức, chạy OCR, gắn thẻ và lưu trữ vector an toàn.'
  },
  sync_card_3_title: { en: 'Web dashboard', vi: 'Ứng dụng Web' },
  sync_card_3_body: {
    en: 'Search, browse and refine. The same library, accessible from any modern browser.',
    vi: 'Tìm kiếm, duyệt và khám phá. Toàn bộ kho tri thức truy cập mượt mà trên mọi trình duyệt.'
  },
  sync_footer_note: {
    en: "Native iOS / Android sync is on the roadmap. We only list what's shipping today.",
    vi: 'Ứng dụng iOS / Android đang trong lộ trình phát triển. Chúng tôi chỉ công bố những tính năng đã sẵn sàng.'
  },
  sync_open_dash: { en: 'Open the dashboard →', vi: 'Mở ứng dụng web →' },

  // Privacy Section
  privacy_eyebrow: { en: 'Private', vi: 'Riêng tư' },
  privacy_headline: { en: 'Your second brain should feel private.', vi: 'Bộ não thứ hai phải hoàn toàn riêng tư.' },
  privacy_lead: {
    en: "A few things we commit to in this release — and a few things we don't, because shipping them honestly matters more than shipping a bullet list.",
    vi: 'Những cam kết thực tế của chúng tôi trong phiên bản này — minh bạch và trung thực với dữ liệu của bạn.'
  },
  privacy_promise_1_title: { en: 'Your data, your account', vi: 'Dữ liệu của bạn, tài khoản của bạn' },
  privacy_promise_1_body: {
    en: 'Memories are owned by the user who saved them. There is no public profile, no follower graph, no shared inbox.',
    vi: 'Ký ức thuộc quyền sở hữu của bạn. Không có hồ sơ công khai, không theo dõi và không chia sẻ dữ liệu.'
  },
  privacy_promise_2_title: { en: 'Captured locally first', vi: 'Ghi nhận cục bộ trước' },
  privacy_promise_2_body: {
    en: 'The extension keeps your last-seen memory state in browser storage so a network hiccup never costs you a save.',
    vi: 'Tiện ích lưu tạm trong bộ nhớ trình duyệt để không bao giờ bị mất dữ liệu khi mất kết nối mạng.'
  },
  privacy_promise_3_title: { en: 'Direct transport', vi: 'Truyền tải trực tiếp' },
  privacy_promise_3_body: {
    en: "The extension talks to the API directly. We don't proxy your captures through any third-party analytics.",
    vi: 'Tiện ích gửi dữ liệu trực tiếp đến API, tuyệt đối không chuyển qua bất kỳ bên theo dõi thứ ba nào.'
  },
  privacy_promise_4_title: { en: 'Audit trail', vi: 'Mã định danh minh bạch' },
  privacy_promise_4_body: {
    en: 'Every API response carries a request id surfaced in error messages so you can ask us exactly what happened.',
    vi: 'Mọi phản hồi từ API đều có mã request ID rõ ràng trong thông báo lỗi để dễ dàng tra cứu.'
  },
  privacy_learn_more: { en: 'Learn about privacy →', vi: 'Tìm hiểu về quyền riêng tư →' },

  // Footer
  footer_slogan: {
    en: 'Save once. Remember anytime. A personal second brain for the browser-first generation.',
    vi: 'Lưu một lần. Nhớ mọi lúc. Bộ não thứ hai cho thế hệ làm việc trên trình duyệt.'
  },
  footer_col_product: { en: 'Product', vi: 'Sản phẩm' },
  footer_col_account: { en: 'Account', vi: 'Tài khoản' },
  footer_col_resources: { en: 'Resources', vi: 'Tài nguyên' },
  footer_link_create_account: { en: 'Create account', vi: 'Tạo tài khoản' },
  footer_link_open_dashboard: { en: 'Open dashboard', vi: 'Mở ứng dụng web' },
  footer_copyright: { en: 'All rights reserved.', vi: 'Bảo lưu mọi quyền.' },
  footer_tagline: {
    en: 'Built privately, for one mind at a time.',
    vi: 'Xây dựng riêng tư, dành cho một tâm trí duy nhất.'
  },

  // Content Type Chips
  chip_all: { en: 'All', vi: 'Tất cả' },
  chip_note: { en: 'Notes', vi: 'Ghi chú' },
  chip_article: { en: 'Articles', vi: 'Bài viết' },
  chip_image: { en: 'Images', vi: 'Hình ảnh' },
  chip_screenshot: { en: 'Screenshots', vi: 'Ảnh màn hình' },
  chip_highlight: { en: 'Highlights', vi: 'Trích dẫn' },
  chip_document: { en: 'Documents', vi: 'Tài liệu' },

  // Search & Empty States
  search_placeholder: {
    en: 'Search by meaning, quote or tag...',
    vi: 'Tìm theo ý nghĩa, trích dẫn hoặc thẻ...'
  },
  search_select: { en: 'Select', vi: 'Chọn' },
  empty_memory_starts: { en: 'Your memory starts here.', vi: 'Bộ não thứ hai bắt đầu từ đây.' },
  empty_save_something: { en: 'Save something worth remembering.', vi: 'Lưu lại những điều đáng nhớ.' },
  empty_no_found: { en: 'No memories found.', vi: 'Không tìm thấy ký ức nào.' },
  empty_try_another: {
    en: 'Try another keyword or a different content type.',
    vi: 'Thử từ khóa khác hoặc lọc theo định dạng khác.'
  },

  // Capture Sheet
  capture_sheet_title: { en: 'Capture a memory', vi: 'Thu thập nội dung' },
  capture_link: { en: 'Save Link', vi: 'Lưu liên kết' },
  capture_note: { en: 'Quick Note', vi: 'Ghi chú nhanh' },
  capture_quote: { en: 'Save Quote', vi: 'Lưu trích dẫn' },
  capture_image: { en: 'Upload Image', vi: 'Tải lên hình ảnh' },
  capture_document: { en: 'Upload Document', vi: 'Tải lên tài liệu' },

  // Spaces Page
  spaces_title: { en: 'Spaces', vi: 'Bộ sưu tập' },
  spaces_sub: {
    en: 'Organize memories around the things that matter.',
    vi: 'Sắp xếp ký ức xoay quanh những chủ đề quan trọng.'
  },
  spaces_new_btn: { en: 'New Space', vi: 'Tạo bộ sưu tập' },
  spaces_my_spaces: { en: 'My Spaces', vi: 'Bộ sưu tập của tôi' },
  spaces_loading: { en: 'Loading Spaces…', vi: 'Đang tải bộ sưu tập…' },
  spaces_empty_hint: {
    en: 'Create a Space to keep related memories together.',
    vi: 'Tạo bộ sưu tập để gom nhóm các ký ức liên quan.'
  },

  // Theme Switch
  theme_light: { en: 'Light', vi: 'Sáng' },
  theme_dark: { en: 'Dark', vi: 'Tối' },
  theme_system: { en: 'System', vi: 'Hệ thống' },
  theme_title_light: { en: 'Light interface (White)', vi: 'Giao diện Sáng (Trắng)' },
  theme_title_dark: { en: 'Dark interface (Black)', vi: 'Giao diện Tối (Đen)' },
  theme_title_system: { en: 'Follow system preference', vi: 'Theo thiết lập của máy tính (Hệ thống)' },

  // Language Switch
  lang_label_theme: { en: 'Theme', vi: 'Giao diện' },
  lang_label_language: { en: 'Language', vi: 'Ngôn ngữ' },
  lang_en: { en: 'English', vi: 'Tiếng Anh' },
  lang_vi: { en: 'Vietnamese', vi: 'Tiếng Việt' },
  lang_title_en: { en: 'Switch to English', vi: 'Chuyển sang Tiếng Anh' },
  lang_title_vi: { en: 'Switch to Vietnamese', vi: 'Chuyển sang Tiếng Việt' },

  // Pricing Page
  pricing_back: { en: '← Home', vi: '← Trang chủ' },
  pricing_title: { en: 'Choose the plan that fits you', vi: 'Chọn gói phù hợp với bạn' },
  pricing_tagline: {
    en: 'Unlimited knowledge retention & unlock all AI features with Mastery, or start free with Memory.',
    vi: 'Lưu giữ tri thức không giới hạn & mở khóa toàn bộ tính năng AI với Mastery, hoặc bắt đầu miễn phí với Memory.'
  },
  pricing_monthly: { en: '/ month', vi: '/ tháng' },
  pricing_yearly: { en: '/ year', vi: '/ năm' },
  pricing_forever: { en: '/ forever', vi: '/ mãi mãi' },
  pricing_current_plan: { en: 'Your current plan', vi: 'Gói hiện tại của bạn' },
  pricing_upgrade_mastery: { en: 'Upgrade Mastery', vi: 'Nâng cấp Mastery' },
  pricing_using: { en: 'In use', vi: 'Đang sử dụng' },

  // Common UI actions & generic terms
  btn_edit: { en: 'Edit', vi: 'Chỉnh sửa' },
  btn_delete: { en: 'Delete', vi: 'Xóa' },
  btn_save: { en: 'Save', vi: 'Lưu' },
  btn_cancel: { en: 'Cancel', vi: 'Hủy' },
  btn_try_again: { en: 'Try again', vi: 'Thử lại' },
  btn_back: { en: '← Back', vi: '← Quay lại' },
  status_loading: { en: 'Loading…', vi: 'Đang tải…' },
  status_saving: { en: 'Saving…', vi: 'Đang lưu…' },
  status_saved: { en: 'Saved', vi: 'Đã lưu' },
  status_updating: { en: 'Updating…', vi: 'Đang cập nhật…' },
  memory_unit_one: { en: 'memory', vi: 'ghi nhớ' },
  memory_unit_other: { en: 'memories', vi: 'ghi nhớ' },
  selected_unit: { en: 'selected', vi: 'đã chọn' },

  // Dashboard & Everything view
  everything_title: { en: 'Everything', vi: 'Mọi thứ' },
  everything_sub: { en: 'Your saved memories in one place.', vi: 'Toàn bộ ký ức đã lưu của bạn ở cùng một nơi.' },
  favorites_title: { en: 'Favorites', vi: 'Yêu thích' },
  favorites_sub: { en: 'Your favorited memories in one place.', vi: 'Các ký ức bạn đã gắn sao yêu thích.' },
  favorites_empty_title: { en: 'No favorites yet.', vi: 'Chưa có mục yêu thích nào.' },
  favorites_empty_text: { en: 'Click the heart on any memory to save it here.', vi: 'Nhấn vào biểu tượng trái tim trên bất kỳ ký ức nào để lưu vào đây.' },
  btn_save_as_space: { en: 'Save as Space', vi: 'Lưu thành Bộ sưu tập' },
  btn_load_more: { en: 'Load more', vi: 'Tải thêm' },
  card_open_details: { en: 'Open details', vi: 'Mở chi tiết' },
  card_add_favorite: { en: 'Add favorite', vi: 'Thêm yêu thích' },
  card_remove_favorite: { en: 'Remove favorite', vi: 'Bỏ yêu thích' },
  card_add_to_space: { en: 'Add to Space', vi: 'Thêm vào Space' },
  card_related_label: { en: 'related', vi: 'liên quan' },
  capture_card_new: { en: 'New memory', vi: 'Ghi nhớ mới' },
  capture_card_typing: { en: 'Start typing...', vi: 'Bắt đầu nhập...' },
  capture_card_paste: { en: 'or paste anything', vi: 'hoặc dán bất kỳ nội dung nào' },

  // Spaces & Space Detail
  space_empty_manual: { en: 'No memories here yet.', vi: 'Chưa có ký ức nào trong bộ sưu tập này.' },
  space_empty_smart: { en: 'No memories currently match this Space.', vi: 'Hiện chưa có ký ức nào phù hợp với bộ sưu tập này.' },
  btn_add_memories: { en: 'Add memories', vi: 'Thêm ký ức' },
  space_saved_criteria: { en: 'Saved criteria', vi: 'Tiêu chí đã lưu' },
  space_smart_explain: {
    en: 'Memories matching this search appear here on their own. Change the criteria with Edit.',
    vi: 'Các ký ức phù hợp với tìm kiếm này sẽ tự động xuất hiện. Thay đổi tiêu chí bằng cách Chỉnh sửa.'
  },

  // Create Space Dialog & Space Picker
  space_dialog_smart_title: { en: 'Create Smart Space', vi: 'Tạo Bộ sưu tập thông minh' },
  space_dialog_manual_title: { en: 'New Space', vi: 'Tạo Bộ sưu tập mới' },
  space_dialog_explain: {
    en: 'This Space automatically stays up to date using your current search and filters. Memories that match will appear on their own — nothing is copied.',
    vi: 'Bộ sưu tập này tự động cập nhật theo tìm kiếm và bộ lọc của bạn. Ký ức phù hợp sẽ tự động hiển thị.'
  },
  space_dialog_current_criteria: { en: 'Current criteria', vi: 'Tiêu chí hiện tại' },
  space_field_name: { en: 'Name', vi: 'Tên' },
  space_field_desc: { en: 'Description', vi: 'Mô tả' },
  space_field_optional: { en: 'optional', vi: 'không bắt buộc' },
  space_field_desc_placeholder: { en: 'What belongs in here?', vi: 'Bộ sưu tập này chứa những gì?' },
  space_field_color: { en: 'Colour', vi: 'Màu sắc' },
  space_btn_create: { en: 'Create Space', vi: 'Tạo bộ sưu tập' },
  space_picker_title: { en: 'Add to Space', vi: 'Thêm vào Bộ sưu tập' },
  space_picker_search: { en: 'Search Spaces', vi: 'Tìm bộ sưu tập' },
  space_picker_no_manual: { en: 'No manual Spaces yet. Create one below.', vi: 'Chưa có bộ sưu tập nào. Hãy tạo một bộ sưu tập mới bên dưới.' },
  space_picker_no_match: { en: 'No Space matches that name.', vi: 'Không có bộ sưu tập nào khớp với tên này.' },
  space_picker_smart_note: {
    en: 'Smart Spaces fill themselves from their saved search, so they are not listed here.',
    vi: 'Bộ sưu tập thông minh tự động tổng hợp từ tìm kiếm nên không hiển thị ở đây.'
  },
  space_picker_create_and_add: { en: 'Create & add', vi: 'Tạo & thêm' },
  space_picker_create_new: { en: 'Create New Space', vi: 'Tạo bộ sưu tập mới' },

  // Groups / Clusters
  clusters_title: { en: 'Groups', vi: 'Nhóm' },
  clusters_subtitle: {
    en: 'Memories that share a topic. Save a group as a Space to keep it your way.',
    vi: 'Những ký ức có cùng chủ đề. Lưu nhóm thành Bộ sưu tập để sắp xếp theo cách của bạn.'
  },
  clusters_refresh_btn: { en: 'Refresh groups', vi: 'Làm mới nhóm' },
  clusters_refreshing: { en: 'Updating groups…', vi: 'Đang cập nhật nhóm…' },
  clusters_loading: { en: 'Loading groups…', vi: 'Đang tải nhóm…' },
  clusters_empty_title: { en: 'No groups yet', vi: 'Chưa có nhóm nào' },
  clusters_empty_text: {
    en: 'Save more memories on a similar topic to see them cluster here.',
    vi: 'Lưu thêm nhiều ký ức cùng chủ đề để xem chúng tự động gom cụm tại đây.'
  },
  clusters_threshold_title: {
    en: 'Save a few more memories to start seeing related groups',
    vi: 'Lưu thêm vài ký ức nữa để bắt đầu thấy các nhóm liên quan'
  },
  clusters_threshold_text: {
    en: 'Groups appear automatically once a few similar memories share enough in common.',
    vi: 'Các nhóm sẽ tự động xuất hiện khi có một số ký ức chia sẻ điểm tương đồng.'
  },

  // Rediscover & Reminders
  rediscover_eyebrow: { en: 'A QUIET RETURN', vi: 'KHÁM PHÁ LẠI' },
  rediscover_title: { en: 'Rediscover', vi: 'Khám phá lại' },
  rediscover_sub: { en: 'Things worth remembering again.', vi: 'Những điều đáng để nhớ lại một lần nữa.' },
  coming_soon: { en: 'Coming soon', vi: 'Sắp ra mắt' },
  rediscover_coming_soon: {
    en: 'Mnemonics Rediscover is on the roadmap. It will resurface memories you saved a long time ago.',
    vi: 'Tính năng Khám phá lại đang được hoàn thiện. Hệ thống sẽ gợi nhắc những ký ức bạn đã lưu từ lâu.'
  },
  reminders_eyebrow: { en: 'GENTLE PROMPTS', vi: 'NHẮC NHỞ NHẸ NHÀNG' },
  reminders_title: { en: 'Reminders', vi: 'Nhắc nhở' },
  reminders_sub: { en: 'A few things you asked to revisit.', vi: 'Những điều bạn muốn xem lại.' },
  reminders_coming_soon: {
    en: 'Mnemonics Reminders is on the roadmap. The API for this page is not in v1.',
    vi: 'Tính năng Nhắc nhở đang được phát triển trong phiên bản tiếp theo.'
  },

  // Capture Dialogs (Link, Note, Image, Doc)
  dialog_link_title: { en: 'Save a link', vi: 'Lưu liên kết' },
  dialog_link_sub: { en: 'Save a webpage, article or online document.', vi: 'Lưu trang web, bài viết hoặc tài liệu trực tuyến.' },
  dialog_link_url_label: { en: 'Web link (URL)', vi: 'Đường dẫn (URL)' },
  dialog_link_title_label: { en: 'Title (optional)', vi: 'Tiêu đề (không bắt buộc)' },
  dialog_link_title_placeholder: { en: 'Extracted automatically if left blank...', vi: 'Tự động trích xuất nếu để trống...' },
  dialog_link_note_label: { en: 'Additional notes (optional)', vi: 'Ghi chú thêm (không bắt buộc)' },
  dialog_link_note_placeholder: { en: 'Add a summary or reason why you saved this...', vi: 'Thêm tóm tắt hoặc lý do bạn lưu liên kết này...' },
  dialog_link_btn_save: { en: 'Save link', vi: 'Lưu liên kết' },
  dialog_note_quote_title: { en: 'Save Quote', vi: 'Lưu trích dẫn' },
  dialog_note_quick_title: { en: 'Quick note', vi: 'Ghi chú nhanh' },
  dialog_note_quote_sub: { en: 'Save a memorable quote into your Second Brain.', vi: 'Lưu trích dẫn, câu nói tâm đắc vào Second Brain.' },
  dialog_note_quick_sub: { en: 'Save a quick thought or note into your Second Brain.', vi: 'Lưu nhanh ý tưởng hoặc ghi chú vào Second Brain.' },
  dialog_note_author_label: { en: 'Author / Source', vi: 'Tác giả / Nguồn' },
  dialog_note_title_label: { en: 'Title', vi: 'Tiêu đề' },
  dialog_note_quote_label: { en: 'Quote content', vi: 'Đoạn trích dẫn' },
  dialog_note_content_label: { en: 'Note content', vi: 'Nội dung ghi chú' },
  dialog_note_save_quote: { en: 'Save quote', vi: 'Lưu trích dẫn' },
  dialog_note_save_note: { en: 'Save note', vi: 'Lưu ghi chú' },
  dialog_image_title: { en: 'Upload Image', vi: 'Tải lên hình ảnh' },
  dialog_image_sub: { en: 'Save photos, infographics or sketches. OCR will extract text automatically.', vi: 'Lưu ảnh, đồ họa hoặc phác thảo. Hệ thống OCR sẽ tự động đọc chữ.' },
  dialog_image_drag_drop: { en: 'Drag and drop an image here, or click to browse', vi: 'Kéo thả hình ảnh vào đây, hoặc nhấn để chọn file' },
  dialog_image_formats: { en: 'JPG, PNG, WebP up to 10MB', vi: 'JPG, PNG, WebP tối đa 10MB' },
  dialog_image_btn_save: { en: 'Save image', vi: 'Lưu hình ảnh' },
  dialog_doc_title: { en: 'Upload Document', vi: 'Tải lên tài liệu' },
  dialog_doc_sub: { en: 'Upload PDF or text documents. Text is indexed for search.', vi: 'Tải lên PDF hoặc tài liệu văn bản. Nội dung được lập chỉ mục tìm kiếm.' },
  dialog_doc_drag_drop: { en: 'Drag and drop a PDF or TXT here, or click to browse', vi: 'Kéo thả PDF hoặc TXT vào đây, hoặc nhấn để chọn file' },
  dialog_doc_btn_upload: { en: 'Upload', vi: 'Tải lên' },

  // Item Detail Page
  detail_back: { en: '← Back', vi: '← Quay lại' },
  detail_favorite: { en: 'Favorite', vi: 'Yêu thích' },
  detail_favorited: { en: 'Favorited', vi: 'Đã yêu thích' },
  detail_untitled: { en: 'Untitled', vi: 'Không có tiêu đề' },
  detail_saved_at: { en: 'Saved', vi: 'Đã lưu' },
  detail_tldr_title: { en: 'AI TL;DR Summary', vi: 'TL;DR · Tóm tắt AI' },
  detail_copied: { en: 'Copied', vi: 'Đã sao chép' },
  detail_copy: { en: 'Copy', vi: 'Sao chép' },
  detail_content: { en: 'Content', vi: 'Nội dung' },
  detail_ocr_text: { en: 'OCR text', vi: 'Văn bản nhận dạng (OCR)' },
  detail_tags: { en: 'Tags', vi: 'Thẻ tag' },
  detail_personal_notes: { en: 'Personal notes', vi: 'Ghi chú cá nhân' },
  detail_notes_placeholder: { en: 'Add your personal notes for this memory...', vi: 'Thêm ghi chú cá nhân của bạn cho ký ức này...' },
  detail_save_notes: { en: 'Save notes', vi: 'Lưu ghi chú' },
  detail_saving_notes: { en: 'Saving…', vi: 'Đang lưu…' },
  detail_saved_notes: { en: 'Saved', vi: 'Đã lưu' },
  detail_open_original: { en: 'Open original', vi: 'Mở trang gốc' },

  // Browser Extension Page
  ext_page_eyebrow: { en: 'Browser extension', vi: 'Tiện ích trình duyệt' },
  ext_page_h1_1: { en: 'The browser extension', vi: 'Tiện ích mở rộng' },
  ext_page_h1_2: { en: 'for your second brain.', vi: 'cho bộ não thứ hai của bạn.' },
  ext_page_lead: {
    en: 'Save pages, images, highlights and screenshots without breaking your flow. Mnemonics lives where you already read, write and think — your browser.',
    vi: 'Lưu trang web, hình ảnh, trích dẫn và ảnh chụp màn hình mà không gián đoạn công việc. Mnemonics hiện diện ngay tại nơi bạn đọc, viết và tư duy — trình duyệt web.'
  },
  ext_sec1_eyebrow: { en: 'Capture', vi: 'Thu thập' },
  ext_sec1_title: { en: "One click and it's remembered.", vi: 'Một lần nhấn và được ghi nhớ an toàn.' },
  ext_sec1_body: {
    en: "Click the Mnemonics button while you're on a page. We save the article in the background, generate a stable id, and surface it in your dashboard the moment it's ready.",
    vi: 'Nhấn nút Mnemonics khi đang ở trên bất kỳ trang web nào. Chúng tôi lưu bài viết ở chế độ nền và đưa lên dashboard ngay khi xử lý xong.'
  },
  ext_sec2_eyebrow: { en: 'Text & images', vi: 'Văn bản & hình ảnh' },
  ext_sec2_title: { en: 'Save text and images without interrupting your flow.', vi: 'Lưu văn bản và hình ảnh mà không làm ngắt quãng dòng suy nghĩ.' },
  ext_sec2_body: {
    en: 'Highlight something and right-click → Save to Mnemonics. Right-click an image → Save image. We extract the text, fingerprint the source, and quietly fit it into your library.',
    vi: 'Bôi đen văn bản và chuột phải → Lưu vào Mnemonics. Chuột phải vào ảnh → Lưu ảnh. Chúng tôi trích xuất nội dung, ghi nhớ nguồn và sắp xếp vào thư viện của bạn.'
  },
  ext_sec3_eyebrow: { en: 'Screenshots', vi: 'Ảnh màn hình' },
  ext_sec3_title: { en: 'Capture screenshots and crop exactly what matters.', vi: 'Chụp màn hình và cắt chính xác phần quan trọng.' },
  ext_sec3_body: {
    en: "Capture the visible tab, drag a rectangle, save. Screenshots go through OCR so a future text search can pull them out — even the words inside an image.",
    vi: 'Chụp tab đang xem, kéo khung chọn vùng mong muốn và lưu. Ảnh được nhận dạng chữ (OCR) giúp bạn tìm kiếm lại mọi từ ngữ bên trong ảnh.'
  },
  ext_sec4_eyebrow: { en: 'Context', vi: 'Ngữ cảnh' },
  ext_sec4_title: { en: 'Add context while you save.', vi: 'Thêm ngữ cảnh ngay khi lưu.' },
  ext_sec4_body: {
    en: 'Drop in a quick note before saving. Mnemonics keeps the note attached to the memory, so the next time you find it you remember why you saved it.',
    vi: 'Ghi chú nhanh vài dòng trước khi lưu. Mnemonics gắn liền ghi chú với ký ức để bạn luôn nhớ rõ lý do mình đã lưu lại.'
  },
  ext_sec5_eyebrow: { en: 'Recall', vi: 'Tìm lại' },
  ext_sec5_title: { en: 'Find it again through Mnemonics.', vi: 'Tìm lại mọi thứ qua Mnemonics.' },
  ext_sec5_body: {
    en: 'Your saves appear in the dashboard. Search by words, by tags, or by meaning — semantic recall surfaces memories even when the title no longer rings a bell.',
    vi: 'Mọi nội dung đã lưu hiển thị ngay trên dashboard. Tìm kiếm theo từ khóa, theo thẻ hoặc theo ý nghĩa — công nghệ AI giúp tìm lại ngay cả khi bạn quên mất tiêu đề.'
  },

  // Extended Upload Dialogs
  dialog_image_choose: { en: 'Choose image…', vi: 'Chọn ảnh…' },
  dialog_image_screenshot: { en: '📸 Screenshot', vi: '📸 Chụp màn hình' },
  dialog_image_drop_hint: { en: 'Drag and drop, paste screenshot (Ctrl+V) or click to browse', vi: 'Kéo thả, dán ảnh chụp (Ctrl+V) hoặc bấm để chọn ảnh' },
  dialog_image_drop_sub: { en: 'Supports JPEG, PNG, WebP (up to 10 MB). OCR text is extracted automatically.', vi: 'Hỗ trợ JPEG, PNG, WebP (tối đa 10 MB). Hệ thống tự động OCR & trích xuất chữ.' },
  dialog_image_change: { en: 'Change image', vi: 'Đổi ảnh' },
  dialog_image_title_label: { en: 'Title', vi: 'Tiêu đề' },
  dialog_image_note_label: { en: 'Notes (optional)', vi: 'Ghi chú (không bắt buộc)' },
  dialog_image_note_placeholder: { en: 'Notes about this image...', vi: 'Ghi chú về hình ảnh này...' },
  dialog_image_smart_tags: { en: '★ Smart Tags (Auto-suggested)', vi: '★ Thẻ thông minh (Tự động gợi ý)' },
  dialog_image_saved_ocr: { en: 'Saved — running OCR…', vi: 'Đã lưu — đang nhận dạng OCR…' },
  dialog_image_close: { en: 'Close', vi: 'Đóng' },
  dialog_image_size_error: { en: 'Image is too large. The maximum is 10 MB.', vi: 'Hình ảnh quá lớn. Kích thước tối đa là 10 MB.' },
  dialog_image_type_error: { en: 'Unsupported image type. Use JPEG, PNG, or WebP.', vi: 'Định dạng ảnh không được hỗ trợ. Vui lòng dùng JPEG, PNG hoặc WebP.' },
  dialog_doc_choose: { en: 'Choose file…', vi: 'Chọn tệp…' },
  dialog_doc_drop_hint: { en: 'Drag and drop or click to browse document', vi: 'Kéo thả hoặc bấm để chọn tệp tài liệu' },
  dialog_doc_drop_sub: { en: 'Supports PDF, DOCX, TXT (up to 20 MB). Text content is analyzed automatically.', vi: 'Hỗ trợ PDF, DOCX, TXT (tối đa 20 MB). Tự động phân tích nội dung văn bản.' },
  dialog_doc_change: { en: 'Change file', vi: 'Đổi tệp' },
  dialog_doc_title_label: { en: 'Title', vi: 'Tiêu đề' },
  dialog_doc_save_btn: { en: 'Save to Mnemonics', vi: 'Lưu vào Mnemonics' },
  dialog_doc_saved_status: { en: 'Saved — processing document…', vi: 'Đã lưu — đang xử lý tài liệu…' },
  dialog_doc_close: { en: 'Close', vi: 'Đóng' },

  // Extended Clusters & Groups
  clusters_error_title: { en: "We can't update groups right now", vi: 'Không thể cập nhật nhóm lúc này' },
  clusters_error_text: { en: 'Search, capture and Spaces continue to work. Try refreshing in a moment.', vi: 'Tìm kiếm, thu thập và Bộ sưu tập vẫn hoạt động bình thường. Vui lòng thử lại sau giây lát.' },
  clusters_load_error_title: { en: "We can't load this group", vi: 'Không thể tải nhóm này' },
  clusters_empty_group_title: { en: 'This group is empty', vi: 'Nhóm này đang trống' },
  clusters_empty_group_text: { en: 'It may have been recomputed. Try refreshing groups.', vi: 'Dữ liệu có thể vừa được tính toán lại. Hãy thử làm mới nhóm.' },
  clusters_back_btn: { en: 'Back to groups', vi: 'Quay lại danh sách nhóm' },
  clusters_untitled: { en: 'Untitled group', vi: 'Nhóm chưa đặt tên' },
  clusters_preview_empty: { en: 'Preview unavailable', vi: 'Không có bản xem trước' },
  clusters_showing_first: { en: 'showing first', vi: 'đang hiển thị' },
  clusters_updated: { en: 'Updated', vi: 'Đã cập nhật' },
  clusters_unclustered_one: { en: 'memory is not in any group yet.', vi: 'ghi nhớ chưa thuộc nhóm nào.' },
  clusters_unclustered_other: { en: 'memories are not in any group yet.', vi: 'ghi nhớ chưa thuộc nhóm nào.' },
  clusters_just_now: { en: 'just now', vi: 'vừa xong' },
  clusters_min_ago: { en: 'min ago', vi: 'phút trước' },
  clusters_h_ago: { en: 'h ago', vi: 'giờ trước' },
  clusters_recently: { en: 'recently', vi: 'gần đây' },

  // Structured Chips
  detected_article: { en: 'Articles', vi: 'Bài viết' },
  detected_product: { en: 'Products', vi: 'Sản phẩm' },
  detected_recipe: { en: 'Recipes', vi: 'Công thức' },
  detected_video: { en: 'Videos', vi: 'Video' },
  detected_quote: { en: 'Quotes', vi: 'Trích dẫn' },
  detected_highlight: { en: 'Highlights', vi: 'Điểm nhấn' },
  detected_webpage: { en: 'Webpages', vi: 'Trang web' },
  detected_image: { en: 'Images', vi: 'Hình ảnh' },
  detected_note: { en: 'Notes', vi: 'Ghi chú' },
  detected_document: { en: 'Documents', vi: 'Tài liệu' },
  detected_other: { en: 'Other', vi: 'Khác' },

  // Mobile Nav & Account Dropdown
  nav_mobile_capture: { en: 'Capture', vi: 'Thu thập' },
  nav_mobile_settings: { en: 'Settings', vi: 'Cài đặt' },
  menu_account_plans: { en: 'Account & Plans', vi: 'Tài khoản & Gói cước' },
  menu_analytics: { en: 'Analytics & Stats', vi: 'Thống kê phân tích' },
  menu_admin: { en: 'System Administration (Admin)', vi: 'Quản trị hệ thống (Admin)' },
  badge_active: { en: 'Active', vi: 'Đang hoạt động' },
  account_default_name: { en: 'Account', vi: 'Tài khoản' },
  account_unknown_email: { en: 'Unknown', vi: 'Chưa xác định' },

  // Not Found (404)
  not_found_eyebrow: { en: '404', vi: '404' },
  not_found_title: { en: 'This page slipped out of your library.', vi: 'Trang này không còn trong thư viện của bạn.' },
  not_found_lead: { en: "The URL you followed isn't a Mnemonics page. Try heading back home.", vi: 'Đường dẫn bạn truy cập không phải là trang của Mnemonics. Hãy quay về trang chủ.' },
  not_found_btn: { en: 'Back to homepage', vi: 'Về trang chủ' },

  // Auth Layout & Forms
  auth_back_home: { en: '← Back to home', vi: '← Về trang chủ' },
  auth_signup_eyebrow: { en: 'Get started', vi: 'Bắt đầu ngay' },
  auth_login_eyebrow: { en: 'Sign in', vi: 'Đăng nhập' },
  auth_signup_h1_1: { en: 'Save once.', vi: 'Lưu một lần.' },
  auth_signup_h1_2: { en: 'Remember anytime.', vi: 'Nhớ mọi lúc.' },
  auth_login_h1_1: { en: 'Welcome back', vi: 'Chào mừng bạn trở lại' },
  auth_login_h1_2: { en: 'to your second brain.', vi: 'với bộ não thứ hai.' },
  auth_signup_sub: {
    en: 'Start by adding Mnemonics to your browser. Your first memory is one click away.',
    vi: 'Bắt đầu bằng việc thêm Mnemonics vào trình duyệt. Ký ức đầu tiên chỉ cách một cú nhấp chuột.'
  },
  auth_login_sub: {
    en: 'Pick up where you left off. Continue with the extension or sign in below.',
    vi: 'Tiếp tục hành trình của bạn. Sử dụng tiện ích mở rộng hoặc đăng nhập bên dưới.'
  },
  auth_use_email_instead: { en: 'Use email instead', vi: 'Sử dụng email thay thế' },
  auth_continue_with_email: { en: 'Continue with email', vi: 'Tiếp tục với email' },
  auth_agree_prefix: { en: 'By continuing you agree to our', vi: 'Bằng cách tiếp tục, bạn đồng ý với' },
  auth_privacy_promise: { en: 'privacy promise', vi: 'cam kết quyền riêng tư' },
  auth_browser_compat: {
    en: 'Works on Chrome, Brave, Edge, and any Chromium-based browser.',
    vi: 'Hoạt động trên Chrome, Brave, Edge và mọi trình duyệt nhân Chromium.'
  },
  auth_signup_form_eyebrow: { en: 'Create account', vi: 'Tạo tài khoản' },
  auth_login_form_eyebrow: { en: 'Sign in with email', vi: 'Đăng nhập với email' },
  auth_signup_form_h1: { en: 'Just a few details.', vi: 'Chỉ vài bước đơn giản.' },
  auth_login_form_h1: { en: 'Welcome back.', vi: 'Chào mừng bạn trở lại.' },
  auth_already_have_acc: { en: 'Already have an account?', vi: 'Đã có tài khoản?' },
  auth_new_here: { en: 'New here?', vi: 'Chưa có tài khoản?' },
  auth_create_acc: { en: 'Create an account', vi: 'Tạo tài khoản mới' },
  auth_reset_password_title: { en: 'Reset your password', vi: 'Đặt lại mật khẩu' },
  auth_reset_password_lead: {
    en: "Enter your email and we'll send a link if the account exists.",
    vi: 'Nhập email của bạn và chúng tôi sẽ gửi liên kết nếu tài khoản tồn tại.'
  },

  // Marketing Demos
  privacy_footnote: {
    en: "We are not currently marketing end-to-end encryption, zero-knowledge storage, or any formal security certification. When those are real, we'll add them here.",
    vi: 'Hiện tại chúng tôi không quảng bá mã hóa đầu cuối hay chứng chỉ bảo mật hình thức. Khi tính năng hoàn thiện, chúng tôi sẽ cập nhật minh bạch tại đây.'
  },
  semantic_match_label: { en: 'match', vi: 'khớp' },

  // Space Detail & Badges
  btn_back_spaces: { en: 'Back to Spaces', vi: 'Quay lại Spaces' },
  space_edit_title: { en: 'Edit Space', vi: 'Chỉnh sửa Space' },
  space_name_label: { en: 'Name', vi: 'Tên Space' },
  space_color_label: { en: 'Colour', vi: 'Màu sắc' },
  space_kind_smart: { en: 'smart', vi: 'thông minh' },
  space_kind_manual: { en: 'manual', vi: 'thủ công' },

  // Session & Auth
  auth_session_expired: { en: 'Session expired', vi: 'Phiên đăng nhập đã hết hạn' },
  auth_session_expired_sub: { en: 'Please sign in again to continue.', vi: 'Vui lòng đăng nhập lại để tiếp tục.' },
  btn_signin: { en: 'Sign in', vi: 'Đăng nhập' },
  btn_close: { en: 'Close', vi: 'Đóng' },

  // Memory Card Extra
  card_why_matched: { en: 'Why this matched', vi: 'Lý do kết quả này phù hợp' },
  dialog_note_saved_proc: { en: 'Saved — processing…', vi: 'Đã lưu — đang xử lý…' },
  dialog_link_saved_proc: { en: 'Saved — processing…', vi: 'Đã lưu — đang xử lý…' },

  // Browser Selector & Extension Install Modal
  browser_status_soon: { en: 'Soon', vi: 'Sắp có' },
  browser_status_detected: { en: 'Detected', vi: 'Hiện tại' },
  browser_status_available: { en: 'Available', vi: 'Hỗ trợ' },
  modal_ext_title_chrome: { en: 'Chrome Web Store release coming soon.', vi: 'Bản phát hành Chrome Web Store sắp ra mắt.' },
  modal_ext_title_edge: { en: 'Microsoft Edge Add-ons release coming soon.', vi: 'Bản phát hành Microsoft Edge Add-ons sắp ra mắt.' },
  modal_ext_title_other: { en: 'Your browser is on the way.', vi: 'Phiên bản cho trình duyệt của bạn sắp ra mắt.' },
  modal_ext_desc_chrome: {
    en: 'We are finalising the Chrome Web Store review. In the meantime you can load the development build locally.',
    vi: 'Chúng tôi đang hoàn tất kiểm duyệt trên Chrome Web Store. Trong lúc này bạn có thể cài đặt bản phát triển trực tiếp.'
  },
  modal_ext_desc_edge: {
    en: 'We are finalising the Microsoft Edge Add-ons review. In the meantime you can load the development build locally.',
    vi: 'Chúng tôi đang hoàn tất kiểm duyệt trên Microsoft Edge Add-ons. Trong lúc này bạn có thể cài đặt bản phát triển trực tiếp.'
  },
  modal_ext_desc_other: {
    en: 'The Mnemonics extension is currently shipping on Chromium-based browsers. Firefox and Safari builds are in progress — sign in to the web app in the meantime to keep saving memories.',
    vi: 'Tiện ích Mnemonics hiện hỗ trợ các trình duyệt nhân Chromium. Bản cho Firefox và Safari đang phát triển — bạn có thể dùng ứng dụng web trong lúc này.'
  },
  modal_ext_dev_summary: { en: 'Load the development build', vi: 'Cài đặt bản phát triển (Developer build)' },
  modal_ext_step1: { en: 'Download or clone the Mnemonics repo.', vi: 'Tải về hoặc sao chép mã nguồn Mnemonics.' },
  modal_ext_step2: { en: 'Open in your browser:', vi: 'Mở trên trình duyệt:' },
  modal_ext_step3: { en: 'Enable Developer mode in the top right.', vi: 'Bật Chế độ nhà phát triển (Developer mode) ở góc trên bên phải.' },
  modal_ext_step4: { en: 'Click Load unpacked and select apps/extension.', vi: 'Nhấn Tải tiện ích đã giải nén (Load unpacked) và chọn thư mục apps/extension.' }
} as const;

export type TranslationKey = keyof typeof DICTIONARY;

export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'en' || stored === 'vi') {
      return stored;
    }
  } catch {
    // ignore
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi')) {
      return 'vi';
    }
  } catch {
    // ignore
  }

  return 'en';
}

export function applyLocale(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('data-locale', locale);
    if (document.body) {
      document.body.setAttribute('data-locale', locale);
    }
  }
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale());

  const setLocale = useCallback((nextLocale: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
      applyLocale(nextLocale);
    } catch {
      // ignore
    }
    setLocaleState(nextLocale);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(LOCALE_CHANGE_EVENT, { detail: { locale: nextLocale } })
      );
    }
  }, []);

  useEffect(() => {
    // Initial sync
    const current = getStoredLocale();
    applyLocale(current);
    setLocaleState(current);

    const handleLocaleChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ locale: Locale }>;
      if (customEvent.detail?.locale) {
        setLocaleState(customEvent.detail.locale);
      }
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY && (e.newValue === 'en' || e.newValue === 'vi')) {
        setLocaleState(e.newValue);
        applyLocale(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const t = useCallback(
    (key: TranslationKey | string, fallback?: string): string => {
      const entry = DICTIONARY[key as TranslationKey];
      if (entry && entry[locale]) {
        return entry[locale];
      }
      return fallback || key;
    },
    [locale]
  );

  return { locale, setLocale, t };
}
