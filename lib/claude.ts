import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "./env.js";

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You are researching a specific problem for a paid how-to guide. Use web search to find accurate, current, and specific information: root causes, official documentation, and community-verified fixes.

Write your findings as clean Markdown with exactly these sections, in this order:

## Problem
## Root Causes
## Step-by-Step Fix
## Resources

Be concrete and specific rather than generic — this content becomes a guide someone is paying for. List the sources you actually used under Resources as a Markdown link list. If you're not confident about something, say so rather than guessing.`;

function getClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
}

export async function researchProblem(problemStatement: string, examples: string[]): Promise<string> {
  const client = getClient();

  const exampleBlock = examples.length
    ? `\n\nHow people are actually describing this problem:\n${examples.map((e) => `- ${e.split("\n\n")[0]}`).join("\n")}`
    : "";

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Research this problem and write the guide content: "${problemStatement}"${exampleBlock}`,
    },
  ];

  // Server-side web search can hit its default 10-round-trip limit mid-task,
  // returning stop_reason "pause_turn" — resend the assistant turn as-is so
  // it can continue, rather than treating a pause as a finished answer.
  for (let attempt = 0; attempt < 3; attempt++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages,
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new Error(`Claude refused the research request: ${JSON.stringify(message.stop_details)}`);
    }

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");

    if (!text.trim()) {
      throw new Error("Claude returned no text content for the research request.");
    }

    return text;
  }

  throw new Error("Research request paused repeatedly without completing (hit retry limit).");
}
