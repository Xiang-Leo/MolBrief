import { getDatabase } from './local-storage';
import { ServiceConfigError, ServiceConfigStore } from './service-config-core.mjs';

export { ServiceConfigError };
export type ServiceName = 'parallel' | 'llm' | 'tts';
export type ServiceFieldName = 'PARALLEL_API_KEY' | 'LLM_BASE_URL' | 'LLM_API_KEY' | 'LLM_MODEL' | 'MINIMAX_API_KEY' | 'MINIMAX_VOICE_ID' | 'MINIMAX_MODEL';
export type ServiceSettings = {
  fields: Record<ServiceFieldName, { present: boolean; source: 'database' | 'environment' | 'default' | 'empty'; value?: string }>;
  services: Record<ServiceName, { status: 'unconfigured' | 'configured' | 'verified'; verifiedAt: string | null; verificationSupported: boolean }>;
  encryption: 'session-secret';
};
export type ServiceVerification = ServiceSettings & { verification: { service: ServiceName; ok: boolean; message: string }; error?: string; httpStatus: number };

const store = () => new ServiceConfigStore({ database: getDatabase() });
export const getServiceRuntime = () => store().runtime() as Record<ServiceFieldName, string>;
export const getServiceSettings = () => store().settings() as ServiceSettings;
export const saveServiceSettings = (values: Partial<Record<ServiceFieldName, string>>, clear: ServiceFieldName[] = []) => store().save(values, clear) as ServiceSettings;
export const verifyService = async (service: ServiceName) => store().verify(service) as Promise<ServiceVerification>;
