import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchLiterature, parseNcbiArticles, parseEuropePmcArticles, europePmcQuery,
  explicitPublicationDate, LiteratureSearchError,
} from '../lib/literature-search-core.mjs';

const now = () => Date.UTC(2026, 10, 2);
const state = () => ({ ncbiBlockedUntil: 0, ncbiRetryUntil: 0, europeRetryUntil: 0 });
const record = {
  source: 'MED', id: '42955639', pmid: '42955639', title: 'A <i>nanobody</i> study &amp; its limits',
  abstractText: '<h4>Background</h4><p>Reported &#946; binding in a preclinical model.</p>',
  firstPublicationDate: '2027-01-01',
  journalInfo: { dateOfPublication: '2027 ', printPublicationDate: '2027-01-01', journal: { title: 'Original journal' } },
};
const europeResponse = () => Response.json({ hitCount: 1, resultList: { result: [record] } });
const xml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">31452104</PMID><Article><Journal><Title>Test Journal</Title><JournalIssue><PubDate><Year>2026</Year><Month>Oct</Month><Day>27</Day></PubDate></JournalIssue></Journal><ArticleTitle>A <i>source</i> title</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">An &amp; B.</AbstractText><AbstractText Label="RESULTS">&#x3b2; binding only.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;

test('blocked NCBI redirect uses explicitly labelled Europe PMC MED records and pauses blocked requests', async () => {
  let ncbiCalls = 0, europeCalls = 0;
  const shared = state();
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url.startsWith('https://eutils.ncbi.nlm.nih.gov/')) {
      ncbiCalls++;
      return new Response('', { status: 302, headers: { Location: 'https://misuse.ncbi.nlm.nih.gov/error/abuse.shtml' } });
    }
    europeCalls++;
    const request = new URL(url);
    assert.equal(request.origin, 'https://www.ebi.ac.uk');
    assert.ok(request.searchParams.get('query').includes('AND SRC:MED'));
    assert.equal(request.searchParams.get('resultType'), 'core');
    assert.equal(request.searchParams.get('pageSize'), '8');
    return europeResponse();
  };
  const articles = await searchLiterature('nanobody', { fetcher, now, state: shared });
  assert.equal(articles.length, 1);
  assert.equal(articles[0].url, 'https://pubmed.ncbi.nlm.nih.gov/42955639/');
  assert.equal(articles[0].readingBasis, 'Europe PMC 提供的 PubMed 原始摘要');
  assert.equal(articles[0].title, 'A nanobody study & its limits');
  assert.equal(articles[0].sourceText, 'Background Reported β binding in a preclinical model.');
  assert.equal(articles[0].publishedAt, null);
  await searchLiterature('nanobody', { fetcher, now, state: shared });
  assert.equal(ncbiCalls, 1); assert.equal(europeCalls, 2);
});

test('healthy NCBI uses esearch and efetch once each without Europe PMC', async () => {
  const calls = [];
  const articles = await searchLiterature('nanobody', { now, state: state(), fetcher: async url => {
    calls.push(url);
    if (url.includes('esearch.fcgi')) return Response.json({ esearchresult: { idlist: ['31452104'] } });
    assert.ok(url.includes('efetch.fcgi'));
    return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
  } });
  assert.equal(calls.length, 2); assert.equal(articles.length, 1);
  assert.equal(articles[0].readingBasis, 'PubMed 原始摘要');
  assert.equal(articles[0].publishedAt, '2026-10-27');
  assert.equal(articles[0].sourceText, 'An & B. β binding only.');
});

test('valid zero-result NCBI searches return empty rather than substituting another provider', async () => {
  let calls = 0;
  const articles = await searchLiterature('nonexistent-test-term', { now, state: state(), fetcher: async () => {
    calls++; return Response.json({ esearchresult: { idlist: [], count: '0' } });
  } });
  assert.deepEqual(articles, []); assert.equal(calls, 1);
});

test('429 Retry-After is respected with no retry or fallback, including repeated user requests', async () => {
  let calls = 0;
  const shared = state(), fetcher = async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(searchLiterature('nanobody', { now, state: shared, fetcher }), error => error instanceof LiteratureSearchError && error.status === 429 && error.retryAfter === 120);
  }
  assert.equal(calls, 1);
});

test('Europe PMC filters non-MED and invalid PMID entries, preserves absent abstracts as bibliographic records', () => {
  const articles = parseEuropePmcArticles({ resultList: { result: [
    { ...record, source: 'PPR', pmid: '99999' }, { ...record, pmid: 'not-a-pmid' },
    { ...record, abstractText: undefined, electronicPublicationDate: '2026-11-01' },
  ] } }, 'nanobody', now);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].readingBasis, 'Europe PMC 提供的 PubMed 题录');
  assert.equal(articles[0].sourceText, undefined);
  assert.equal(articles[0].publishedAt, '2026-11-01');
  assert.ok(articles[0].summary.includes('未提供摘要'));
});

test('partial, impossible and imputed publication dates stay unknown', () => {
  for (const value of ['2026', '2026 Oct', '2026-10', '2026-02-30', undefined]) assert.equal(explicitPublicationDate(value), null);
  assert.equal(explicitPublicationDate('2026 Nov 2'), '2026-11-02');
  assert.equal(explicitPublicationDate('2026 11 02'), '2026-11-02');
  const partial = parseEuropePmcArticles({ resultList: { result: [record] } }, 'nanobody', now)[0];
  assert.equal(partial.publishedAt, null);
  assert.equal(parseNcbiArticles(xml.replace('<Day>27</Day>', ''), 'nanobody', now)[0].publishedAt, null);
});

test('network failures produce honest safe errors if both official providers are unavailable', async () => {
  let calls = 0;
  await assert.rejects(searchLiterature('nanobody', { now, state: state(), fetcher: async () => {
    calls++; throw new Error('private runtime details must not leak');
  } }), error => error instanceof LiteratureSearchError && error.message.includes('NCBI 网络连接失败或超时') && error.message.includes('Europe PMC 网络连接失败或超时') && !error.message.includes('private runtime'));
  assert.equal(calls, 2);
});

test('common PubMed title/abstract tags map explicitly; unsupported field syntax fails visibly', () => {
  const query = europePmcQuery('("drug discovery"[Title/Abstract]) AND (nanobody[tiab] OR VHH[tiab])');
  assert.ok(query.includes('(TITLE:"drug discovery" OR ABSTRACT:"drug discovery")'));
  assert.ok(query.includes('(TITLE:nanobody OR ABSTRACT:nanobody)'));
  assert.ok(query.endsWith('AND SRC:MED sort_date:y'));
  assert.throws(() => europePmcQuery('cancer[MeSH Terms]'), error => error instanceof LiteratureSearchError && error.status === 400);
});

test('long abstracts keep schema-compatible excerpt bounds and retain a longer original excerpt', () => {
  const article = parseEuropePmcArticles({ resultList: { result: [{ ...record, abstractText: 'x'.repeat(30000) }] } }, 'nanobody', now)[0];
  assert.equal(article.summary.length, 12000); assert.equal(article.sourceText.length, 24000);
  assert.ok(article.limitations.includes('显示节选'));
});

test('malformed provider responses cannot masquerade as a successful empty search', async () => {
  await assert.rejects(searchLiterature('nanobody', { now, state: state(), fetcher: async url => url.includes('ncbi.nlm.nih.gov')
    ? Response.json({ error: 'bad upstream response' }) : Response.json({ errCode: 1 })
  }), LiteratureSearchError);
});
