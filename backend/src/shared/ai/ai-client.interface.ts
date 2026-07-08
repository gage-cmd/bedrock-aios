// Minimal slice of the Anthropic Messages API the orchestrator needs, kept
// SDK-free so StubAiClient and unit tests never touch @anthropic-ai/sdk.
// Content blocks are intentionally open-shaped: the real API returns block
// types beyond text/tool_use (e.g. thinking blocks on claude-sonnet-5), and
// the whole assistant content array must be echoed back VERBATIM on the next
// turn of a tool loop -- stripping unknown blocks can 400.

export interface AiTextBlock {
  type: 'text';
  text: string;
}

export interface AiToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AiContentBlock =
  AiTextBlock | AiToolUseBlock | { type: string; [key: string]: unknown };

export function isTextBlock(block: AiContentBlock): block is AiTextBlock {
  return block.type === 'text';
}

export function isToolUseBlock(block: AiContentBlock): block is AiToolUseBlock {
  return block.type === 'tool_use';
}

export interface AiToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AiMessageParam {
  role: 'user' | 'assistant';
  content: string | (AiContentBlock | AiToolResultBlock)[];
}

export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiResponse {
  content: AiContentBlock[];
  stop_reason: string | null;
}

export interface AiCreateMessageParams {
  system: string;
  messages: AiMessageParam[];
  tools: AiTool[];
}

export interface AiClient {
  createMessage(params: AiCreateMessageParams): Promise<AiResponse>;
}
