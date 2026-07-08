import Anthropic from '@anthropic-ai/sdk';
import {
  AiContentBlock,
  AiCreateMessageParams,
  AiResponse,
} from './ai-client.interface';
import type { AiClient } from './ai-client.interface';

// Real AiClient backed by the Anthropic Messages API, shared by every caller
// that needs the model (the Command Center orchestrator and the Executive
// Oversight report engine). The model is supplied by the caller's
// constructor -- each caller reads its own env var (ORCHESTRATOR_MODEL,
// REPORT_MODEL) so the model is never hardcoded at the call site. Auth comes
// from ANTHROPIC_API_KEY, which the SDK reads from the environment itself.
// claude-sonnet-5 notes: adaptive thinking is on by default (thinking blocks
// may appear in content and are passed through untouched so the loop can echo
// them back), and sampling params like temperature are rejected -- none sent.
export class AnthropicAiClient implements AiClient {
  private readonly client = new Anthropic();

  constructor(private readonly model: string) {}

  async createMessage(params: AiCreateMessageParams): Promise<AiResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
      tools: params.tools as unknown as Anthropic.Tool[],
    });

    return {
      content: response.content as AiContentBlock[],
      stop_reason: response.stop_reason,
    };
  }
}
