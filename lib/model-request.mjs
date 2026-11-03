/** Provider-specific options are confined to the documented host/model pair. */
export function chatCompletionPayload(config, request) {
  let siliconFlow = false;
  try { siliconFlow = ['api.siliconflow.cn', 'api.siliconflow.com'].includes(new URL(config.LLM_BASE_URL).hostname); } catch {}
  const hybridDeepSeek = /^(?:Pro\/)?deepseek-ai\/DeepSeek-V3\.2(?:-Exp)?$/i.test(config.LLM_MODEL || '');
  return { ...request, model: config.LLM_MODEL, stream: false,
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
