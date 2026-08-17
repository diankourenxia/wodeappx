export interface AgentSseParseState {
  buffer: string;
}

export interface AgentToolCall {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
}

export interface AgentToolResult {
  id: string;
  tool: string;
  result: string;
  isError?: boolean;
}

export type AgentStreamEvent =
  | { type: 'session_init'; conversationId?: string; runId?: string }
  | { type: 'thinking'; content?: string }
  | ({ type: 'tool_call' } & AgentToolCall)
  | ({ type: 'tool_result' } & AgentToolResult)
  | { type: 'message'; content?: string }
  | { type: 'done'; conversationId?: string; runId?: string; usage?: unknown }
  | { type: 'error'; error?: string }
  | ({ type: 'ui_action' } & Record<string, unknown>);

export interface AgentChatRequest {
  message: string;
  projectId?: string | null;
  conversationId?: string | null;
  model?: string | null;
  pageContext?: string | null;
}

export function createAgentSseParseState(): AgentSseParseState {
  return { buffer: '' };
}

export function parseAgentSseChunk(state: AgentSseParseState, chunk: string): AgentStreamEvent[] {
  state.buffer += chunk;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() || '';

  const events: AgentStreamEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const data = trimmed.slice(6);
    if (!data || data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data) as AgentStreamEvent;
      if (parsed && typeof parsed.type === 'string') {
        events.push(parsed);
      }
    } catch {
      // Ignore malformed SSE frames; the next chunk may still be valid.
    }
  }

  return events;
}

export function isAgentProjectWriteTool(tool: string): boolean {
  const lower = tool.toLowerCase();
  return (
    lower === 'project_publish'
    || lower.includes('publish')
    || /^page_(create|update|delete)/.test(lower)
    || /^project_(create|publish|clone)/.test(lower)
    || lower.includes('generate_page')
    || lower.includes('modify_section')
  );
}
