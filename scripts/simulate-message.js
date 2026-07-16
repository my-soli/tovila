// Simulates an inbound WhatsApp message by POSTing a payload shaped exactly
// like Meta's real webhook body to your own local /webhook endpoint — this
// exercises the real webhook → agent → DB code path, not a shortcut.
//
// Usage:
//   node scripts/simulate-message.js "<to-seller-number>" "<from-customer-number>" "<message text>"
//
// Example:
//   node scripts/simulate-message.js "254700000001" "254701338496" "Do you have the floral dress in size M?"
//
// <to> must match a seller's whatsapp_number in the sellers table (run
// "npm run seed" to create demo sellers). <from> is any made-up customer
// number — reuse the same one across calls to build up a conversation.
require("dotenv").config();
const prisma = require("../src/db/client");
const { getSellerByWhatsappNumber } = require("../src/services/sellers");
const { sendSimulatedMessage } = require("./lib/webhookSimulator");

async function main() {
  const [, , to, from, ...rest] = process.argv;
  const text = rest.join(" ");

  if (!to || !from || !text) {
    console.error(
      'Usage: node scripts/simulate-message.js "<to-seller-number>" "<from-customer-number>" "<message text>"'
    );
    process.exitCode = 1;
    return;
  }

  const seller = await getSellerByWhatsappNumber(to);
  if (!seller) {
    console.error(
      `No seller found with whatsapp_number "${to}". Run "npm run seed" or check the sellers table.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Simulating message to "${seller.name}" (${to}) from ${from}:`);
  console.log(`  "${text}"`);

  if (!process.env.WHATSAPP_APP_SECRET) {
    console.log(
      "(WHATSAPP_APP_SECRET not set — sending unsigned; make sure VERIFY_WEBHOOK_SIGNATURE=false in .env for local testing)"
    );
  }

  console.log("Sending to the webhook, waiting for the agent's reply...");

  const reply = await sendSimulatedMessage({ to, from, text, seller });

  if (reply) {
    console.log(`\n${seller.name} bot reply:\n  "${reply.content}"\n`);
  } else {
    console.warn(
      "Timed out waiting for a reply — check the server logs (the terminal running \"npm run dev\") for errors."
    );
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
