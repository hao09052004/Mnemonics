#!/usr/bin/env node
/**
 * AI & Core Features Speed Benchmark — Mnemonics
 *
 * Measures latency, percentiles (p50, p95, p99), and throughput (ops/sec)
 * across 10 functional groups of the AI and search engine pipeline.
 * Runs completely locally with deterministic/in-memory providers.
 *
 * Usage: npx.cmd tsx scripts/benchmark-speed.mts
 */

import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";

// ─── Benchmark harness ──────────────────────────────────────────
export interface BenchResult {
  group: string;
  name: string;
  iterations: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSec: number;
}

function round(n: number, decimals = 3): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

async function bench(
  group: string,
  name: string,
  fn: () => void | Promise<void>,
  iterations = 100
): Promise<BenchResult> {
  // Warmup run
  for (let i = 0; i < Math.min(5, iterations); i++) {
    await fn();
  }

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const totalMs = times.reduce((acc, t) => acc + t, 0);

  return {
    group,
    name,
    iterations,
    avgMs: round(totalMs / iterations),
    minMs: round(times[0]),
    maxMs: round(times[times.length - 1]),
    p50Ms: round(times[Math.floor(iterations * 0.5)]),
    p95Ms: round(times[Math.floor(iterations * 0.95)]),
    p99Ms: round(times[Math.floor(iterations * 0.99)]),
    opsPerSec: round(iterations / (totalMs / 1000), 1),
  };
}

// ─── Test Corpus ────────────────────────────────────────────────
const SHORT_TEXT = "Mnemonics is a personal knowledge management SaaS. Save once, find anytime.";

const MEDIUM_TEXT = `
Mnemonics is a personal-knowledge-management SaaS ("Second Brain"):
browser-extension capture -> API -> OCR + auto-tagging + embeddings ->
Web dashboard with keyword and semantic search.

Features include: Capture text, links, screenshots, images, and documents.
OCR via Tesseract and Gemini Vision. Auto-tagging with Gemini LLM.
Semantic search via pgvector with RRF reranking. Smart Spaces for
dynamic content grouping. Content Clusters for automatic topic
detection. Knowledge graph with related items.

The system uses a job queue pipeline: capture -> pending -> OCR -> tag ->
embed -> ready. Each step is idempotent and fault-tolerant.
`.trim();

const LONG_TEXT = Array(50).fill(MEDIUM_TEXT).join("\n\n");

const ARTICLE_TEXT = `
Machine learning is a subset of artificial intelligence that provides systems
the ability to automatically learn and improve from experience without being
explicitly programmed. Machine learning focuses on the development of computer
programs that can access data and use it to learn for themselves. The process
of learning begins with observations or data, such as examples, direct experience,
or instruction, in order to look for patterns in data and make better decisions
in the future based on the examples that we provide.
`.trim();

