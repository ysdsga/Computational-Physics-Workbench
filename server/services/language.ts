import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export type Language = 'en' | 'zh-CN';
const requestLanguage = new AsyncLocalStorage<Language>();

/** Honor supported language preferences; old clients without a preference keep Chinese. */
export function negotiateLanguage(header: string | undefined, fallback: Language = 'zh-CN'): Language {
  const preferences = (header ?? '').split(',').map((entry, index) => {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(';');
    const weight = parameters.find(value => value.trim().startsWith('q='));
    const quality = weight ? Number(weight.trim().slice(2)) : 1;
    return { tag, quality, index };
  }).filter(item => Number.isFinite(item.quality) && item.quality > 0 && item.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of preferences) {
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
  }
  return fallback;
}

export const languageMiddleware: RequestHandler = (req, res, next) => {
  const language = negotiateLanguage(req.get('Accept-Language'));
  res.vary('Accept-Language');
  requestLanguage.run(language, next);
};

/** Only call at a generated prose source, never over arbitrary stored/user content. */
export function generatedText(english: string, chinese: string): string {
  return requestLanguage.getStore() === 'en' ? english : chinese;
}

export function serverText(english: string, chinese: string): string {
  return negotiateLanguage(process.env.WORKBENCH_LANG, 'en') === 'en' ? english : chinese;
}

const executionNotes: Record<string, string> = {
  'Codex 在 Task 根内运行已记录脚本；输入哈希变化时生成新 Action。': 'Codex runs the recorded script within the Task root; changed input hashes require a new Action.',
  '只取消当前 Run 自己创建且已被替代或确认错误的作业。': 'Cancel only jobs created by this Run that have been superseded or confirmed incorrect.',
  '远程位置从 Task Spec 采用的连接和 Task 目录映射派生。': 'The remote location is derived from the connection and Task directory mapping adopted by the Task Spec.',
  '只创建登记在项目根下的这一条 Task 目录。': 'Create only this registered Task directory under the project root.',
  '上传一个带输入哈希的 Task 内文件。': 'Upload one file within the Task with its input hash.',
  '下载到 Task 根后登记为 Artifact；用户根范围只读。': 'Download into the Task root and register an Artifact; the user root is read-only.',
  '每次提交先落库再调用 bsub；响应不确定时只按唯一作业名对账，绝不重提。': 'Record every submission before calling bsub; if the response is uncertain, reconcile by the unique job name and never resubmit.',
};

/** Display copy only; the Action spec and its provenance hash remain canonical. */
export function executionPreviewForDisplay(preview: Record<string, unknown>): Record<string, unknown> {
  const note = preview.note;
  return { ...preview, ...(typeof note === 'string' && Object.hasOwn(executionNotes, note) ? { note: generatedText(executionNotes[note], note) } : {}) };
}
