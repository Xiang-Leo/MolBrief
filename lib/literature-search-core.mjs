import { createHash } from 'node:crypto';
import {publicationDates} from './publication-date.mjs';

const NCBI_ROOT = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const EUROPE_ROOT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const providerState = { ncbiBlockedUntil: 0, ncbiRetryUntil: 0, europeRetryUntil: 0 };
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

export class LiteratureSearchError extends Error {
  constructor(message, status = 502, retryAfter = null) {
    super(message); this.name = 'LiteratureSearchError'; this.status = status; this.retryAfter = retryAfter;
  }
}

export function literaturePlainText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => {
      const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : parseInt(number, 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity])
    .replace(/\s+/g, ' ').trim();
}

export function explicitPublicationDate(value) {
  if (typeof value !== 'string') return null;
  let date = value.trim();
  const words = /^(\d{4})\s+([A-Za-z]{3}|\d{1,2})\s+(\d{1,2})$/.exec(date);
  if (words) date = `${words[1]}-${MONTHS[words[2]] || words[2].padStart(2, '0')}-${words[3].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(date + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function makeArticle({ pmid, title, abstract, journal, publishedAt, publicationInfo, query, provider, now }) {
  const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  const isEurope = provider === 'europe-pmc';
  const excerpted = abstract.length > 12000;
  return {
    id: 'art-' + createHash('sha256').update(url).digest('hex').slice(0, 16),
    title: title.slice(0, 300), originalTitle: title.slice(0, 700), category: '研究', publishedAt, publicationInfo,
    url, source: (journal || 'PubMed').slice(0, 180), type: '论文记录',
    summary: abstract ? abstract.slice(0, 12000) : '本记录未提供摘要，请打开 PubMed 查看原始信息。',
    ...(abstract ? { sourceText: abstract.slice(0, 24000) } : {}), keyPoints: [],
    limitations: `${isEurope ? 'NCBI 主接口暂不可用；本次由 Europe PMC 提供 PubMed 记录，检索语法与收录更新可能有所不同。' : ''}这是检索得到的${abstract ? '原始摘要' : '题录'}，尚未进行中文解读和全文核对。${excerpted ? '摘要较长，页面显示节选。' : ''}`,
    topics: [query.slice(0, 60)],
    readingBasis: isEurope ? `Europe PMC 提供的 PubMed ${abstract ? '原始摘要' : '题录'}` : `PubMed ${abstract ? '原始摘要' : '题录'}`,
    group: '检索结果', collectedAt: new Date(now()).toISOString(), coverSource: null,
  };
}

export function parseNcbiArticles(xml, query, now = Date.now) {
  if (typeof xml !== 'string' || !/<PubmedArticleSet[\s>]/.test(xml)) throw new LiteratureSearchError('NCBI 返回的文献记录格式无效。');
  const blocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  const articles = [];
  for (const block of blocks) {
    const pmid = block.match(/<PMID[^>]*>([1-9]\d{0,11})<\/PMID>/)?.[1];
    const title = literaturePlainText(block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1]);
    if (!pmid || !title) continue;
    const abstract = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(match => literaturePlainText(match[1])).filter(Boolean).join(' ');
    const journal = literaturePlainText(block.match(/<Title>([\s\S]*?)<\/Title>/)?.[1]);
    const publication = block.match(/<PubDate>([\s\S]*?)<\/PubDate>/)?.[1] || '';
    const year = publication.match(/<Year>(\d{4})<\/Year>/)?.[1], month = publication.match(/<Month>([^<]+)<\/Month>/)?.[1], day = publication.match(/<Day>(\d{1,2})<\/Day>/)?.[1];
    const journalDate = year && month && day ? explicitPublicationDate(`${year} ${month} ${day}`) : null;
    const electronicBlock=block.match(/<ArticleDate[^>]*DateType="Electronic"[^>]*>([\s\S]*?)<\/ArticleDate>/)?.[1]||block.match(/<PubMedPubDate[^>]*PubStatus="epublish"[^>]*>([\s\S]*?)<\/PubMedPubDate>/)?.[1]||'';
    const ey=electronicBlock.match(/<Year>(\d{4})<\/Year>/)?.[1],em=electronicBlock.match(/<Month>([^<]+)<\/Month>/)?.[1],ed=electronicBlock.match(/<Day>(\d{1,2})<\/Day>/)?.[1];
    const {publishedAt,publicationInfo}=publicationDates({online:ey&&em&&ed?explicitPublicationDate(`${ey} ${em} ${ed}`):null,journal:journalDate||literaturePlainText(publication)},now());
    articles.push(makeArticle({ pmid, title, abstract, journal, publishedAt, publicationInfo, query, provider: 'ncbi', now }));
  }
  if (blocks.length && !articles.length) throw new LiteratureSearchError('NCBI 返回的文献记录缺少有效的 PMID 或标题。');
  return articles;
}

/** Only these common PubMed field tags have an explicit Europe PMC equivalent. */
export function europePmcQuery(query) {
  const token = '("[^"\\n]+"|[\\p{L}\\p{N}_.*/?+-]+)';
  let converted = query.replace(new RegExp(token + '\\s*\\[(Title/Abstract|tiab)\\]', 'giu'), (_, value) => `(TITLE:${value} OR ABSTRACT:${value})`)
    .replace(new RegExp(token + '\\s*\\[(Title|ti)\\]', 'giu'), (_, value) => `TITLE:${value}`)
    .replace(/\[All Fields\]/gi, '');
  if (/[\[\]]/.test(converted)) throw new LiteratureSearchError('NCBI 主接口暂不可用；备用 Europe PMC 暂不支持这个 PubMed 字段筛选，请先使用英文关键词或 Title/Abstract 检索式。', 400);
  return `(${converted}) AND SRC:MED sort_date:y`;
}

export function parseEuropePmcArticles(data, query, now = Date.now) {
  if (!data || !Array.isArray(data.resultList?.result) || data.errCode || data.error) throw new LiteratureSearchError('Europe PMC 返回的文献记录格式无效。');
  const articles = [];
  for (const item of data.resultList.result) {
    const pmid = String(item.pmid || item.id || '');
    if (item.source !== 'MED' || !/^[1-9]\d{0,11}$/.test(pmid)) continue;
    const title = literaturePlainText(item.title);
    if (!title) continue;
    const abstract = literaturePlainText(item.abstractText);
    // firstPublicationDate and printPublicationDate may be imputed from a year
    // or month. Do not turn their January 1 placeholders into exact dates.
    const {publishedAt,publicationInfo}=publicationDates({online:explicitPublicationDate(item.electronicPublicationDate),journal:explicitPublicationDate(item.journalInfo?.dateOfPublication)||item.journalInfo?.dateOfPublication||null},now());
    articles.push(makeArticle({ pmid, title, abstract, journal: literaturePlainText(item.journalInfo?.journal?.title || item.journalTitle), publishedAt, publicationInfo, query, provider: 'europe-pmc', now }));
  }
  if (data.resultList.result.length && !articles.length) throw new LiteratureSearchError('Europe PMC 未返回有效的 PubMed PMID 记录。');
  return [...new Map(articles.map(article => [article.id, article])).values()].slice(0, 8);
}

function retrySeconds(value, now) {
  if (!value) return 60;
  if (/^\d+$/.test(value)) return Math.max(1, Number(value));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - now()) / 1000)) : 60;
}

async function fetchPublic(fetcher, url, { provider, state, now, signal }) {
  const retryField = provider === 'ncbi' ? 'ncbiRetryUntil' : 'europeRetryUntil';
  if (state[retryField] > now()) {
    const seconds = Math.ceil((state[retryField] - now()) / 1000);
    throw new LiteratureSearchError(`${provider === 'ncbi' ? 'NCBI' : 'Europe PMC'} 要求暂缓请求，请约 ${seconds} 秒后重试。`, 429, seconds);
  }
  let response;
  try {
    const timeout = AbortSignal.timeout(provider === 'ncbi' ? 8000 : 15000);
    response = await fetcher(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { Accept: 'application/json, application/xml, text/xml' } });
  } catch { throw new LiteratureSearchError(`${provider === 'ncbi' ? 'NCBI' : 'Europe PMC'} 网络连接失败或超时。`); }
  if (response.status === 429 || (response.status === 503 && response.headers.get('retry-after'))) {
    const seconds = retrySeconds(response.headers.get('retry-after'), now);
    state[retryField] = now() + seconds * 1000;
    throw new LiteratureSearchError(`${provider === 'ncbi' ? 'NCBI' : 'Europe PMC'} 要求暂缓请求，请约 ${seconds} 秒后重试。`, response.status, seconds);
  }
  if (provider === 'ncbi' && (response.status === 403 || (response.status >= 300 && response.status < 400 && response.headers.get('location')?.startsWith('https://misuse.ncbi.nlm.nih.gov/')))) {
    state.ncbiBlockedUntil = now() + 10 * 60 * 1000;
    throw new LiteratureSearchError('NCBI 限制了当前服务器的出口访问。');
  }
  if (!response.ok) throw new LiteratureSearchError(`${provider === 'ncbi' ? 'NCBI' : 'Europe PMC'} 暂未接受请求（HTTP ${response.status}）。`);
  return response;
}

/** @param {string} query
 * @param {{fetcher?:typeof fetch,now?:()=>number,state?:typeof providerState,signal?:AbortSignal}} [options]
 */
export async function searchLiterature(query, { fetcher = globalThis.fetch, now = Date.now, state = providerState, signal } = {}) {
  signal?.throwIfAborted();
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new LiteratureSearchError('请输入不超过 500 字符的文献关键词。', 400);
  const cleanQuery = query.trim();
  let primaryError;
  try {
    if (state.ncbiBlockedUntil > now()) throw new LiteratureSearchError('NCBI 限制了当前服务器的出口访问。');
    const searchUrl = new URL('esearch.fcgi', NCBI_ROOT);
    searchUrl.search = new URLSearchParams({ db: 'pubmed', retmode: 'json', retmax: '8', sort: 'pub date', term: cleanQuery, tool: 'molbrief' }).toString();
    const searchResponse = await fetchPublic(fetcher, searchUrl.href, { provider: 'ncbi', state, now, signal });
    let search;
    try { search = await searchResponse.json(); } catch { throw new LiteratureSearchError('NCBI 返回的检索响应格式无效。'); }
    const ids = search?.esearchresult?.idlist;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[1-9]\d{0,11}$/.test(id))) throw new LiteratureSearchError('NCBI 返回的 PMID 列表格式无效。');
    if (!ids.length) return [];
    const fetchUrl = new URL('efetch.fcgi', NCBI_ROOT);
    fetchUrl.search = new URLSearchParams({ db: 'pubmed', retmode: 'xml', id: ids.slice(0, 8).join(','), tool: 'molbrief' }).toString();
    const records = await fetchPublic(fetcher, fetchUrl.href, { provider: 'ncbi', state, now, signal });
    const articles = parseNcbiArticles(await records.text(), cleanQuery, now);
    if (!articles.length) throw new LiteratureSearchError('NCBI 未返回所检索 PMID 的文献内容。');
    return articles;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    primaryError = error instanceof LiteratureSearchError ? error : new LiteratureSearchError('NCBI 文献检索暂未完成。');
    // Honor provider Retry-After; do not retry or replace a throttled request.
    if (primaryError.retryAfter || primaryError.status === 429) throw primaryError;
  }
  const fallbackUrl = new URL(EUROPE_ROOT);
  fallbackUrl.search = new URLSearchParams({ query: europePmcQuery(cleanQuery), resultType: 'core', format: 'json', pageSize: '8' }).toString();
  try {
    const response = await fetchPublic(fetcher, fallbackUrl.href, { provider: 'europe-pmc', state, now, signal });
    let data;
    try { data = await response.json(); } catch { throw new LiteratureSearchError('Europe PMC 返回的检索响应格式无效。'); }
    return parseEuropePmcArticles(data, cleanQuery, now);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const fallbackError = error instanceof LiteratureSearchError ? error : new LiteratureSearchError('Europe PMC 文献检索暂未完成。');
    throw new LiteratureSearchError(`${primaryError.message} ${fallbackError.message} 本次没有获得可用的文献结果，请稍后重试。`, fallbackError.status, fallbackError.retryAfter);
  }
}
