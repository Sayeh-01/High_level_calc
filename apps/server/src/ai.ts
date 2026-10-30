import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { parseQuickCapture } from '@circle/shared';
import { z } from 'zod';

// The ai module (A10, B4). Claude when ANTHROPIC_API_KEY is set; a fake with recorded answers in tests. AI only ever returns
// drafts — routes never save what a model says; the user confirms through the normal create routes.

export const PARSE_MODEL = 'claude-haiku-5-5';
export const ASSISTANT_MODEL = 'claude-sonnet-5-5';

export type AiTask = 'capture' | 'chat_items' | 'catchup' | 'quiz' | 'assistant' | 'ocr' | 'receipt';

export class AiRefusal extends Error {}

export interface AiModel {
  /** Structured output validated against a zod schema (parsing/classification → Haiku). */
  json<S extends z.ZodType>(task: AiTask, a: { system: string; prompt: string; schema: S; maxTokens?: number; image?: { mime: string; base64: string } }): Promise<z.infer<S>>;
  /** Free text (summaries → Sonnet). */
  text(task: AiTask, a: { system: string; prompt: string; maxTokens?: number }): Promise<string>;
  /** Read the text in an image (vault OCR → Haiku). */
  readImage(task: AiTask, a: { system: string; image: { mime: string; base64: string } }): Promise<string>;
}

export function createClaudeModel(apiKey: string): AiModel {
  const client = new Anthropic({ apiKey });
  return {
    async json(_task, a) {
      const response = await client.messages.parse({
        model: PARSE_MODEL,
        max_tokens: a.maxTokens ?? 4000,
        system: a.system,
        messages: [
          {
            role: 'user',
            content: a.image
              ? [
                  { type: 'image', source: { type: 'base64', media_type: a.image.mime as 'image/jpeg', data: a.image.base64 } },
                  { type: 'text', text: a.prompt },
                ]
              : a.prompt,
          },
        ],
        output_config: { effort: 'low', format: zodOutputFormat(a.schema) },
      });
      if (response.stop_reason === 'refusal') throw new AiRefusal(response.stop_details?.category ?? 'refusal');
      if (response.parsed_output == null) throw new Error('model returned no parseable output');
      return response.parsed_output as z.infer<typeof a.schema>;
    },
    async text(_task, a) {
      // Claude Sonnet 5.5 + server-side refusal fallback (routes by refusal category; Claude API only).
      const response = await client.beta.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: a.maxTokens ?? 8000,
        system: a.system,
        messages: [{ role: 'user', content: a.prompt }],
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (response.stop_reason === 'refusal') throw new AiRefusal(response.stop_details?.category ?? 'refusal');
      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
    },
    async readImage(_task, a) {
      const response = await client.messages.create({
        model: PARSE_MODEL,
        max_tokens: 4000,
        system: a.system,
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: a.image.mime as 'image/jpeg', data: a.image.base64 } },
              { type: 'text', text: 'Transcribe all readable text in this document.' },
            ],
          },
        ],
      });
      if (response.stop_reason === 'refusal') throw new AiRefusal(response.stop_details?.category ?? 'refusal');
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
    },
  };
}

type Recorded = Partial<Record<AiTask, (prompt: string) => unknown>>;

/** Tests: recorded answers per task. The answer is validated against the route's schema exactly like a real one. */
export function createFakeModel(recorded: Recorded): AiModel & { calls: { task: AiTask; prompt: string }[] } {
  const calls: { task: AiTask; prompt: string }[] = [];
  return {
    calls,
    async json(task, a) {
      calls.push({ task, prompt: a.prompt });
      const fn = recorded[task];
      if (!fn) throw new Error(`no recorded answer for ${task}`);
      return a.schema.parse(fn(a.prompt));
    },
    async text(task, a) {
      calls.push({ task, prompt: a.prompt });
      const fn = recorded[task];
      if (!fn) throw new Error(`no recorded answer for ${task}`);
      return String(fn(a.prompt));
    },
    async readImage(task, a) {
      calls.push({ task, prompt: `[image ${a.image.mime} ${a.image.base64.length}b]` });
      const fn = recorded[task];
      if (!fn) throw new Error(`no recorded answer for ${task}`);
      return String(fn(a.image.base64));
    },
  };
}

/**
 * `AI_FAKE=1` (dev/E2E only): a deterministic stand-in so the AI screens can be exercised without a key. It reads the
 * JSON context block the routes put in the prompt and answers with simple rules.
 */
export function createRuleBasedModel(clock: () => Date = () => new Date()): AiModel {
  const ctx = (prompt: string) => {
    const m = /<context>([\s\S]*?)<\/context>/.exec(prompt);
    return m ? JSON.parse(m[1]) : {};
  };
  return createFakeModel({
    capture: (prompt) => {
      const c = ctx(prompt);
      const parsed = parseQuickCapture(c.text, clock(), c.timezone ?? 'Africa/Cairo');
      const lower = String(c.text).toLowerCase();
      const group = (c.groups ?? []).find((g: any) => lower.includes(String(g.name).toLowerCase()) || (g.members ?? []).some((m: any) => lower.includes(String(m.name).toLowerCase()))) ?? c.groups?.[0];
      const assignees = (group?.members ?? []).filter((m: any) => lower.includes(String(m.name).toLowerCase())).map((m: any) => m.userId);
      return { kind: /\b(match|meeting|lunch|dinner|party)\b/.test(lower) ? 'event' : 'task', title: parsed.title, groupId: group?.id ?? null, assigneeIds: assignees, when: parsed.when?.toISOString() ?? null, listId: null };
    },
    chat_items: (prompt) => {
      const c = ctx(prompt);
      const items = (c.messages ?? [])
        .filter((m: any) => /\b(let'?s|should we|can someone|remind|play|meet)\b|\?/.test(String(m.body).toLowerCase()))
        .slice(0, 3)
        .map((m: any) => {
          const p = parseQuickCapture(m.body, clock(), c.timezone ?? 'Africa/Cairo');
          return { kind: p.when ? 'event' : 'task', title: p.title.slice(0, 120), when: p.when?.toISOString() ?? null, sourceMessageId: m.id };
        });
      return { items };
    },
    catchup: (prompt) => {
      const c = ctx(prompt);
      return (c.messages ?? [])
        .slice(-5)
        .map((m: any) => `• ${m.author}: ${String(m.body).slice(0, 80)}`)
        .join('\n');
    },
    quiz: (prompt) => {
      const c = ctx(prompt);
      const sentences = String(c.text ?? '')
        .split(/(?<=[.!?؟])\s+|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.split(' ').length >= 3)
        .slice(0, c.count ?? 10);
      return { cards: sentences.map((s) => ({ front: `${s.split(' ').slice(0, Math.ceil(s.split(' ').length / 2)).join(' ')} …?`, back: s })) };
    },
    ocr: () => 'Scanned document (demo OCR): Policy No. 0000-DEMO',
    receipt: () => ({ title: 'Receipt (demo scan)', total: 25000, currency: null, items: [{ name: 'Demo item', amount: 25000 }] }),
  });
}
