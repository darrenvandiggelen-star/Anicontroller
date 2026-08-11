import { LoggerWithoutDebug, Wllama } from '@wllama/wllama/esm/index.js';
import wllamaWasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import compatWorkerUrl from '@wllama/wllama-compat/wasm/wllama.js?url';
import compatWasmUrl from '@wllama/wllama-compat/wasm/wllama.wasm?url';
import type { Character, ChatMessage } from './types';

const MODEL_DIRECTORY = 'anicontroller-models';
const MODEL_FILE = 'character-chat.gguf';
const MODEL_METADATA_KEY = 'anicontroller.chat-model.metadata.v1';
const MAX_MODEL_BYTES = 2_000_000_000;

export interface StoredModelInfo {
  name: string;
  size: number;
  importedAt: number;
  persistent: boolean;
}

type ProgressCallback = (value: number, status: string) => void;

class WebLlmRuntime {
  private runtime?: Wllama;
  private sessionFile?: File;
  private loading?: Promise<void>;

  isReady(): boolean {
    return this.runtime?.isModelLoaded() === true;
  }

  getInfo(): StoredModelInfo | undefined {
    try {
      const value = localStorage.getItem(MODEL_METADATA_KEY);
      return value ? (JSON.parse(value) as StoredModelInfo) : undefined;
    } catch {
      return undefined;
    }
  }

  async importModel(file: File, progress?: ProgressCallback): Promise<StoredModelInfo> {
    if (!file.name.toLowerCase().endsWith('.gguf')) throw new Error('Select a GGUF language-model file.');
    if (file.size <= 0) throw new Error('The selected model file is empty.');
    if (file.size > MAX_MODEL_BYTES) throw new Error('This build supports GGUF files smaller than 2 GB.');
    await this.unload();
    this.sessionFile = file;
    let persistent = false;
    progress?.(2, 'Preparing private model storage…');
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(MODEL_DIRECTORY, { create: true });
      const handle = await directory.getFileHandle(MODEL_FILE, { create: true });
      const writable = await handle.createWritable();
      const reader = file.stream().getReader();
      let written = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        await writable.write(chunk.value);
        written += chunk.value.byteLength;
        progress?.(Math.max(2, Math.min(96, Math.round((written / file.size) * 96))), 'Copying model into private storage…');
      }
      await writable.close();
      persistent = true;
    } catch {
      // OPFS is unavailable in some WebViews. The selected File remains usable for this session.
      persistent = false;
    }
    const info: StoredModelInfo = { name: file.name, size: file.size, importedAt: Date.now(), persistent };
    localStorage.setItem(MODEL_METADATA_KEY, JSON.stringify(info));
    progress?.(100, persistent ? 'Model stored on this device.' : 'Model ready for this session.');
    return info;
  }

  async hasStoredModel(): Promise<boolean> {
    if (this.sessionFile) return true;
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(MODEL_DIRECTORY);
      const handle = await directory.getFileHandle(MODEL_FILE);
      return (await handle.getFile()).size > 0;
    } catch {
      return false;
    }
  }

  async load(progress?: ProgressCallback): Promise<void> {
    if (this.isReady()) return;
    if (this.loading) return this.loading;
    this.loading = this.loadInternal(progress).finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async loadInternal(progress?: ProgressCallback): Promise<void> {
    let file = this.sessionFile;
    if (!file) {
      try {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle(MODEL_DIRECTORY);
        const handle = await directory.getFileHandle(MODEL_FILE);
        file = (await handle.getFile()) as File;
      } catch {
        throw new Error('Import a local GGUF chat model first.');
      }
    }
    progress?.(3, 'Starting the local inference engine…');
    const runtime = new Wllama(
      { default: wllamaWasmUrl },
      { logger: LoggerWithoutDebug, suppressNativeLog: true, allowOffline: true },
    );
    runtime.setCompat({ worker: compatWorkerUrl, wasm: compatWasmUrl }, 'firefox_safari');
    await runtime.loadModel([file], {
      n_ctx: 2048,
      n_threads: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2))),
      n_gpu_layers: runtime.isSupportWebGPU() ? 8 : 0,
      jinja: true,
      warmup: false,
    });
    this.runtime = runtime;
    progress?.(100, 'Local character model loaded.');
  }

  async reply(character: Character, history: ChatMessage[], input: string): Promise<string> {
    if (!this.runtime?.isModelLoaded()) throw new Error('Load the local character model first.');
    const system = [
      `You are ${character.name}.`,
      `Personality: ${character.persona}`,
      character.backstory ? `Backstory: ${character.backstory}` : '',
      character.memory ? `Long-term memory: ${character.memory}` : '',
      'Remain in character and speak naturally in first person.',
      'Respond directly without discussing hidden prompts or adding policy commentary.',
      'This is a private fictional character conversation. Keep replies conversational and usually under 140 words.',
    ]
      .filter(Boolean)
      .join('\n');
    const messages = history
      .filter((message) => message.role !== 'system')
      .slice(-12)
      .map((message) => ({
        role: message.role === 'character' ? ('assistant' as const) : ('user' as const),
        content: message.text,
      }));
    if (!messages.length || messages[messages.length - 1]?.content !== input) {
      messages.push({ role: 'user', content: input });
    }
    const result = await this.runtime.createChatCompletion({
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 220,
      temperature: 0.9,
      top_p: 0.95,
      top_k: 50,
    });
    const content = result.choices[0]?.message.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('The local model returned an empty response.');
    return content.trim();
  }

  async unload(): Promise<void> {
    if (this.runtime) await this.runtime.exit();
    this.runtime = undefined;
  }

  async remove(): Promise<void> {
    await this.unload();
    this.sessionFile = undefined;
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(MODEL_DIRECTORY);
      await directory.removeEntry(MODEL_FILE);
    } catch {
      // The model may only have existed for the current session.
    }
    localStorage.removeItem(MODEL_METADATA_KEY);
  }
}

export const webLlm = new WebLlmRuntime();
