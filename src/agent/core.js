const Anthropic = require("@anthropic-ai/sdk");
const { buildSystemPrompt } = require("./seller");
const { saveLead } = require("../services/leads");

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const CREATE_LEAD_TOOL = {
  name: "create_lead",
  description:
    "Record a confirmed customer order as a lead for the seller to follow up on. Only call this once the customer has clearly committed to ordering and you have the item, quantity, delivery location, and the customer's name.",
  input_schema: {
    type: "object",
    properties: {
      item: {
        type: "string",
        description: "Product name, exactly as listed in the catalog",
      },
      quantity: {
        type: "integer",
        description: "Number of units ordered",
      },
      variant: {
        type: "string",
        description: "Size or variant, if the product has one",
      },
      delivery_location: {
        type: "string",
        description: "Where the order should be delivered",
      },
      customer_name: {
        type: "string",
        description: "The customer's name",
      },
    },
    required: ["item", "quantity", "delivery_location", "customer_name"],
  },
};

const FLAG_FOR_HUMAN_TOOL = {
  name: "flag_for_human",
  description:
    "Escalate this conversation to the shop owner instead of trying to handle it yourself. Use this for: complaints or dissatisfaction, requests for custom/negotiated pricing or discounts outside the listed catalog, messages expressing frustration or anger, or anything you are genuinely unsure how to answer using only the seller's product/FAQ data. Do not guess or make up an answer in these cases — flag it instead.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Brief internal note (not shown to the customer) on why this needs human attention",
      },
    },
    required: ["reason"],
  },
};

function extractText(content) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Runs one turn of the agent: takes conversation history + a new incoming
 * message, calls Claude (with the create_lead and flag_for_human tools
 * available), persists any resulting lead to the database, and returns the
 * natural-language reply to send back over WhatsApp — plus whether this
 * turn should escalate the conversation to the seller.
 */
async function generateReply({ seller, conversationId, history, incomingText }) {
  const messages = [
    ...history.map((m) => ({
      role: m.sender === "customer" ? "user" : "assistant",
      content: m.content,
    })),
    { role: "user", content: incomingText },
  ];

  const system = buildSystemPrompt(seller);
  const requestParams = {
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: [CREATE_LEAD_TOOL, FLAG_FOR_HUMAN_TOOL],
    messages,
  };

  let response = await client.messages.create(requestParams);

  const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
  if (toolUseBlocks.length === 0) {
    return { reply: extractText(response.content) || "Sorry, could you say that again?", flagged: false };
  }

  // Execute the tool call(s) against our database, then ask Claude to
  // produce the final natural-language confirmation using the results.
  messages.push({ role: "assistant", content: response.content });

  const toolResults = [];
  let flagged = false;
  let flagReason = null;

  for (const block of toolUseBlocks) {
    if (block.name === "create_lead") {
      const input = block.input;
      try {
        await saveLead({
          conversationId,
          item: input.item,
          quantity: input.quantity,
          variant: input.variant,
          deliveryLocation: input.delivery_location,
          customerName: input.customer_name,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Order recorded successfully.",
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Failed to record order: ${err.message}`,
          is_error: true,
        });
      }
    } else if (block.name === "flag_for_human") {
      flagged = true;
      flagReason = block.input.reason;
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: "Flagged for the shop owner.",
      });
    }
  }

  messages.push({ role: "user", content: toolResults });

  response = await client.messages.create({ ...requestParams, messages });

  return {
    reply: extractText(response.content) || "Got it, thank you!",
    flagged,
    flagReason,
  };
}

module.exports = { generateReply };
