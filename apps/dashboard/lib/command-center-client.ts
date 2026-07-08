import { supabase } from "@/lib/supabase/client";

// Asks the Command Center orchestrator a question. The backend returns ONLY
// the synthesized answer -- routing details (which modules were consulted,
// tool calls, reasoning) are server-side and never reach the client.
export async function askCommandCenter(question: string): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not signed in");
  }

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/command-center/ask`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ question }),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }

  const data = (await res.json()) as { answer: string };
  return data.answer;
}
