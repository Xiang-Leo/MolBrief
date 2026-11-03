import test from 'node:test';
import assert from 'node:assert/strict';
import {chatCompletionPayload,completionContent,readCompletionResponse,ModelResponseError} from '../lib/model-request.mjs';

test('SiliconFlow hybrid DeepSeek summaries and connection tests request the final answer without extra thinking',()=>{
  const config={LLM_BASE_URL:'https://api.siliconflow.cn/v1',LLM_MODEL:'deepseek-ai/DeepSeek-V3.2'};
  for(const request of [{max_tokens:64},{max_tokens:4000,response_format:{type:'json_object'}}]){
    const body=chatCompletionPayload(config,request);
    assert.equal(body.enable_thinking,false);assert.equal(body.stream,false);assert.equal(body.max_tokens,request.max_tokens);
    assert.equal(body.model,config.LLM_MODEL);assert.equal(request.enable_thinking,undefined);
  }
});
test('provider-specific thinking parameters never leak to other model hosts or unrelated models',()=>{
  for(const [url,model] of [['https://api.siliconflow.cn.evil.invalid/v1','deepseek-ai/DeepSeek-V3.2'],['https://model.example.invalid/v1','deepseek-ai/DeepSeek-V3.2'],['https://api.siliconflow.cn/v1','different-model']])assert.equal(chatCompletionPayload({LLM_BASE_URL:url,LLM_MODEL:model},{}).enable_thinking,undefined);
});
test('truncated or reasoning-only model responses cannot become a saved summary',()=>{
  assert.throws(()=>completionContent({choices:[{finish_reason:'length',message:{content:'{"summary":"partial"}'}}]}),e=>e instanceof ModelResponseError&&e.code==='model-truncated');
  assert.throws(()=>completionContent({choices:[{message:{content:null,reasoning_content:'private reasoning'}}]}),e=>e instanceof ModelResponseError&&e.code==='model-empty');
});
test('only a complete JSON fence is unwrapped; surrounding prose remains subject to strict JSON validation',()=>{
  assert.equal(completionContent({choices:[{message:{content:'```json\n{"ok":true}\n```'}}]}),'{"ok":true}');
  assert.equal(completionContent({choices:[{message:{content:'Here is JSON: {"ok":true}'}}]}),'Here is JSON: {"ok":true}');
});
test('streaming completions preserve split Unicode final output without exposing reasoning',async()=>{
  const text=': heartbeat\r\ndata: '+JSON.stringify({choices:[{delta:{reasoning_content:'never use reasoning'}}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[{delta:{content:'{"摘要":"中文"}'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n';
  const bytes=new TextEncoder().encode(text);let offset=0;
  const response=new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+3));offset+=3;}}),{headers:{'content-type':'text/event-stream'}});
  const parsed=await readCompletionResponse(response);assert.equal(completionContent(parsed),'{"摘要":"中文"}');assert.ok(!JSON.stringify(parsed).includes('reasoning'));
});
test('an interrupted stream is rejected and JSON fallback providers remain supported',async()=>{
  await assert.rejects(readCompletionResponse(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n',{headers:{'content-type':'text/event-stream'}})),ModelResponseError);
  const response={choices:[{message:{content:'{"ok":true}'}}]};assert.deepEqual(await readCompletionResponse(Response.json(response)),response);
});
