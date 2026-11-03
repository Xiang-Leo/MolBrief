/** Provider-specific options are confined to the documented host/model pair. */
export function chatCompletionPayload(config, request) {
  let siliconFlow = false;
  try { siliconFlow = ['api.siliconflow.cn', 'api.siliconflow.com'].includes(new URL(config.LLM_BASE_URL).hostname); } catch {}
  const hybridDeepSeek = /^(?:Pro\/)?deepseek-ai\/DeepSeek-V3\.2(?:-Exp)?$/i.test(config.LLM_MODEL || '');
  return { ...request, model: config.LLM_MODEL, stream: request.stream===true,
    ...(siliconFlow && hybridDeepSeek ? { enable_thinking: false } : {}),
  };
}

export class ModelResponseError extends Error {
  constructor(message, code) { super(message); this.name = 'ModelResponseError'; this.code = code; }
}
export function completionContent(response) {
  const choice = response?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new ModelResponseError('模型输出达到长度上限，未保存不完整的解读。', 'model-truncated');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new ModelResponseError('模型没有返回最终解读，原始内容已保留。', 'model-empty');
  const value = content.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(value);
  return fenced ? fenced[1].trim() : value;
}

/** Consume final-answer deltas only; reasoning text never becomes article data. */
export async function readCompletionResponse(response){
  if(!response.headers.get('content-type')?.includes('text/event-stream'))return response.json();
  const reader=response.body?.getReader();
  if(!reader)throw new ModelResponseError('模型未返回输出。','model-empty');
  const decoder=new TextDecoder();let buffer='',content='',finished=false,reason=null,bytes=0;
  const line=value=>{
    if(!value.startsWith('data:'))return;
    const data=value.slice(5).trim();if(!data)return;if(data==='[DONE]'){finished=true;return;}
    let event;try{event=JSON.parse(data);}catch{throw new ModelResponseError('模型流式输出格式无效。','model-invalid');}
    if(event.error)throw new ModelResponseError('模型流式生成失败，原始资料已保留。','model-invalid');
    const choice=event.choices?.[0];if(typeof choice?.delta?.content==='string')content+=choice.delta.content;
    if(choice?.finish_reason)reason=choice.finish_reason;
  };
  try{
    for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
      if(bytes>2000000)throw new ModelResponseError('模型输出超过允许长度。','model-truncated');
      buffer+=decoder.decode(part.value,{stream:true});let next;
      while((next=buffer.indexOf('\n'))>=0){line(buffer.slice(0,next).replace(/\r$/,''));buffer=buffer.slice(next+1);}
    }
    buffer+=decoder.decode();if(buffer.trim())line(buffer.trim());
    if(!finished&&!['stop','length'].includes(reason))throw new ModelResponseError('模型输出中断，未保存不完整的解读。','model-invalid');
    return {choices:[{message:{content},finish_reason:reason}]};
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
