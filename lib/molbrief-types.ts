export type Category = "产业" | "临床" | "研究" | "工具";
export type Article = {
  id: string;
  title: string;
  originalTitle?: string;
  category: Category;
  publishedAt: string | null;
  url: string;
  source: string;
  type: string;
  summary: string;
  keyPoints: string[];
  limitations: string;
  topics: string[];
  readingBasis: string;
  group: string;
  collectedAt: string;
  coverSource?: string | null;
};
export type Topic = {
  id: string; name: string; query: string;
  kind: "core" | "explore"; reason: string; createdAt: string; expiresAt: string | null;
};
export type Preferences = {
  autoExplore: boolean;
  voiceUri: string;
  speed: number;
  audioMode: "device" | "cloud";
  explorationRatio: number;
};
export type Capabilities = {
  parallel: boolean; llm: boolean; tts: boolean; codex: boolean;
};
export type UserState = {
  signedIn: boolean; displayName: string;
  saved: string[]; read: string[]; topics: Topic[];
  preferences: Preferences; capabilities: Capabilities;
};
export const DEFAULT_PREFERENCES: Preferences = {
  autoExplore: true, voiceUri: "", speed: 1, audioMode: "device", explorationRatio: 20,
};
export const STARTER_TOPICS = [
  { name: "AI 制药", query: '("drug discovery"[Title/Abstract]) AND ("artificial intelligence"[Title/Abstract] OR "generative"[Title/Abstract])' },
  { name: "VHH", query: '(nanobody[Title/Abstract] OR VHH[Title/Abstract])' },
  { name: "抗体设计", query: 'antibody design[Title/Abstract]' },
  { name: "药企动态", query: 'pharmaceutical research collaboration' },
];
