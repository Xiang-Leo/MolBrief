import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  articleSchema, buildSummaryRequest, mergeModelSummary, sourceUrlSchema,
  SUMMARY_SYSTEM_PROMPT, SummaryOutputError,
} from '../lib/editorial-schema.ts';

const article = {
  id: 'art-summary-test', title: 'A source-backed research update', category: '研究',
  publishedAt: '2026-10-27', url: 'https://example.invalid/research', source: 'Original research',
  type: '论文摘要', summary: 'Existing source excerpt.', keyPoints: ['Only a responder subset was evaluated.'],
  limitations: 'Abstract only; no complete article was supplied.', topics: ['trial'], readingBasis: '论文摘要',
  group: '近期动态', collectedAt: '2026-10-27T00:00:00.000Z',
};
const result = {
  title: '基于所给材料的中文解读', summary: '这项研究目前仅提供摘要，需要区分应答者子集与全部入组者，尚不能作更广泛的疗效判断。',
  keyPoints: ['明确人群和证据边界。'], limitations: '未提供完整研究结果，不能推断总体疗效。', topics: ['临床研究'],
  deepDive: {
    background: '原始资料是一份有限的研究摘要。', keyFindings: ['结论适用范围由原文人群限定。'],
    quantitativeEvidence: [{ label: '分母', value: '未披露', context: '当前仅有摘要，应答者子集不能代表所有初治者。', sourceUrl: article.url }],
    implications: ['后续应回到原文核对人群和研究设计。'], limitations: ['未提供全文。'], nextQuestions: ['总体入组人群的完整结果是什么？'],
  },
};

test('legacy article exports remain valid without optional editorial fields', async () => {
  const exported = JSON.parse(await readFile(new URL('../data/content-export.json', import.meta.url), 'utf8'));
  assert.equal(exported.articles.length, 8);
  for (const value of exported.articles) assert.ok(articleSchema.safeParse(value).success);
  assert.equal(articleSchema.parse(article).deepDive, undefined);
});

test('all source and cover links accept only HTTP(S) without embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'ftp://example.invalid/', 'https://user:secret@example.invalid/']) {
    assert.equal(sourceUrlSchema.safeParse(url).success, false);
    assert.equal(articleSchema.safeParse({ ...article, url }).success, false);
    assert.equal(articleSchema.safeParse({ ...article, coverSource: url }).success, false);
    assert.equal(articleSchema.safeParse({ ...article, deepDive: { quantitativeEvidence: [{ label: 'x', value: 'x', sourceUrl: url }] } }).success, false);
  }
  assert.ok(sourceUrlSchema.safeParse('http://example.invalid/source').success);
  assert.ok(sourceUrlSchema.safeParse('https://example.invalid/source').success);
});

test('editorial article metadata, source excerpt and curated facts survive schema validation', () => {
  const source = {
    ...article, sourceText: 'A precise supplied excerpt.', deepDive: result.deepDive,
    sourceReview: { status: 'verified', checkedAt: '2026-11-02T10:00:00.000Z', note: 'Link availability checked; no full text asserted.' },
    entities: [{ type: 'deal', name: 'Example transaction', sourceUrl: article.url, provenance: 'curated', facts: [{
      key: 'milestones', label: '本次里程碑', value: null, status: 'not-disclosed',
      sourceUrl: article.url, sourceDate: article.publishedAt, dateBasis: 'source-publication', provenance: 'curated', evidence: 'Amount not disclosed.',
    }] }],
  };
  const parsed = articleSchema.parse(source);
  assert.deepEqual(parsed.entities, source.entities);
  assert.deepEqual(parsed.sourceReview, source.sourceReview);
  assert.equal(parsed.sourceText, source.sourceText);
  assert.equal(articleSchema.safeParse({ ...source, entities: [{ ...source.entities[0], sourceUrl: 'javascript:alert(1)' }] }).success, false);
});

test('unknown money is null rather than zero and impossible dates are rejected', () => {
  const entity = { type: 'deal', name: 'Transaction', sourceUrl: article.url, provenance: 'curated', facts: [{
    key: 'upfront', label: '首付', value: null, status: 'not-disclosed', sourceUrl: article.url,
    sourceDate: null, dateBasis: 'unknown', provenance: 'curated',
  }] };
  assert.ok(articleSchema.safeParse({ ...article, entities: [entity], publishedAt: null }).success);
  assert.equal(articleSchema.safeParse({ ...article, entities: [{ ...entity, facts: [{ ...entity.facts[0], value: '0' }] }] }).success, false);
  assert.equal(articleSchema.safeParse({ ...article, publishedAt: '2026-02-30' }).success, false);
});