// ─── Main benchmark execution ───────────────────────────────────
async function main() {
  console.log("═════════════════════════════════════════════════════════════════════");
  console.log("  ⚡ MNEMONICS AI & CORE FEATURES SPEED BENCHMARK");
  console.log("═════════════════════════════════════════════════════════════════════\n");

  const results: BenchResult[] = [];

  // Setup env for local benchmarking
  process.env.AI_FREE_ONLY = "true";
  process.env.AI_TEXT_PROVIDER = "heuristic";
  process.env.AI_EMBEDDING_PROVIDER = "noop";
  process.env.OCR_PROVIDER = "tesseract";
  process.env.VISUAL_EMBEDDING_PROVIDER = "local";
  process.env.AI_TLDR_PROVIDER = "deterministic";
  process.env.AI_IMAGE_DESCRIPTION_PROVIDER = "local";
  process.env.OCR_LOCAL_FALLBACK = "false";

  // 1. AI Service Boot
  console.log("⏳ [1/10] Benchmarking AI Service Boot...");
  {
    const { createAiService } = await import("../packages/ai/src/index.ts");
    const r = await bench(
      "AI Service",
      "createAiService() initialization",
      async () => {
        await createAiService();
      },
      30
    );
    results.push(r);
    console.log(`   ✅ ${r.name}: avg=${r.avgMs}ms | p95=${r.p95Ms}ms | ops/s=${r.opsPerSec}`);
  }

  // 2. Tag Generation (Heuristic Text Provider)
  console.log("\n⏳ [2/10] Benchmarking Auto-Tagging (Heuristic)...");
  {
    const { HeuristicTextProvider } = await import("../packages/ai/src/index.ts");
    const provider = new HeuristicTextProvider();

    const r1 = await bench(
      "Auto-Tagging",
      "Tag generation (short text, 75 chars)",
      async () => {
        await provider.generateTags(SHORT_TEXT);
      },
      1000
    );
    results.push(r1);
    console.log(`   ✅ ${r1.name}: avg=${r1.avgMs}ms | p95=${r1.p95Ms}ms | ops/s=${r1.opsPerSec}`);

    const r2 = await bench(
      "Auto-Tagging",
      "Tag generation (medium text, ~800 chars)",
      async () => {
        await provider.generateTags(MEDIUM_TEXT);
      },
      1000
    );
    results.push(r2);
    console.log(`   ✅ ${r2.name}: avg=${r2.avgMs}ms | p95=${r2.p95Ms}ms | ops/s=${r2.opsPerSec}`);

    const r3 = await bench(
      "Auto-Tagging",
      "Tag generation (long text, ~40k chars)",
      async () => {
        await provider.generateTags(LONG_TEXT);
      },
      100
    );
    results.push(r3);
    console.log(`   ✅ ${r3.name}: avg=${r3.avgMs}ms | p95=${r3.p95Ms}ms | ops/s=${r3.opsPerSec}`);
  }

  // 3. Deterministic TLDR (Summary Generation)
  console.log("\n⏳ [3/10] Benchmarking Deterministic TLDR (Summary)...");
  {
    const { DeterministicTldrProvider } = await import("../packages/ai/src/index.ts");
    const provider = new DeterministicTldrProvider();

    const types = [
      { type: "text" as const, label: "Text item TLDR" },
      { type: "link" as const, label: "Link/Bookmark TLDR" },
      { type: "image" as const, label: "Image (with OCR + caption) TLDR" },
      { type: "document" as const, label: "Document TLDR" },
    ];

    for (const item of types) {
      const r = await bench(
        "TLDR Summarizer",
        item.label,
        async () => {
          await provider.summarize({
            type: item.type,
            title: "Understanding Transformer Architectures in AI",
            rawText: ARTICLE_TEXT,
            ocrText: item.type === "image" ? "OCR extracted text sample" : null,
            caption: item.type === "image" ? "Architecture diagram" : null,
            sourceUrl: item.type === "link" ? "https://arxiv.org/abs/1706.03762" : null,
            locale: "vi",
          });
        },
        1000
      );
      results.push(r);
      console.log(`   ✅ ${r.name}: avg=${r.avgMs}ms | p95=${r.p95Ms}ms | ops/s=${r.opsPerSec}`);
    }
  }

  // 4. Content Classifier (Semantic Typing)
  console.log("\n⏳ [4/10] Benchmarking Content Classifier...");
  {
    const { NoopContentClassifier } = await import("../packages/ai/src/index.ts");
    const classifier = new NoopContentClassifier();

    const r = await bench(
      "Classification",
      "Noop classifier (zero-latency baseline)",
      async () => {
        await classifier.classify({
          title: "Next.js 15 Release Notes",
          rawText: MEDIUM_TEXT,
          type: "link",
          sourceUrl: "https://nextjs.org/blog/next-15",
          ocrText: null,
        });
      },
      5000
    );
    results.push(r);
    console.log(`   ✅ ${r.name}: avg=${r.avgMs}ms | p95=${r.p95Ms}ms | ops/s=${r.opsPerSec}`);
  }

  // 5. In-Memory Cache (LRU + TTL)
  console.log("\n⏳ [5/10] Benchmarking In-Memory AI Cache...");
  {
    const { createMemoryCache } = await import("../packages/ai/src/index.ts");
    const cache = createMemoryCache<string[]>({ defaultTtlMs: 60_000, maxEntries: 10_000 });

    for (let i = 0; i < 5000; i++) {
      cache.set(`key-${i}`, ["tag-ai", "tag-search", "tag-productivity"]);
    }

    const rSet = await bench(
      "Memory Cache",
      "Cache SET (warm cache, 5k entries)",
      () => {
        cache.set(`key-bench-${Math.random()}`, ["tag1", "tag2"]);
      },
      10000
    );
    results.push(rSet);
    console.log(`   ✅ ${rSet.name}: avg=${rSet.avgMs}ms | p95=${rSet.p95Ms}ms | ops/s=${rSet.opsPerSec}`);

    const rGetHit = await bench(
      "Memory Cache",
      "Cache GET (cache hit)",
      () => {
        cache.get("key-100");
      },
      10000
    );
    results.push(rGetHit);
    console.log(`   ✅ ${rGetHit.name}: avg=${rGetHit.avgMs}ms | p95=${rGetHit.p95Ms}ms | ops/s=${rGetHit.opsPerSec}`);

    const rGetMiss = await bench(
      "Memory Cache",
      "Cache GET (cache miss)",
      () => {
        cache.get("non-existent-key-99999");
      },
      10000
    );
    results.push(rGetMiss);
    console.log(`   ✅ ${rGetMiss.name}: avg=${rGetMiss.avgMs}ms | p95=${rGetMiss.p95Ms}ms | ops/s=${rGetMiss.opsPerSec}`);
  }

  // 6. Content Hashing (SHA-256 Idempotency)
  console.log("\n⏳ [6/10] Benchmarking Content Hashing (SHA-256)...");
  {
    const { contentHash } = await import("../packages/ai/src/index.ts");

    const r1 = await bench(
      "Content Hash",
      "contentHash (short metadata tuple)",
      async () => {
        await contentHash(["ocr", "gemini", "1024", "image/png", "en"]);
      },
      5000
    );
    results.push(r1);
    console.log(`   ✅ ${r1.name}: avg=${r1.avgMs}ms | p95=${r1.p95Ms}ms | ops/s=${r1.opsPerSec}`);

    const r2 = await bench(
      "Content Hash",
      "contentHash (long document text, ~40k chars)",
      async () => {
        await contentHash(["embed", "gemini-001", LONG_TEXT]);
      },
      500
    );
    results.push(r2);
    console.log(`   ✅ ${r2.name}: avg=${r2.avgMs}ms | p95=${r2.p95Ms}ms | ops/s=${r2.opsPerSec}`);
  }

  // 7. Query Parser (NLP Tokenizer & Temporal Filters)
  console.log("\n⏳ [7/10] Benchmarking Query Parser...");
  {
    const { parseQuery } = await import("../packages/database/src/index.ts");

    const queries = [
      { label: "Simple keyword ('deep learning')", q: "deep learning" },
      { label: "Temporal EN ('last week machine learning')", q: "last week machine learning" },
      { label: "Temporal VN ('tuần trước công thức bánh mì')", q: "tuần trước công thức bánh mì" },
      { label: "Structured tokens ('brand:nike color:black shoes')", q: "brand:nike color:black shoes" },
      { label: "Compound complex ('last month brand:apple product laptop review')", q: "last month brand:apple product laptop review" },
    ];

    for (const item of queries) {
      const r = await bench(
        "Query Parser",
        `parseQuery: ${item.label}`,
        () => {
          parseQuery(item.q);
        },
        5000
      );
      results.push(r);
      console.log(`   ✅ ${r.name}: avg=${r.avgMs}ms | p95=${r.p95Ms}ms | ops/s=${r.opsPerSec}`);
    }
  }

  // 8. Document Chunker (Semantic Text Chunking)
  console.log("\n⏳ [8/10] Benchmarking Document Chunker...");
  {
    const { chunkDocument } = await import("../apps/api/src/jobs/document-chunker.ts");

    const chunkSizes = [
      { label: "1-page (~800 chars)", text: MEDIUM_TEXT, pages: 1, iters: 500 },
      { label: "10-page (~8,000 chars)", text: Array(10).fill(MEDIUM_TEXT).join("\n\n"), pages: 10, iters: 200 },
      { label: "50-page (~40,000 chars)", text: LONG_TEXT, pages: 50, iters: 50 },
      { label: "200-page (~160,000 chars)", text: Array(200).fill(MEDIUM_TEXT).join("\n\n"), pages: 200, iters: 20 },
    ];

    for (const item of chunkSizes) {
      const r = await bench(
        "Document Chunker",
        `chunkDocument (${item.label})`,
        () => {
          chunkDocument({ text: item.text, pageCount: item.pages });
        },
        item.iters
      );
      const count = chunkDocument({ text: item.text, pageCount: item.pages }).length;
      results.push(r);
      console.log(`   ✅ ${r.name}: avg=${r.avgMs}ms | p95=${r.p95Ms}ms | ops/s=${r.opsPerSec} | (${count} chunks)`);
    }
  }

  // 9. Cluster Algorithm (Graph Clustering: Mutual-kNN, Connected Components, Bridge Pruning)
  console.log("\n⏳ [9/10] Benchmarking Graph Clustering Algorithm...");
  {
    const {
      topKNeighbours,
      mutualEdges,
      connectedComponents,
      pruneBridges,
    } = await import("../packages/database/src/cluster-algorithm.ts");
    const { buildClusterTitle, collectSignals } = await import("../packages/database/src/clusters.ts");

    function generateGraph(nodeCount: number) {
      const nodes = Array.from({ length: nodeCount }, (_, i) => `item-${i}`);
      const edges = [];
      for (let i = 0; i < nodeCount; i++) {
        for (let j = i + 1; j < Math.min(i + 6, nodeCount); j++) {
          edges.push({
            from: `item-${i}`,
            to: `item-${j}`,
            weight: 0.6 + ((i * j) % 40) / 100,
          });
          edges.push({
            from: `item-${j}`,
            to: `item-${i}`,
            weight: 0.6 + ((i * j) % 40) / 100,
          });
        }
      }
      return { nodes, edges };
    }

    const graphSizes = [
      { label: "Small graph (20 nodes, ~100 edges)", n: 20 },
      { label: "Medium graph (100 nodes, ~500 edges)", n: 100 },
      { label: "Large graph (500 nodes, ~2500 edges)", n: 500 },
    ];

    for (const item of graphSizes) {
      const { nodes, edges } = generateGraph(item.n);

      const rMutual = await bench(
        "Cluster Graph",
        `mutualEdges (${item.label})`,
        () => {
          mutualEdges(edges, 5);
        },
        50
      );
      results.push(rMutual);

      const mutualEdgeList = mutualEdges(edges, 5);
      const rComponents = await bench(
        "Cluster Graph",
        `connectedComponents (${item.label})`,
        () => {
          connectedComponents(mutualEdgeList, nodes);
        },
        50
      );
      results.push(rComponents);

      const comp = connectedComponents(mutualEdgeList, nodes);
      const rBridges = await bench(
        "Cluster Graph",
        `pruneBridges (${item.label})`,
        () => {
          pruneBridges(mutualEdgeList, comp.components, 0.5);
        },
        50
      );
      results.push(rBridges);

      console.log(`   ✅ ${item.label}: mutualEdges=${rMutual.avgMs}ms | connectedComponents=${rComponents.avgMs}ms | pruneBridges=${rBridges.avgMs}ms`);
    }

    const clusterMembers = [
      { title: "React 19 Server Actions Deep Dive", tldr: "Server actions enable data mutations", tags: ["react", "frontend", "actions"] },
      { title: "Optimizing React Server Components", tldr: "Performance guide for server components", tags: ["react", "performance", "server-components"] },
      { title: "Fullstack Architecture with React 19", tldr: "Building modern fullstack applications", tags: ["react", "architecture", "fullstack"] },
    ];

    const rSignals = await bench(
      "Cluster Title",
      "collectSignals (tag & token extraction)",
      () => {
        collectSignals(clusterMembers);
      },
      5000
    );
    results.push(rSignals);
    console.log(`   ✅ ${rSignals.name}: avg=${rSignals.avgMs}ms | ops/s=${rSignals.opsPerSec}`);

    const signals = collectSignals(clusterMembers);
    const rTitle = await bench(
      "Cluster Title",
      "buildClusterTitle (topic phrase selection)",
      () => {
        buildClusterTitle(signals, clusterMembers.length);
      },
      5000
    );
    results.push(rTitle);
    console.log(`   ✅ ${rTitle.name}: avg=${rTitle.avgMs}ms | ops/s=${rTitle.opsPerSec}`);
  }

  // 10. Search RRF Fusion & Explainability
  console.log("\n⏳ [10/10] Benchmarking Search Ranking (RRF & Explainability)...");
  {
    const { buildSearchHitExplanation } = await import(
      "../packages/database/src/search-explainability.ts"
    );

    // Synthetic RRF fusion test
    const RRF_K = 60;
    interface SyntheticHit {
      id: string;
      lexicalRank: number;
      vectorRank: number;
      chunkRank: number;
      structRank: number;
    }

    const hits: SyntheticHit[] = Array.from({ length: 100 }, (_, i) => ({
      id: `hit-${i}`,
      lexicalRank: i + 1,
      vectorRank: ((i * 7) % 100) + 1,
      chunkRank: ((i * 13) % 100) + 1,
      structRank: ((i * 19) % 100) + 1,
    }));

    const rRRF = await bench(
      "Search Ranking",
      "4-Leg Reciprocal Rank Fusion (100 items)",
      () => {
        const scores = new Map<string, number>();
        for (const h of hits) {
          const lexScore = (1 / (RRF_K + h.lexicalRank)) * 0.4;
          const vecScore = (1 / (RRF_K + h.vectorRank)) * 0.6;
          const chunkScore = (1 / (RRF_K + h.chunkRank)) * 0.5;
          const structScore = (1 / (RRF_K + h.structRank)) * 0.5;
          scores.set(h.id, lexScore + vecScore + chunkScore + structScore);
        }
      },
      5000
    );
    results.push(rRRF);
    console.log(`   ✅ ${rRRF.name}: avg=${rRRF.avgMs}ms | p95=${rRRF.p95Ms}ms | ops/s=${rRRF.opsPerSec}`);

    const rExplain = await bench(
      "Search Explainability",
      "buildSearchHitExplanation (100 search hits)",
      () => {
        for (let i = 0; i < 100; i++) {
          buildSearchHitExplanation({
            lexical: 0.0125,
            vector: 0.0158,
            chunk: 0.0089,
            rrf: 0.0372,
            rerank: 0.8541,
            rerankEnabled: true,
          });
        }
      },
      2000
    );
    results.push(rExplain);
    console.log(`   ✅ ${rExplain.name}: avg=${rExplain.avgMs}ms | p95=${rExplain.p95Ms}ms | ops/s=${rExplain.opsPerSec}`);
  }

  // ─── Format & Print Summary Table ─────────────────────────────
  console.log("\n═════════════════════════════════════════════════════════════════════");
  console.log("  📊 SUMMARY TABLE: TỐC ĐỘ TỪNG CHỨC NĂNG");
  console.log("═════════════════════════════════════════════════════════════════════\n");

  const colGroup = 18;
  const colName = 42;
  const colNum = 10;

  const header = [
    "Nhóm".padEnd(colGroup),
    "Chức năng".padEnd(colName),
    "Avg (ms)".padStart(colNum),
    "P50 (ms)".padStart(colNum),
    "P95 (ms)".padStart(colNum),
    "Min (ms)".padStart(colNum),
    "Max (ms)".padStart(colNum),
    "Throughput".padStart(13),
  ].join(" │ ");

  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    const row = [
      r.group.padEnd(colGroup),
      (r.name.length > colName ? r.name.substring(0, colName - 1) + "…" : r.name).padEnd(colName),
      String(r.avgMs).padStart(colNum),
      String(r.p50Ms).padStart(colNum),
      String(r.p95Ms).padStart(colNum),
      String(r.minMs).padStart(colNum),
      String(r.maxMs).padStart(colNum),
      (r.opsPerSec.toLocaleString() + "/s").padStart(13),
    ].join(" │ ");
    console.log(row);
  }

  console.log("─".repeat(header.length));
  console.log(`  Tổng số chức năng đã benchmark: ${results.length}`);
  console.log("═════════════════════════════════════════════════════════════════════\n");

  // Save JSON report
  const outputPath = path.resolve(process.cwd(), "benchmark-results.json");
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
    "utf8"
  );
  console.log(`💾 Kết quả benchmark đã được ghi ra: ${outputPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
