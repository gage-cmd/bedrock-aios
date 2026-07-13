import { apiFetch } from "@/lib/api";

// Asks the Command Center orchestrator a question. The backend returns ONLY
// the synthesized answer -- routing details (which modules were consulted,
// tool calls, reasoning) are server-side and never reach the client.
export async function askCommandCenter(question: string): Promise<string> {
  const data = await apiFetch<{ answer: string }>("/command-center/ask", {
    method: "POST",
    body: { question },
  });
  return data.answer;
}
