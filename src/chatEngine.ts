import type { ChatSettings } from './types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class ChatEngine {
  private history: ChatMessage[] = [];

  constructor(private getSettings: () => ChatSettings) {}

  clear(): void {
    this.history = [];
  }

  async send(message: string): Promise<string> {
    const settings = this.getSettings();
    this.history.push({ role: 'user', content: message });

    if (!settings.endpoint.trim()) {
      const reply = this.localFallback(message, settings);
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    }

    const endpoint = settings.endpoint.trim().replace(/\/$/, '');
    const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.model.trim() || 'default',
        messages: [
          {
            role: 'system',
            content: `You are ${settings.characterName || 'the selected character'}. ${settings.personality || 'Be natural, conversational and concise.'}`,
          },
          ...this.history.slice(-20),
        ],
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Chat endpoint returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('The chat endpoint returned no message.');

    this.history.push({ role: 'assistant', content: reply });
    return reply;
  }

  private localFallback(message: string, settings: ChatSettings): string {
    const name = settings.characterName || 'Character';
    const lower = message.toLowerCase();
    if (/\b(hello|hi|hey)\b/.test(lower)) return `Hey. I'm ${name}. Load an AI endpoint in Settings when you want full generative chat.`;
    if (lower.includes('who are you')) return `I'm ${name}. My movement controls are handled by Anicontroller's Director, separately from this chat.`;
    if (lower.includes('move') || lower.includes('pose')) return `Use the Director box for exact movement commands. I won't override those controls.`;
    return `${name}: I can keep the interface responsive offline, but full AI chat needs a configured local or remote OpenAI-compatible endpoint.`;
  }
}
