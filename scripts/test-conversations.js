// Fires a batch of realistic mixed English/Swahili/Sheng messages through
// the real webhook pipeline (same code path as scripts/simulate-message.js)
// so you can manually review how the agent handles this market's natural
// mix of languages — including a couple of messages that should trigger
// escalation (see src/agent/seller.js's flag_for_human criteria).
//
// Usage: node scripts/test-conversations.js
//
// Requires a real ANTHROPIC_API_KEY in .env to see actual model replies —
// with a placeholder key every message will time out waiting for a reply
// (the same way it does for scripts/simulate-message.js), which still
// proves the pipeline runs but doesn't tell you anything about reply
// quality/language handling.
require("dotenv").config();
const prisma = require("../src/db/client");
const { getSellerByWhatsappNumber } = require("../src/services/sellers");
const { sendSimulatedMessage } = require("./lib/webhookSimulator");

const SELLER_NUMBER = "254700000001"; // Amara Styles

const TEST_MESSAGES = [
  {
    from: "254701555001",
    text: "Niaje, hiyo dress iko available?",
    note: "Sheng greeting + FAQ-style stock question",
  },
  {
    from: "254701555001",
    text: "Naomba deliver Nairobi ngapi?",
    note: "Same customer, mixed Swahili/English delivery-fee question",
  },
  {
    from: "254701555002",
    text: "Bei ya hiyo jacket ni ngapi na iko na size gani?",
    note: "Swahili price + size question",
  },
  {
    from: "254701555002",
    text: "Sawa, nitachukua ile denim jacket size L, deliver Kilimani, jina yangu ni Faith",
    note: "Same customer completing an order in Swahili/Sheng — should call create_lead",
  },
  {
    from: "254701555003",
    text: "Mko na M-Pesa till?",
    note: "Sheng payment question",
  },
  {
    from: "254701555004",
    text: "Order yangu iko wapi? Nimechoka kusubiri, hii ni ya tatu nauliza!",
    note: "Frustration expressed in Swahili — should trigger flag_for_human",
  },
  {
    from: "254701555005",
    text: "Naomba unipe discount, niko na wateja wengi wa kuchukua bulk",
    note: "Custom/bulk pricing request — should trigger flag_for_human",
  },
];

async function main() {
  const seller = await getSellerByWhatsappNumber(SELLER_NUMBER);
  if (!seller) {
    console.error(`No seller found with whatsapp_number "${SELLER_NUMBER}". Run "npm run seed" first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Running ${TEST_MESSAGES.length} test messages against "${seller.name}"...\n`);

  for (const { from, text, note } of TEST_MESSAGES) {
    console.log(`--- ${note} ---`);
    console.log(`${from}: "${text}"`);

    try {
      const reply = await sendSimulatedMessage({ to: SELLER_NUMBER, from, text, seller });
      if (reply) {
        console.log(`Tovila: "${reply.content}"`);
      } else {
        console.warn("(timed out waiting for a reply — check server logs, or set a real ANTHROPIC_API_KEY)");
      }
    } catch (err) {
      console.error(`Failed: ${err.message}`);
    }

    console.log("");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
