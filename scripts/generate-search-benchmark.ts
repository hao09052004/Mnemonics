import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = path.join(process.cwd(), 'quality-gates', '.knowledge-regression');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Deterministic pseudo-random embedding generator based on text hash
function generateDeterministicEmbedding(text: string, dim = 1024): number[] {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const vec: number[] = new Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    h1 = Math.imul(h1 ^ (i + 1), 2246822507);
    h2 = Math.imul(h2 ^ (i + 1), 3266489909);
    const val = ((h1 ^ h2) % 10000) / 10000;
    vec[i] = val;
    norm += val * val;
  }
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

interface MemoryDoc {
  id: string;
  user_id: string;
  type: string;
  title: string;
  raw_text: string;
  ocr_text?: string;
  tags: string[];
  is_favorite?: boolean;
  category: string;
}

const corpus: MemoryDoc[] = [];

// 1. Vietnamese Tech & Software Engineering (40 docs)
const viTechTopics = [
  { t: "Kiến trúc Microservices với Node.js và RabbitMQ", b: "Mô hình kiến trúc phân tán microservices xử lý hàng đợi tin nhắn message queue, đảm bảo tính sẵn sàng cao và khả năng mở rộng ngang.", tags: ["microservices", "nodejs", "rabbitmq", "architecture"] },
  { t: "Tối ưu hóa truy vấn PostgreSQL và pgvector", b: "Hướng dẫn đánh chỉ mục HNSW và IVFFlat cho vector embeddings trong PostgreSQL. Giảm thời gian truy vấn kNN từ 500ms xuống còn 12ms.", tags: ["postgresql", "pgvector", "database", "tuning"] },
  { t: "Bảo mật ứng dụng Web chống tấn công SSRF", b: "Chặn Server-Side Request Forgery bằng cách xác thực địa chỉ IP phân giải, cấm dải IP private RFC 1918, loopback 127.0.0.1 và link-local 169.254.169.254.", tags: ["security", "ssrf", "backend"] },
  { t: "Tích hợp cổng thanh toán PayOS vào ứng dụng SaaS", b: "Quy trình xác thực chữ ký số HMAC-SHA256 khi nhận webhook từ PayOS. Xử lý idempotency tránh thanh toán trùng lặp khi kích hoạt gói thuê bao.", tags: ["payos", "payments", "saas", "webhook"] },
  { t: "Xây dựng hệ thống Second Brain quản lý tri thức cá nhân", b: "Nguyên lý PARA và Zettelkasten giúp lưu trữ ghi chú, tự động gắn thẻ bằng AI và tìm kiếm ngữ nghĩa nhanh chóng.", tags: ["pkm", "second-brain", "notes", "productivity"] },
  { t: "Hướng dẫn cài đặt và cấu hình Supabase RLS", b: "Row Level Security trong Supabase giúp cô lập dữ liệu giữa các người dùng (multi-tenant isolation). Chính sách SELECT, INSERT, UPDATE theo auth.uid().", tags: ["supabase", "rls", "security", "database"] },
  { t: "Lập trình TypeScript nâng cao: Generic Types và Utility", b: "Kỹ thuật sử dụng Conditional Types, Template Literal Types và Type Narrowing trong TypeScript để tạo ra codebase chặt chẽ, không có lỗi runtime.", tags: ["typescript", "programming", "frontend"] },
  { t: "Xử lý hàng đợi công việc không đồng bộ với PostgreSQL SKIP LOCKED", b: "Cơ chế claim job an toàn đa tiến trình bằng lệnh SELECT FOR UPDATE SKIP LOCKED kết hợp exponential backoff để tự phục hồi khi lỗi worker.", tags: ["queue", "postgresql", "reliability", "concurrency"] },
  { t: "Kỹ thuật RAG kết hợp Lexical và Semantic Search", b: "Thuật toán Reciprocal Rank Fusion (RRF) kết hợp kết quả tìm kiếm toàn văn BM25 và truy vấn vector tương đồng cosine 1024 chiều.", tags: ["rag", "search", "rrf", "embeddings"] },
  { t: "Tối ưu hóa hiệu năng React với useMemo và React.memo", b: "Giảm thiểu re-render không cần thiết trong ứng dụng React lớn, tối ưu hóa kích thước DOM và thời gian tương tác First Input Delay.", tags: ["react", "frontend", "performance"] }
];

// Replicate & expand Vietnamese Tech up to 40
for (let i = 0; i < 40; i++) {
  const base = viTechTopics[i % viTechTopics.length];
  corpus.push({
    id: `doc-vi-tech-${i + 1}`,
    user_id: "tenant-a",
    type: i % 3 === 0 ? "document" : "text",
    title: i < 10 ? base.t : `${base.t} (Phần ${Math.floor(i / 10) + 1})`,
    raw_text: `${base.b} Bổ sung chi tiết triển khai thực tế cho hệ thống tài liệu số ${i + 1}.`,
    tags: base.tags,
    category: "vietnamese_tech"
  });
}

