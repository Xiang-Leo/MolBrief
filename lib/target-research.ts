import {z} from 'zod';
export const TARGET_API='https://api.platform.opentargets.org/api/v4/graphql';
export const targetSearchQuery=`query($q:String!){search(queryString:$q,entityNames:["target"],page:{index:0,size:8}){hits{id name entity}}}`;
export const targetDetailQuery=`query($id:String!){target(ensemblId:$id){id approvedSymbol approvedName biotype functionDescriptions pathways{pathway pathwayId} associatedDiseases(page:{index:0,size:10}){count rows{score disease{id name}}} drugAndClinicalCandidates{count rows{maxClinicalStage drug{id name} diseases{disease{id name} diseaseFromSource}}}}}`;
const short=z.string().max(2000),gene=z.string().regex(/^ENSG\d{11}$/);
export const targetResultSchema=z.object({id:gene,approvedSymbol:short,approvedName:short,biotype:short,functionDescriptions:z.array(z.string().max(40000)),pathways:z.array(z.object({pathway:short,pathwayId:short})),associatedDiseases:z.object({count:z.number(),rows:z.array(z.object({score:z.number().min(0).max(1),disease:z.object({id:short,name:short})}))}),drugAndClinicalCandidates:z.object({count:z.number(),rows:z.array(z.object({maxClinicalStage:short,drug:z.object({id:short,name:short}).nullable(),diseases:z.array(z.object({disease:z.object({id:short,name:short}).nullable(),diseaseFromSource:short.nullable()}))}))})});
export type TargetProfile=z.infer<typeof targetResultSchema> & {retrievedAt:string;sourceUrl:string};
export class TargetResearchError extends Error {constructor(message:string,public status=502){super(message);}}
const cache=new Map<string,{until:number;data:unknown}>(),pending=new Map<string,Promise<unknown>>();let retryUntil=0;
export async function targetResearch(input:{query?:string;id?:string},fetcher:typeof fetch=fetch):Promise<unknown>{
 const id=input.id?gene.safeParse(input.id):null,q=input.query?.trim();
 if(input.id&&!id?.success||!input.id&&(!q||q.length>100))throw new TargetResearchError('请输入100字以内的基因符号或靶点名称。',400);
 const key=input.id||q!,saved=cache.get(key);if(saved&&saved.until>Date.now())return saved.data;
 if(pending.has(key))return pending.get(key);
 if(Date.now()<retryUntil)throw new TargetResearchError('Open Targets 要求暂缓请求，请稍后重试。',429);
 if(pending.size>=4)throw new TargetResearchError('靶点查询正在运行，请稍候。',429);
 const work=(async()=>{try{
 const r=await fetcher(TARGET_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:input.id?targetDetailQuery:targetSearchQuery,variables:input.id?{id:input.id}:{q}}),signal:AbortSignal.timeout(25000),redirect:'error'});
 if(r.status===429){const delay=Number(r.headers.get('retry-after'));retryUntil=Date.now()+(Number.isFinite(delay)&&delay>0?Math.min(delay,3600):60)*1000;throw new TargetResearchError('Open Targets 请求限流，请稍后重试。',429);}
 if(!r.ok)throw new TargetResearchError('官方靶点数据暂不可用，已有资料保持不变。');
 const reader=r.body?.getReader();if(!reader)throw new TargetResearchError('靶点服务返回空响应。');let raw='',bytes=0;const decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2000000){await reader.cancel();throw new TargetResearchError('靶点记录过大，请打开官方页面查看。');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
 const body=JSON.parse(raw);if(body.errors)throw new TargetResearchError('官方靶点接口结构已变化，请打开官方页面核对。');
 let data:unknown;if(input.id){if(!body.data?.target)throw new TargetResearchError('未找到这个人类靶点。',404);const parsed=targetResultSchema.parse(body.data.target);data={target:{...parsed,drugAndClinicalCandidates:{...parsed.drugAndClinicalCandidates,rows:parsed.drugAndClinicalCandidates.rows.slice(0,20)},retrievedAt:new Date().toISOString(),sourceUrl:'https://platform.opentargets.org/target/'+parsed.id}};}else{data={hits:z.array(z.object({id:gene,name:short,entity:z.literal('target')})).max(8).parse(body.data?.search?.hits)};}
 if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{until:Date.now()+3600000,data});return data;
 }catch(e){if(e instanceof TargetResearchError)throw e;throw new TargetResearchError('靶点查询超时或返回格式无效，请稍后重试。');}})();
 pending.set(key,work);try{return await work;}finally{pending.delete(key);}
}
/** Label matches are reading leads, never curated target/drug assertions. */
export function targetMentions(text:string,symbol:string){const escaped=symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^a-zA-Z0-9])'+escaped+'(?=$|[^a-zA-Z0-9])','i').test(text);}
