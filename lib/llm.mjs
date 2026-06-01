/**
 * @module llm
 * LLM client for llama.cpp / Ollama with retry logic and timeout handling.
 *
 * Provides:
 * - llamaChat() — generic chat completions with exponential backoff
 * - llmGetFixes() — ask LLM to generate missing SKILL.md sections
 * - applyFixes() — merge LLM-generated fixes into original content
 */

/**
 * @typedef {Object} LlmOptions
 * @property {number} [maxTokens=1024]
 * @property {number} [temperature=0.7]
 */

/**
 * @typedef {Object} LlmClientConfig
 * @property {string} host - LLM API host (e.g. http://localhost:8081)
 * @property {string} model - Model name/identifier
 * @property {"llama"|"ollama"} provider - Provider type (affects timeout)
 */

/**
 * Create an LLM client bound to a specific host/model/provider.
 *
 * @param {LlmClientConfig} config
 * @returns {{ chat: typeof llamaChat, getFixes: typeof llmGetFixes, applyFixes: typeof applyFixes }}
 */
export function createLlmClient(config) {
  const { host, model, provider } = config;

  /**
   * Send a chat completion request with retry logic.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {LlmOptions} [options]
   * @returns {Promise<string>} The assistant's response text
   */
  async function chat(messages, { maxTokens = 1024, temperature = 0.7 } = {}) {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeoutMs = provider === "ollama" ? 120_000 : 300_000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(`${host}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`LLM error ${resp.status}: ${text}`);
        }

        const data = await resp.json();
        const msg = data.choices[0]?.message;
        return msg?.content || msg?.reasoning_content || "";
      } catch (e) {
        const isRetryable =
          e.name === "AbortError" ||
          e.message.includes("fetch failed") ||
          e.message.includes("ECONNREFUSED");
        if (attempt < MAX_ATTEMPTS && isRetryable) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          console.log(
            `  Attempt ${attempt}/${MAX_ATTEMPTS} failed (${e.message}), retrying in ${backoffMs}ms...`
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  /**
   * Ask the LLM to generate missing sections for a SKILL.md file.
   *
   * @param {string} skillContent - Current SKILL.md content
   * @param {string} issues - Newline-separated list of issues
   * @returns {Promise<string>} LLM-generated markdown to append
   */
  async function getFixes(skillContent, issues) {
    const MAX_SKILL_CHARS = 2000;
    const truncated =
      skillContent.length > MAX_SKILL_CHARS
        ? skillContent.slice(0, MAX_SKILL_CHARS) + "\n\n[... truncated ...]"
        : skillContent;

    const maxTokens = provider === "ollama" ? 256 : 1024;

    return chat(
      [
        {
          role: "system",
          content:
            "You are a SKILL.md editor. Output ONLY the sections to ADD to the file, not the full file. Keep it minimal. Format: exactly the markdown content to append, nothing else. /no_think",
        },
        {
          role: "user",
          content: `Current SKILL.md:\n\n${truncated}\n\nMissing sections:\n${issues}\n\nOutput ONLY the missing sections to append:`,
        },
      ],
      { maxTokens }
    );
  }

  return { chat, getFixes, applyFixes };
}

/**
 * Merge LLM-generated fixes into original content.
 * Strips markdown code fences if present.
 *
 * @param {string} originalContent - The original SKILL.md content
 * @param {string} fixes - LLM-generated markdown to append
 * @returns {string|null} Merged content, or null if fixes are too short/empty
 */
export function applyFixes(originalContent, fixes) {
  if (!fixes || fixes.length < 20) return null;
  // Strip markdown code fences if present
  const cleaned = fixes
    .replace(/^```[\w]*\n?/gm, "")
    .replace(/```$/gm, "")
    .trim();
  if (!cleaned) return null;
  return originalContent.trimEnd() + "\n\n" + cleaned + "\n";
}