// 2. Vietnamese Business, Finance & Administration (30 docs)
const viBizTopics = [
  { t: "Hóa đơn giá trị gia tăng điện tử số HD-2026-8892", b: "Hóa đơn VAT dịch vụ tư vấn giải pháp phần mềm trí tuệ nhân tạo. Tổng tiền thanh toán 45.000.000 VND. Thuế suất 10%.", ocr: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM - HÓA ĐƠN ĐIỆN TỬ MẪU SỐ 01GTKT0/001", tags: ["invoice", "vat", "finance"] },
  { t: "Hợp đồng lao động không xác định thời hạn", b: "Các điều khoản về bảo mật thông tin NDA, quyền sở hữu trí tuệ và nghĩa vụ bảo vệ dữ liệu khách hàng theo quy định pháp luật.", ocr: "ĐIỀU 5: NGHĨA VỤ BẢO MẬT THÔNG TIN VÀ SỞ HỮU TRÍ TUỆ", tags: ["contract", "legal", "hr"] },
  { t: "Biên bản nghiệm thu và bàn giao hệ thống", b: "Nghiệm thu triển khai tính năng tìm kiếm lai Hybrid Search và bảng điều khiển quản trị hệ thống Mnemonics hoàn thành đúng tiến độ.", ocr: "BIÊN BẢN NGHIỆM THU VÀ BÀN GIAO SẢN PHẨM PHẦN MỀM GIAI ĐOẠN 2", tags: ["handover", "acceptance", "project"] },
  { t: "Báo cáo tài chính quý 3 năm 2026", b: "Doanh thu dịch vụ SaaS tăng trưởng 120%, chi phí hạ tầng máy chủ AI được tối ưu nhờ batching và cache embedding.", tags: ["finance", "report", "saas"] },
  { t: "Chiến lược tiếp thị số Digital Marketing B2B", b: "Phân tích phễu chuyển đổi từ 38 lượt truy cập, 15 bắt đầu trải nghiệm, 6 hoàn thành phiên và 7 phản hồi tích cực.", tags: ["marketing", "funnel", "growth"] }
];

for (let i = 0; i < 30; i++) {
  const base = viBizTopics[i % viBizTopics.length];
  corpus.push({
    id: `doc-vi-biz-${i + 1}`,
    user_id: "tenant-a",
    type: base.ocr ? "image" : "document",
    title: i < 5 ? base.t : `${base.t} số ${i + 1}`,
    raw_text: `${base.b} Tài liệu lưu trữ nghiệp vụ số ${i + 1}.`,
    ocr_text: base.ocr ? `${base.ocr} - Mã tài liệu: DOC-${i + 1}` : undefined,
    tags: base.tags,
    category: "vietnamese_business"
  });
}

// 3. English Distributed Systems & Architecture (40 docs)
const enTechTopics = [
  { t: "Raft Consensus Algorithm Implementation Details", b: "Leader election, log replication, and safety invariants in distributed state machine consensus algorithms like Raft and Paxos.", tags: ["distributed-systems", "raft", "consensus"] },
  { t: "Zero-Trust Architecture and Mutual TLS Verification", b: "Principles of continuous verification, ephemeral credentials, service-to-service authentication using mTLS, and RBAC enforcement.", tags: ["security", "zero-trust", "mtls", "auth"] },
  { t: "Vector Search Quality: Cosine Similarity vs Inner Product", b: "Mathematical properties of L2 normalized vectors where cosine similarity equals inner product, speeding up pgvector query evaluation.", tags: ["vector-search", "embeddings", "math", "pgvector"] },
  { t: "Kubernetes Pod Autoscaling and Graceful Termination", b: "Handling SIGTERM signals, connection draining, readiness probe timeouts, and horizontal pod autoscaler algorithms under bursty workloads.", tags: ["kubernetes", "devops", "cloud", "reliability"] },
  { t: "SSRF Attack Mitigation via DNS Resolution Validation", b: "Preventing server-side request forgery by resolving hostnames before HTTP dispatch and rejecting private IP ranges RFC 1918 and cloud metadata endpoints.", tags: ["security", "ssrf", "network", "proxy"] },
  { t: "Token Bucket vs Leaky Bucket Rate Limiting Algorithms", b: "Comparative analysis of sliding window counter and token bucket rate limiters in multi-instance distributed APIs backed by Redis or PostgreSQL.", tags: ["rate-limiting", "algorithms", "scalability"] },
  { t: "Designing Idempotent RESTful APIs with Idempotency-Key", b: "Using unique idempotency keys in payment processing and mutating POST requests to prevent double charging on client retries.", tags: ["api-design", "idempotency", "payments"] },
  { t: "Database Indexing Strategies: B-Tree, GIN, and HNSW", b: "Trade-offs between Generalized Inverted Indexes for full-text search and Hierarchical Navigable Small World graphs for high-dimensional vector search.", tags: ["database", "indexing", "postgresql"] },
  { t: "Observability SLOs: Tracking p50, p95, and p99 Latencies", b: "Building reliable service level objectives using percentiles instead of averages to detect long-tail degradation and queue head-of-line blocking.", tags: ["observability", "sre", "metrics", "latency"] },
  { t: "Cross-Tenant Data Isolation and Security Auditing", b: "Preventing cross-tenant data leakage in multi-tenant SaaS architectures through strict server-side authorization and Row Level Security validation.", tags: ["security", "multi-tenant", "isolation", "audit"] }
];

for (let i = 0; i < 40; i++) {
  const base = enTechTopics[i % enTechTopics.length];
  corpus.push({
    id: `doc-en-tech-${i + 1}`,
    user_id: "tenant-a",
    type: "document",
    title: i < 10 ? base.t : `${base.t} - Vol ${Math.floor(i / 10) + 1}`,
    raw_text: `${base.b} Engineering reference architecture and deep-dive documentation #${i + 1}.`,
    tags: base.tags,
    category: "english_tech"
  });
}

// 4. English Business, Research & Notes (30 docs)
const enBizTopics = [
  { t: "SaaS Financial Metrics: CAC, LTV, and Churn Rate", b: "Formulas and tracking methodologies for Customer Acquisition Cost, Lifetime Value, Net Revenue Retention, and monthly churn rates.", tags: ["saas", "finance", "metrics"] },
  { t: "Product Management: OKRs vs KPIs in Agile Squads", b: "Setting ambitious Objectives and Key Results while maintaining operational Key Performance Indicators across cross-functional engineering teams.", tags: ["product", "management", "agile"] },
  { t: "User Privacy Disclosures and GDPR/CCPA Compliance", b: "Requirements for truthful privacy notices, explicit opt-out consent mechanisms for cloud AI processing, and data minimization practices.", tags: ["privacy", "gdpr", "compliance", "legal"] },
  { t: "Executive Summary: Cloud Infrastructure Cost Optimization", b: "Achieving 40% reduction in monthly cloud expenditure by rightsizing container instances, reserving database instances, and caching LLM embeddings.", tags: ["cloud", "finops", "aws", "costs"] },
  { t: "Human-in-the-Loop AI: Active Learning and Annotation", b: "Design patterns for collecting human corrections to refine classifier predictions and establish trustworthy retrieval benchmarks.", tags: ["ai", "human-in-the-loop", "evaluation"] }
];

for (let i = 0; i < 30; i++) {
  const base = enBizTopics[i % enBizTopics.length];
  corpus.push({
    id: `doc-en-biz-${i + 1}`,
    user_id: "tenant-a",
    type: "text",
    title: i < 5 ? base.t : `${base.t} (${i + 1})`,
    raw_text: `${base.b} Strategic executive briefing and operational notes #${i + 1}.`,
    tags: base.tags,
    category: "english_business"
  });
}

// 5. OCR & Image Text Extraction Documents (20 docs)
for (let i = 0; i < 20; i++) {
  corpus.push({
    id: `doc-ocr-${i + 1}`,
    user_id: "tenant-a",
    type: "image",
    title: `Scanned Receipt & Whiteboard Capture #${i + 1}`,
    raw_text: `Screenshot capture taken from mobile device showing architectural diagrams and invoice receipt #${i + 1}.`,
    ocr_text: `RECEIPT TOTAL: $${(i * 15 + 45).toFixed(2)} USD. VENDOR: TECH SUPPLIES GLOBAL. TRANSACTION CODE: TX-${1000 + i}. STATUS: APPROVED.`,
    tags: ["ocr", "receipt", "screenshot"],
    category: "ocr_image"
  });
}

// 6. PDF Multi-Section Chunks (20 docs)
for (let i = 0; i < 20; i++) {
  corpus.push({
    id: `doc-pdf-chunk-${i + 1}`,
    user_id: "tenant-a",
    type: "document",
    title: `Comprehensive Annual Filing Report - Section ${i + 1}`,
    raw_text: `Article ${i + 1}.4 Clause B: The company commits to maintaining strict zero-trust network boundaries and 99.9% service uptime for all subscribed enterprise accounts.`,
    tags: ["pdf", "report", "compliance"],
    category: "pdf_chunks"
  });
}

// 7. Tenant-B Isolated Private Documents (20 docs)
for (let i = 0; i < 20; i++) {
  corpus.push({
    id: `doc-tenant-b-${i + 1}`,
    user_id: "tenant-b",
    type: "text",
    title: `Confidential Internal Strategy for Tenant B #${i + 1}`,
    raw_text: `Strictly confidential notes belonging exclusively to tenant-b organization. Secret project code: ZEPHYR-${i + 1}. Must NEVER be visible to tenant-a queries.`,
    tags: ["confidential", "tenant-b", "private"],
    category: "tenant_b_isolated"
  });
}

// Write corpus to corpus.jsonl with deterministic embeddings
const corpusLines = corpus.map((doc) => {
  const fullText = `${doc.title} ${doc.raw_text} ${doc.ocr_text || ''} ${doc.tags.join(' ')}`;
  const embedding = generateDeterministicEmbedding(fullText);
  return JSON.stringify({ ...doc, embedding });
});

fs.writeFileSync(path.join(OUT_DIR, 'corpus.jsonl'), corpusLines.join('\n') + '\n', 'utf8');

// Build 100 Labelled Queries (10 per category)
interface GoldenQuery {
  id: string;
  category: string;
  query: string;
  tenant: string;
  tenant_other?: string;
  expected: string[];
}

const queries: GoldenQuery[] = [];

// Category 1: Vietnamese Exact (10)
queries.push(
  { id: "q-vi-exact-1", category: "vietnamese_exact", query: "Kiến trúc Microservices với Node.js", tenant: "tenant-a", expected: ["doc-vi-tech-1", "doc-vi-tech-11"] },
  { id: "q-vi-exact-2", category: "vietnamese_exact", query: "Tối ưu hóa truy vấn PostgreSQL và pgvector", tenant: "tenant-a", expected: ["doc-vi-tech-2", "doc-vi-tech-12"] },
  { id: "q-vi-exact-3", category: "vietnamese_exact", query: "Bảo mật ứng dụng Web chống tấn công SSRF", tenant: "tenant-a", expected: ["doc-vi-tech-3", "doc-vi-tech-13"] },
  { id: "q-vi-exact-4", category: "vietnamese_exact", query: "Tích hợp cổng thanh toán PayOS", tenant: "tenant-a", expected: ["doc-vi-tech-4", "doc-vi-tech-14"] },
  { id: "q-vi-exact-5", category: "vietnamese_exact", query: "Xây dựng hệ thống Second Brain quản lý tri thức", tenant: "tenant-a", expected: ["doc-vi-tech-5", "doc-vi-tech-15"] },
  { id: "q-vi-exact-6", category: "vietnamese_exact", query: "Hướng dẫn cài đặt và cấu hình Supabase RLS", tenant: "tenant-a", expected: ["doc-vi-tech-6", "doc-vi-tech-16"] },
  { id: "q-vi-exact-7", category: "vietnamese_exact", query: "Generic Types và Utility trong TypeScript", tenant: "tenant-a", expected: ["doc-vi-tech-7", "doc-vi-tech-17"] },
  { id: "q-vi-exact-8", category: "vietnamese_exact", query: "PostgreSQL SKIP LOCKED hàng đợi công việc", tenant: "tenant-a", expected: ["doc-vi-tech-8", "doc-vi-tech-18"] },
  { id: "q-vi-exact-9", category: "vietnamese_exact", query: "Reciprocal Rank Fusion kết hợp Lexical và Semantic", tenant: "tenant-a", expected: ["doc-vi-tech-9", "doc-vi-tech-19"] },
  { id: "q-vi-exact-10", category: "vietnamese_exact", query: "Tối ưu hóa hiệu năng React useMemo", tenant: "tenant-a", expected: ["doc-vi-tech-10", "doc-vi-tech-20"] }
);

// Category 2: Vietnamese Long Natural Language (10)
queries.push(
  { id: "q-vi-long-1", category: "vietnamese_natural_long", query: "Làm thế nào để xây dựng hệ thống kiến trúc microservices chịu tải cao với nodejs và rabbitmq?", tenant: "tenant-a", expected: ["doc-vi-tech-1", "doc-vi-tech-11", "doc-vi-tech-21"] },
  { id: "q-vi-long-2", category: "vietnamese_natural_long", query: "Cách tối ưu hóa tốc độ tìm kiếm vector trong postgresql bằng chỉ mục hnsw", tenant: "tenant-a", expected: ["doc-vi-tech-2", "doc-vi-tech-12", "doc-vi-tech-22"] },
  { id: "q-vi-long-3", category: "vietnamese_natural_long", query: "Các biện pháp phòng chống tấn công ssrf chặn ip private và cloud metadata", tenant: "tenant-a", expected: ["doc-vi-tech-3", "doc-vi-tech-13", "doc-vi-tech-23"] },
  { id: "q-vi-long-4", category: "vietnamese_natural_long", query: "Xử lý webhook thanh toán payos an toàn tránh thanh toán trùng lặp bằng idempotency", tenant: "tenant-a", expected: ["doc-vi-tech-4", "doc-vi-tech-14", "doc-vi-tech-24"] },
  { id: "q-vi-long-5", category: "vietnamese_natural_long", query: "Phương pháp tổ chức ghi chú cá nhân theo zettelkasten và para second brain", tenant: "tenant-a", expected: ["doc-vi-tech-5", "doc-vi-tech-15", "doc-vi-tech-25"] },
  { id: "q-vi-long-6", category: "vietnamese_natural_long", query: "Thiết lập phân quyền bảo vệ dữ liệu người dùng đa người thuê với supabase row level security", tenant: "tenant-a", expected: ["doc-vi-tech-6", "doc-vi-tech-16"] },
  { id: "q-vi-long-7", category: "vietnamese_natural_long", query: "Kỹ thuật lập trình typescript nâng cao tránh lỗi runtime khi phát triển ứng dụng", tenant: "tenant-a", expected: ["doc-vi-tech-7", "doc-vi-tech-17"] },
  { id: "q-vi-long-8", category: "vietnamese_natural_long", query: "Triển khai hàng đợi xử lý ngầm đa tiến trình an toàn bằng postgresql skip locked", tenant: "tenant-a", expected: ["doc-vi-tech-8", "doc-vi-tech-18"] },
  { id: "q-vi-long-9", category: "vietnamese_natural_long", query: "Thuật toán dung hợp xếp hạng nghịch đảo rrf trong hệ thống rag tìm kiếm lai", tenant: "tenant-a", expected: ["doc-vi-tech-9", "doc-vi-tech-19"] },
  { id: "q-vi-long-10", category: "vietnamese_natural_long", query: "Hướng dẫn giảm số lần render lại không cần thiết trong ứng dụng react", tenant: "tenant-a", expected: ["doc-vi-tech-10", "doc-vi-tech-20"] }
);

// Category 3: English Exact (10)
queries.push(
  { id: "q-en-exact-1", category: "english_exact", query: "Raft Consensus Algorithm", tenant: "tenant-a", expected: ["doc-en-tech-1", "doc-en-tech-11"] },
  { id: "q-en-exact-2", category: "english_exact", query: "Zero-Trust Architecture mTLS", tenant: "tenant-a", expected: ["doc-en-tech-2", "doc-en-tech-12"] },
  { id: "q-en-exact-3", category: "english_exact", query: "Vector Search Cosine Similarity", tenant: "tenant-a", expected: ["doc-en-tech-3", "doc-en-tech-13"] },
  { id: "q-en-exact-4", category: "english_exact", query: "Kubernetes Pod Autoscaling", tenant: "tenant-a", expected: ["doc-en-tech-4", "doc-en-tech-14"] },
  { id: "q-en-exact-5", category: "english_exact", query: "SSRF Attack Mitigation DNS Validation", tenant: "tenant-a", expected: ["doc-en-tech-5", "doc-en-tech-15"] },
  { id: "q-en-exact-6", category: "english_exact", query: "Token Bucket Rate Limiting Algorithms", tenant: "tenant-a", expected: ["doc-en-tech-6", "doc-en-tech-16"] },
  { id: "q-en-exact-7", category: "english_exact", query: "Idempotent RESTful APIs Idempotency-Key", tenant: "tenant-a", expected: ["doc-en-tech-7", "doc-en-tech-17"] },
  { id: "q-en-exact-8", category: "english_exact", query: "Database Indexing Strategies B-Tree HNSW", tenant: "tenant-a", expected: ["doc-en-tech-8", "doc-en-tech-18"] },
  { id: "q-en-exact-9", category: "english_exact", query: "Observability SLOs Tracking p50 p95 p99", tenant: "tenant-a", expected: ["doc-en-tech-9", "doc-en-tech-19"] },
  { id: "q-en-exact-10", category: "english_exact", query: "Cross-Tenant Data Isolation Security Auditing", tenant: "tenant-a", expected: ["doc-en-tech-10", "doc-en-tech-20"] }
);

// Category 4: English Long Natural Language (10)
queries.push(
  { id: "q-en-long-1", category: "english_natural_long", query: "How does the Raft distributed consensus protocol handle leader election during network partitions?", tenant: "tenant-a", expected: ["doc-en-tech-1", "doc-en-tech-11"] },
  { id: "q-en-long-2", category: "english_natural_long", query: "Implementing zero-trust security with mutual tls verification between microservices", tenant: "tenant-a", expected: ["doc-en-tech-2", "doc-en-tech-12"] },
  { id: "q-en-long-3", category: "english_natural_long", query: "Why is inner product mathematically equivalent to cosine distance for normalized vector embeddings?", tenant: "tenant-a", expected: ["doc-en-tech-3", "doc-en-tech-13"] },
  { id: "q-en-long-4", category: "english_natural_long", query: "Best practices for graceful termination and connection draining in kubernetes pods", tenant: "tenant-a", expected: ["doc-en-tech-4", "doc-en-tech-14"] },
  { id: "q-en-long-5", category: "english_natural_long", query: "Mitigating server side request forgery by validating resolved ip addresses against rfc1918", tenant: "tenant-a", expected: ["doc-en-tech-5", "doc-en-tech-15"] },
  { id: "q-en-long-6", category: "english_natural_long", query: "Comparing sliding window counter and token bucket rate limiters for multi instance deployment", tenant: "tenant-a", expected: ["doc-en-tech-6", "doc-en-tech-16"] },
  { id: "q-en-long-7", category: "english_natural_long", query: "How to ensure payments and mutating operations are idempotent using client supplied idempotency keys", tenant: "tenant-a", expected: ["doc-en-tech-7", "doc-en-tech-17"] },
  { id: "q-en-long-8", category: "english_natural_long", query: "When to choose hnsw vector indexes over traditional gin inverted index for hybrid search", tenant: "tenant-a", expected: ["doc-en-tech-8", "doc-en-tech-18"] },
  { id: "q-en-long-9", category: "english_natural_long", query: "Setting realistic service level objectives by monitoring 99th percentile request latencies", tenant: "tenant-a", expected: ["doc-en-tech-9", "doc-en-tech-19"] },
  { id: "q-en-long-10", category: "english_natural_long", query: "Verifying multi tenant data isolation to guarantee cross user queries return zero records", tenant: "tenant-a", expected: ["doc-en-tech-10", "doc-en-tech-20"] }
);

// Category 5: Paraphrases (No exact keywords) (10)
queries.push(
  { id: "q-para-1", category: "paraphrases", query: "organizing thoughts into a digital second mind", tenant: "tenant-a", expected: ["doc-vi-tech-5", "doc-vi-tech-15"] },
  { id: "q-para-2", category: "paraphrases", query: "distributed state machine replication with vote quorum", tenant: "tenant-a", expected: ["doc-en-tech-1", "doc-en-tech-11"] },
  { id: "q-para-3", category: "paraphrases", query: "preventing internal network exploration via external image urls", tenant: "tenant-a", expected: ["doc-vi-tech-3", "doc-en-tech-5"] },
  { id: "q-para-4", category: "paraphrases", query: "avoiding duplicate customer billing on connection dropout", tenant: "tenant-a", expected: ["doc-vi-tech-4", "doc-en-tech-7"] },
  { id: "q-para-5", category: "paraphrases", query: "combining keyword score and vector similarity score", tenant: "tenant-a", expected: ["doc-vi-tech-9", "doc-vi-tech-19"] },
  { id: "q-para-6", category: "paraphrases", query: "speeding up nearest neighbor embedding lookup in sql", tenant: "tenant-a", expected: ["doc-vi-tech-2", "doc-en-tech-3"] },
  { id: "q-para-7", category: "paraphrases", query: "ensuring tenant data never leaks to unauthorized callers", tenant: "tenant-a", expected: ["doc-vi-tech-6", "doc-en-tech-10"] },
  { id: "q-para-8", category: "paraphrases", query: "throttling abusive client traffic across cluster servers", tenant: "tenant-a", expected: ["doc-en-tech-6", "doc-en-tech-16"] },
  { id: "q-para-9", category: "paraphrases", query: "detecting tail latency spikes in critical production routes", tenant: "tenant-a", expected: ["doc-en-tech-9", "doc-en-tech-19"] },
  { id: "q-para-10", category: "paraphrases", query: "safe async background task distribution without duplicates", tenant: "tenant-a", expected: ["doc-vi-tech-8", "doc-vi-tech-18"] }
);

// Category 6: Synonyms (10)
queries.push(
  { id: "q-syn-1", category: "synonyms", query: "cơ chế đồng thuận phân tán raft paxos", tenant: "tenant-a", expected: ["doc-en-tech-1", "doc-en-tech-11"] },
  { id: "q-syn-2", category: "synonyms", query: "tinh chỉnh hiệu năng truy vấn cơ sở dữ liệu quan hệ", tenant: "tenant-a", expected: ["doc-vi-tech-2", "doc-vi-tech-12"] },
  { id: "q-syn-3", category: "synonyms", query: "bảo vệ cổng thông tin khỏi lỗ hổng ssrf proxy", tenant: "tenant-a", expected: ["doc-vi-tech-3", "doc-en-tech-5"] },
  { id: "q-syn-4", category: "synonyms", query: "xử lý thanh toán trực tuyến payos vn", tenant: "tenant-a", expected: ["doc-vi-tech-4", "doc-vi-tech-14"] },
  { id: "q-syn-5", category: "synonyms", query: "quản trị kho lưu trữ tri thức bộ não thứ hai", tenant: "tenant-a", expected: ["doc-vi-tech-5", "doc-vi-tech-15"] },
  { id: "q-syn-6", category: "synonyms", query: "kiểm soát truy cập phân quyền cấp hàng rls", tenant: "tenant-a", expected: ["doc-vi-tech-6", "doc-en-tech-10"] },
  { id: "q-syn-7", category: "synonyms", query: "kiểu dữ liệu tĩnh typescript lập trình web", tenant: "tenant-a", expected: ["doc-vi-tech-7", "doc-vi-tech-17"] },
  { id: "q-syn-8", category: "synonyms", query: "hàng đợi tác vụ ngầm tránh xung đột khóa hàng", tenant: "tenant-a", expected: ["doc-vi-tech-8", "doc-vi-tech-18"] },
  { id: "q-syn-9", category: "synonyms", query: "hợp nhất thứ hạng tìm kiếm từ khóa và ngữ nghĩa rrf", tenant: "tenant-a", expected: ["doc-vi-tech-9", "doc-vi-tech-19"] },
  { id: "q-syn-10", category: "synonyms", query: "tối ưu thời gian phản hồi giao diện người dùng frontend", tenant: "tenant-a", expected: ["doc-vi-tech-10", "doc-vi-tech-20"] }
);

// Category 7: Typographical Errors (10)
queries.push(
  { id: "q-typo-1", category: "typographical_errors", query: "kien truc microserives nodejs rabbitmq", tenant: "tenant-a", expected: ["doc-vi-tech-1", "doc-vi-tech-11"] },
  { id: "q-typo-2", category: "typographical_errors", query: "toi uu hoa truy van postgre sql pgvectr", tenant: "tenant-a", expected: ["doc-vi-tech-2", "doc-vi-tech-12"] },
  { id: "q-typo-3", category: "typographical_errors", query: "bao mat chong tan cong ssfr loopbck", tenant: "tenant-a", expected: ["doc-vi-tech-3", "doc-en-tech-5"] },
  { id: "q-typo-4", category: "typographical_errors", query: "tich hop cong thanhtoan payos saas", tenant: "tenant-a", expected: ["doc-vi-tech-4", "doc-vi-tech-14"] },
  { id: "q-typo-5", category: "typographical_errors", query: "second brin quan ly tri thuc ca nhan", tenant: "tenant-a", expected: ["doc-vi-tech-5", "doc-vi-tech-15"] },
  { id: "q-typo-6", category: "typographical_errors", query: "supabse row level securty rls policy", tenant: "tenant-a", expected: ["doc-vi-tech-6", "doc-vi-tech-16"] },
  { id: "q-typo-7", category: "typographical_errors", query: "typesscript generic types condtional", tenant: "tenant-a", expected: ["doc-vi-tech-7", "doc-vi-tech-17"] },
  { id: "q-typo-8", category: "typographical_errors", query: "postgreqsl for updat skip locked job queue", tenant: "tenant-a", expected: ["doc-vi-tech-8", "doc-vi-tech-18"] },
  { id: "q-typo-9", category: "typographical_errors", query: "recipocal rank fusin hybrid serch", tenant: "tenant-a", expected: ["doc-vi-tech-9", "doc-vi-tech-19"] },
  { id: "q-typo-10", category: "typographical_errors", query: "reack useMemo re-render fid latency", tenant: "tenant-a", expected: ["doc-vi-tech-10", "doc-vi-tech-20"] }
);

// Category 8: OCR & Image Extracted Text (10)
queries.push(
  { id: "q-ocr-1", category: "ocr_image", query: "Hóa đơn VAT tổng tiền thanh toán 45.000.000", tenant: "tenant-a", expected: ["doc-vi-biz-1", "doc-vi-biz-6"] },
  { id: "q-ocr-2", category: "ocr_image", query: "Hợp đồng lao động nghĩa vụ bảo mật thông tin", tenant: "tenant-a", expected: ["doc-vi-biz-2", "doc-vi-biz-7"] },
  { id: "q-ocr-3", category: "ocr_image", query: "Biên bản nghiệm thu bàn giao phần mềm giai đoạn 2", tenant: "tenant-a", expected: ["doc-vi-biz-3", "doc-vi-biz-8"] },
  { id: "q-ocr-4", category: "ocr_image", query: "VENDOR TECH SUPPLIES GLOBAL RECEIPT TOTAL", tenant: "tenant-a", expected: ["doc-ocr-1", "doc-ocr-2"] },
  { id: "q-ocr-5", category: "ocr_image", query: "TRANSACTION CODE TX-1005 STATUS APPROVED", tenant: "tenant-a", expected: ["doc-ocr-6"] },
  { id: "q-ocr-6", category: "ocr_image", query: "Hóa đơn điện tử mẫu số 01GTKT0/001", tenant: "tenant-a", expected: ["doc-vi-biz-1", "doc-vi-biz-6"] },
  { id: "q-ocr-7", category: "ocr_image", query: "Điều khoản bảo mật NDA sở hữu trí tuệ", tenant: "tenant-a", expected: ["doc-vi-biz-2", "doc-vi-biz-7"] },
  { id: "q-ocr-8", category: "ocr_image", query: "Nghiệm thu triển khai tính năng tìm kiếm lai", tenant: "tenant-a", expected: ["doc-vi-biz-3", "doc-vi-biz-8"] },
  { id: "q-ocr-9", category: "ocr_image", query: "Scanned Receipt Whiteboard mobile capture", tenant: "tenant-a", expected: ["doc-ocr-1", "doc-ocr-2", "doc-ocr-3"] },
  { id: "q-ocr-10", category: "ocr_image", query: "Phần mềm Mnemonics bảng điều khiển quản trị", tenant: "tenant-a", expected: ["doc-vi-biz-3", "doc-vi-biz-8"] }
);

// Category 9: PDF Section Chunks (10)
queries.push(
  { id: "q-pdf-1", category: "pdf_chunks", query: "Annual Filing Report Section 1 zero-trust", tenant: "tenant-a", expected: ["doc-pdf-chunk-1"] },
  { id: "q-pdf-2", category: "pdf_chunks", query: "Clause B 99.9% service uptime enterprise accounts", tenant: "tenant-a", expected: ["doc-pdf-chunk-2", "doc-pdf-chunk-3"] },
  { id: "q-pdf-3", category: "pdf_chunks", query: "Article 5.4 strict network boundaries", tenant: "tenant-a", expected: ["doc-pdf-chunk-5"] },
  { id: "q-pdf-4", category: "pdf_chunks", query: "Article 8.4 Clause B enterprise commitments", tenant: "tenant-a", expected: ["doc-pdf-chunk-8"] },
  { id: "q-pdf-5", category: "pdf_chunks", query: "Comprehensive Annual Filing Report Section 10", tenant: "tenant-a", expected: ["doc-pdf-chunk-10"] },
  { id: "q-pdf-6", category: "pdf_chunks", query: "Article 12.4 Clause B uptime SLA", tenant: "tenant-a", expected: ["doc-pdf-chunk-12"] },
  { id: "q-pdf-7", category: "pdf_chunks", query: "Annual Filing Report Section 15 compliance", tenant: "tenant-a", expected: ["doc-pdf-chunk-15"] },
  { id: "q-pdf-8", category: "pdf_chunks", query: "Article 18.4 Clause B network security", tenant: "tenant-a", expected: ["doc-pdf-chunk-18"] },
  { id: "q-pdf-9", category: "pdf_chunks", query: "Comprehensive Annual Filing Report Section 20", tenant: "tenant-a", expected: ["doc-pdf-chunk-20"] },
  { id: "q-pdf-10", category: "pdf_chunks", query: "zero-trust network boundaries 99.9% service uptime", tenant: "tenant-a", expected: ["doc-pdf-chunk-1", "doc-pdf-chunk-2"] }
);

// Category 10: Cross-Tenant Isolation (Must return ZERO documents from tenant-b) (10)
queries.push(
  { id: "q-iso-1", category: "cross_tenant_isolation", query: "Confidential Internal Strategy for Tenant B", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-2", category: "cross_tenant_isolation", query: "Secret project code ZEPHYR-1", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-3", category: "cross_tenant_isolation", query: "Strictly confidential notes belonging exclusively to tenant-b", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-4", category: "cross_tenant_isolation", query: "ZEPHYR-5 secret roadmap", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-5", category: "cross_tenant_isolation", query: "Tenant B private organizational files", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-6", category: "cross_tenant_isolation", query: "project code ZEPHYR-10", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-7", category: "cross_tenant_isolation", query: "tenant-b confidential strategy 15", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-8", category: "cross_tenant_isolation", query: "ZEPHYR-18 exclusive document", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-9", category: "cross_tenant_isolation", query: "secret project zephyr tenant-b", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] },
  { id: "q-iso-10", category: "cross_tenant_isolation", query: "tenant-b private internal memos", tenant: "tenant-a", tenant_other: "tenant-b", expected: [] }
);

const goldenLines = queries.map((q) => JSON.stringify(q));
fs.writeFileSync(path.join(OUT_DIR, 'golden.jsonl'), goldenLines.join('\n') + '\n', 'utf8');

console.log(`Generated benchmark: ${corpus.length} corpus memories in corpus.jsonl, ${queries.length} golden queries in golden.jsonl.`);
