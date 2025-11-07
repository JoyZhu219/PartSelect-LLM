const axios = require("axios");
const logger = console;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL =
  process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

/**
 * Call DeepSeek API for chat completion
 */
async function callDeepSeek(userMessage, history = [], options = {}) {
  const {
    systemPrompt = "You are a helpful PartSelect agent focused on refrigerator and dishwasher parts.",
    temperature = 0.7,
    maxTokens = 1000,
    responseFormat = "text",
  } = options;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-5),
    { role: "user", content: userMessage },
  ];

  const payload = {
    model: DEEPSEEK_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseFormat === "json") {
    payload.response_format = { type: "json_object" };
  }

  try {
    const res = await axios.post(DEEPSEEK_API_URL, payload, {
      headers: {
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 12000,
    });

    return res.data.choices[0].message.content;
  } catch (error) {
    logger.warn("⚠️ DeepSeek API error:", error.response?.data || error.message);
    throw new Error("DeepSeek call failed");
  }
}

module.exports = { callDeepSeek };
