import test from'node:test';import assert from'node:assert/strict';import{targetResearch,TargetResearchError,targetMentions}from'../lib/target-research.ts';
const target={id:'ENSG00000146648',approvedSymbol:'EGFR',approvedName:'epidermal growth factor receptor',biotype:'protein_coding',functionDescriptions:['Source function'],pathways:[],associatedDiseases:{count:1,rows:[{score:0.8,disease:{id:'MONDO_1',name:'Disease'}}]},drugAndClinicalCandidates:{count:0,rows:[]}};
test('target adapter uses only fixed official endpoint, bounded search and server-provided target IDs',async()=>{
 let calls=0;const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://api.platform.opentargets.org/api/v4/graphql');const body=JSON.parse(init.body);assert.equal(body.variables.q,'TEST-GENE-VALIDATION');assert.match(body.query,/entityNames:\["target"\]/);return Response.json({data:{search:{hits:[{id:target.id,name:'EGFR',entity:'target'}]}}});};
 const r=await targetResearch({query:'TEST-GENE-VALIDATION'},fetcher);assert.equal(r.hits[0].name,'EGFR');await targetResearch({query:'TEST-GENE-VALIDATION'},fetcher);assert.equal(calls,1);
 await assert.rejects(targetResearch({id:'https://attacker.invalid'},fetcher),e=>e instanceof TargetResearchError&&e.status===400);assert.equal(calls,1);
});
test('target profile validates response and never turns errors or missing targets into successful empty dossiers',async()=>{
 const r=await targetResearch({id:target.id},async()=>Response.json({data:{target}}));assert.equal(r.target.sourceUrl,'https://platform.opentargets.org/target/'+target.id);assert.equal(r.target.associatedDiseases.rows[0].score,0.8);
 await assert.rejects(targetResearch({id:'ENSG00000000001'},async()=>Response.json({errors:[{message:'internal upstream details'}]})),e=>e instanceof TargetResearchError&&!e.message.includes('internal'));
 await assert.rejects(targetResearch({id:'ENSG00000000002'},async()=>Response.json({data:{target:null}})),e=>e.status===404);
 assert.equal(targetMentions('EGFR signaling','EGFR'),true);assert.equal(targetMentions('VEGFR1','EGFR'),false);
});
