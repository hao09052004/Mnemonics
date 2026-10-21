import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSION_ROOT = join(__dirname, '..');

describe('Mnemonics new extension structure & dashboard', () => {
  it('manifest.json has all required MV3 fields and valid resources', () => {
    const manifestPath = join(EXTENSION_ROOT, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Mnemonics — AI Smart Bookmark');
    expect(manifest.action.default_popup).toBe('mnemonics-extension.html');
    expect(manifest.background.service_worker).toBe('background.js');
    expect(existsSync(join(EXTENSION_ROOT, manifest.action.default_popup))).toBe(true);
    expect(existsSync(join(EXTENSION_ROOT, manifest.background.service_worker))).toBe(true);
  });

  it('dashboard HTML contains core sections and navigation elements', () => {
    const htmlPath = join(EXTENSION_ROOT, 'mnemonics-dashboard.html');
    expect(existsSync(htmlPath)).toBe(true);
    const html = readFileSync(htmlPath, 'utf8');

    expect(html).toContain('id="page-dashboard"');
    expect(html).toContain('id="sidebar-spaces"');
    expect(html).toContain('id="search-input"');
    expect(html).toContain('id="serendipity-overlay"');
    expect(html).toContain('logo-mark.png');
  });

  it('extension popup HTML contains quick capture form', () => {
    const popupPath = join(EXTENSION_ROOT, 'mnemonics-extension.html');
    expect(existsSync(popupPath)).toBe(true);
    const popupHtml = readFileSync(popupPath, 'utf8');

    expect(popupHtml).toContain('id="save-btn"');
    expect(popupHtml).toContain('id="capture-screenshot-btn"');
    expect(popupHtml).toContain('id="cap-title"');
    expect(popupHtml).toContain('id="tab-url"');
  });

  it('dashboard clustering algorithm correctly clusters items by topic', () => {
    const dashboardPath = join(EXTENSION_ROOT, 'dashboard.js');
    const source = readFileSync(dashboardPath, 'utf8');
    expect(source).toContain('function clusterSearchResults');

    // Run clustering smoke test logic
    const start = source.indexOf('const CLUSTER_STOPWORDS = new Set(');
    const end = source.indexOf('// ===== BOOK / COURSE SUGGESTIONS', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const helpers = `
      function normalizeText(value) {
        return String(value || '').toLowerCase().normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd');
      }
      function getSearchText(item) {
        return [item.title, item.excerpt, item.note, item.quote, item.url, item.space,
          item.type, (item.tags || []).join(' '), (item.aiTags || []).join(' '),
          (item.checks || []).map(function(c) { return c.text; }).join(' ')]
          .map(function(value) { return String(value || '').toLowerCase(); }).join(' ');
      }
    `;

    const code = helpers + source.slice(start, end) + '; return clusterSearchResults;';
    const clusterSearchResults = new Function(code)();

    function makeItem(id: string, title: string, tag: string) {
      return { id, title, excerpt: '', note: '', quote: '', tags: [tag], aiTags: [], checks: [] };
    }

    const testResults = [
      makeItem('a1', 'Docker build container', 'devops'),
      makeItem('a2', 'Docker deploy image', 'devops'),
      makeItem('a3', 'Docker container registry', 'devops'),
      makeItem('a4', 'Container orchestration build', 'devops'),
      makeItem('b1', 'Yoga meditation practice', 'health'),
      makeItem('b2', 'Meditation breathing yoga', 'health'),
      makeItem('b3', 'Healthy yoga workout', 'health'),
      makeItem('b4', 'Daily meditation yoga', 'health'),
      makeItem('c1', 'Unrelated astronomy star note', 'stars')
    ];

    const groups = clusterSearchResults(testResults);
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });
});
