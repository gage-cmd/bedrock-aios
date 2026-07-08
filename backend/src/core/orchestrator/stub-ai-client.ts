import { AiCreateMessageParams, AiResponse } from './ai-client.interface';
import type { AiClient } from './ai-client.interface';

// Test double for the orchestrator's agent loop: plays back a scripted
// sequence of responses (canned tool-call decisions, then a final text
// answer) and records every request it receives, so unit tests can assert on
// the system prompt, tool definitions, and tool_result messages without
// spending real API tokens.
export class StubAiClient implements AiClient {
  readonly calls: AiCreateMessageParams[] = [];

  private turn = 0;

  constructor(private readonly script: AiResponse[]) {}

  createMessage(params: AiCreateMessageParams): Promise<AiResponse> {
    this.calls.push(params);
    const response = this.script[this.turn];
    if (!response) {
      return Promise.reject(
        new Error(`StubAiClient script exhausted after ${this.turn} turns`),
      );
    }
    this.turn += 1;
    return Promise.resolve(response);
  }
}
