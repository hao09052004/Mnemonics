// Re-runnable smoke test for the dashboard's real clustering implementation.
// Run from this folder with: node clustering-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboardPath = path.join(__dirname, 'dashboard.js');
const source = fs.readFileSync(dashboardPath, 'utf8');
const start = source.indexOf('const CLUSTER_STOPWORDS = new Set(');
const end = source.indexOf('// ===== BOOK / COURSE SUGGESTIONS', start);
assert.ok(start >= 0 && end > start, 'clustering implementation block exists');

// Supply the two dashboard helpers used by the extracted production function.
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
const moduleBox = { exports: {} };
vm.runInNewContext(
  helpers + source.slice(start, end) + '\nmodule.exports = clusterSearchResults;',
  { module: moduleBox, Math, Map, Set, JSON, String }
);
const clusterSearchResults = moduleBox.exports;

function makeItem(id, title, tag) {
  return { id, title, excerpt: '', note: '', quote: '', tags: [tag], aiTags: [], checks: [] };
}

const results = [
  makeItem('a1', 'Docker image build', 'container'),
  makeItem('a2', 'Docker container deploy', 'container'),
  makeItem('a3', 'Docker deployment pipeline', 'container'),
  makeItem('a4', 'Container image release', 'container'),
  makeItem('b1', 'Meal planning nutrition', 'nutrition'),
  makeItem('b2', 'Nutrition meal prep', 'nutrition'),
  makeItem('b3', 'Meal prep healthy food', 'nutrition'),
  makeItem('b4', 'Healthy nutrition menu', 'nutrition'),
  makeItem('c1', 'Solo astronomy note', 'stars'),
  makeItem('c2', 'Solo bicycle note', 'cycling'),
  makeItem('c3', 'Solo garden note', 'garden'),
  makeItem('c4', 'Solo music note', 'music'),
  makeItem('bridge', 'Container meal nutrition', 'misc')
];

const groups = clusterSearchResults(results);
const topicGroups = Array.from(groups).filter((group) => group.id !== 'topic-other');
const otherGroup = Array.from(groups).find((group) => group.id === 'topic-other');

assert.equal(topicGroups.length, 2, 'two distinct topics are detected');
assert.ok(topicGroups.every((group) => group.items.length === 4), 'each topic has four items');
assert.ok(otherGroup, 'unrelated results have an Other group');
assert.ok(otherGroup.items.some((entry) => entry.id === 'bridge'), 'the bridge item stays outside both topics');

const flattenedIds = Array.from(groups).flatMap((group) =>
  Array.from(group.items).map((entry) => entry.id)
);
assert.equal(new Set(flattenedIds).size, results.length, 'every result appears exactly once');
assert.deepEqual(new Set(flattenedIds), new Set(results.map((entry) => entry.id)));

const reorderedGroups = clusterSearchResults(results.slice().reverse());
const membership = (list) => Array.from(list)
  .filter((group) => group.id !== 'topic-other')
  .map((group) => Array.from(group.items).map((entry) => entry.id).sort().join(','))
  .sort();
assert.deepEqual(membership(reorderedGroups), membership(groups), 'membership is stable after reordering');
assert.deepEqual(
  Array.from(reorderedGroups).filter((group) => group.id !== 'topic-other').map((group) => group.id).sort(),
  topicGroups.map((group) => group.id).sort(),
  'cluster IDs are stable after reordering'
);

console.log('Clustering smoke test passed.');