test('summary request uses supplied excerpts honestly and provides a larger bounded output budget', () => {
  const request = buildSummaryRequest({ ...article, sourceText: 'Precisely quoted original excerpt.' });
  assert.equal(request.max_tokens, 4000);
  assert.deepEqual(request.response_format, { type: 'json_object' });
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.materialScope, 'provided-source-excerpt');
  assert.equal(payload.sourceText, 'Precisely quoted original excerpt.');
  assert.equal(payload.readingBasis, article.readingBasis);
  assert.deepEqual(payload.allowedSourceUrls, [article.url]);
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes('350–700'));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes('II期应答者子集'));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes('不能表述为所有初治者疗效'));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes('潜在总价、首付款、近期款、本次里程碑分别列示'));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes('未披露'));
});

test('without source excerpt, request preserves existing material and never upgrades reading scope', () => {
  const request = buildSummaryRequest({ ...article, deepDive: { background: 'Previously curated context.' } });
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.materialScope, 'existing-editorial-material');
  assert.equal(payload.sourceText, undefined);
  assert.equal(payload.summary, article.summary);
  assert.deepEqual(payload.keyPoints, article.keyPoints);
  assert.equal(payload.deepDive.background, 'Previously curated context.');
});

test('model merge preserves reviewed entity facts and source metadata while ignoring model-written entities and scope', () => {
  const original = {
    ...article, sourceText: 'Preserved excerpt.',
    sourceReview: { status: 'verified', checkedAt: '2026-11-02T10:00:00.000Z', note: 'Availability only.' },
    entities: [{ type: 'drug', name: 'Curated drug', sourceUrl: article.url, provenance: 'curated', facts: [{
      key: 'target', label: '靶点', value: 'Curated target', status: 'reported', sourceUrl: article.url,
      sourceDate: '2026-10-27', dateBasis: 'source-publication', provenance: 'curated',
    }] }],
  };
  const merged = mergeModelSummary(original, JSON.stringify({ ...result,
    entities: [{ type: 'drug', name: 'Invented replacement', provenance: 'curated' }],
    readingBasis: '阅读全文', sourceText: 'Invented text', url: 'https://fabricated.invalid/',
    sourceReview: { status: 'verified', checkedAt: 'forged', note: 'All scientific facts verified' },
  }));
  assert.equal(merged.summary, result.summary);
  assert.equal(merged.originalTitle, article.title);
  assert.deepEqual(merged.entities, original.entities);
  assert.deepEqual(merged.sourceReview, original.sourceReview);
  assert.equal(merged.sourceText, original.sourceText);
  assert.equal(merged.url, original.url);
  assert.equal(merged.readingBasis, original.readingBasis);
});

test('model citations cannot introduce a link beyond the sources supplied as input', () => {
  assert.throws(() => mergeModelSummary(article, { ...result, deepDive: {
    ...result.deepDive, quantitativeEvidence: [{ label: 'Invented metric', value: '99%', sourceUrl: 'https://fabricated.invalid/paper' }],
  } }), SummaryOutputError);
  const extraSource = 'https://example.invalid/curated-evidence';
  const original = { ...article, deepDive: { quantitativeEvidence: [{ label: 'Original metric', value: 'Reported only', sourceUrl: extraSource }] } };
  assert.equal(mergeModelSummary(original, { ...result, deepDive: {
    ...result.deepDive, quantitativeEvidence: [{ label: 'Reported metric', value: 'Reported only', sourceUrl: extraSource }],
  } }).deepDive.quantitativeEvidence[0].sourceUrl, extraSource);
});

test('incomplete or invalid model JSON cannot replace existing data; sparse material need not be padded', () => {
  for (const invalid of ['not JSON', {}, { ...result, deepDive: undefined }, { ...result, summary: '' }]) {
    assert.throws(() => mergeModelSummary(article, invalid), SummaryOutputError);
  }
  const short = { ...result, summary: '仅有短摘录，未披露样本量。', deepDive: { background: '材料有限。', quantitativeEvidence: [] } };
  assert.equal(mergeModelSummary(article, short).summary, short.summary);
  assert.equal(article.summary, 'Existing source excerpt.');
});

test('raw source takes priority over previous model prose and English-only output cannot overwrite content',()=>{
 const p=JSON.parse(buildSummaryRequest({...article,sourceText:'Original measurements only.',summary:'Old generated prose.',deepDive:result.deepDive}).messages[1].content);assert.equal(p.summary,undefined);assert.equal(p.deepDive,undefined);assert.equal(p.sourceText,'Original measurements only.');assert.throws(()=>mergeModelSummary(article,{...result,summary:'English only result.'}),SummaryOutputError);const next=mergeModelSummary({...article,sourceText:'Source'},result);assert.equal(next.summaryReview.version,2);assert.equal(next.summaryReview.materialScope,'provided-source-excerpt');
});
