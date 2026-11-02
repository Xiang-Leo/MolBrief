import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyGeneratedSummary, mergeArticleEvidence } from '../lib/article-merge.ts';

test('adding records to an existing URL preserves previous entities, source scope and detailed reading', async () => {
  const articles=JSON.parse(await readFile(new URL('../data/seed.json',import.meta.url),'utf8'));
  const existing=articles.find(a=>a.entities?.length>1);
  const incoming={...existing,title:'新增的一份补充记录',summary:'用户新整理的来源摘要',publishedAt:null,keyPoints:[],entities:[{type:'target',name:'Test-only target',sourceUrl:existing.url,provenance:'curated',facts:[]}]};
  delete incoming.deepDive;
  const merged=mergeArticleEvidence(existing,incoming);
  assert.equal(merged.entities.length,existing.entities.length+1);
  assert.deepEqual(merged.deepDive,existing.deepDive);
  assert.deepEqual(merged.keyPoints,existing.keyPoints);
  assert.equal(merged.summary,incoming.summary);
  assert.equal(merged.publishedAt,existing.publishedAt);
  assert.equal(existing.entities.some(e=>e.name==='Test-only target'),false);
});

test('repeated supplemental evidence does not multiply already collected facts', async () => {
  const articles=JSON.parse(await readFile(new URL('../data/seed.json',import.meta.url),'utf8'));
  const existing=articles.find(a=>a.entities?.some(e=>e.facts?.length));
  const incoming={...existing,entities:[existing.entities[0]]};
  const once=mergeArticleEvidence(existing,incoming);
  const twice=mergeArticleEvidence(once,incoming);
  assert.equal(twice.entities.length,once.entities.length);
  assert.deepEqual(twice.entities,once.entities);
});

test('generated prose cannot replace source material or facts updated while a model request was running', async () => {
  const articles=JSON.parse(await readFile(new URL('../data/seed.json',import.meta.url),'utf8'));
  const earlier=articles.find(a=>a.entities?.some(e=>e.facts?.length));
  const latest={...earlier,sourceText:'The newest supplied source excerpt.',readingBasis:'Latest reviewed source scope',entities:[...earlier.entities,{type:'target',name:'Later reviewed target',sourceUrl:earlier.url,provenance:'curated',facts:[]}]};
  const generated={...earlier,title:'Expanded title',summary:'Expanded source-bound prose.',sourceText:'An outdated source excerpt.',readingBasis:'Stale source scope'};
  const merged=applyGeneratedSummary(latest,generated);
  assert.equal(merged.summary,generated.summary);
  assert.equal(merged.sourceText,latest.sourceText);
  assert.equal(merged.readingBasis,latest.readingBasis);
  assert.ok(merged.entities.some(e=>e.name==='Later reviewed target'));
  assert.deepEqual(merged.entities[0].facts,earlier.entities[0].facts);
});
