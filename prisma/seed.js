// Populates the database with demo sellers and a handful of realistic fake
// conversations/leads, so the dashboard (and the message simulator) have
// something real to show before live WhatsApp is wired up.
//
// Sellers are upserted by whatsapp_number — re-running this script will NOT
// clobber catalog/FAQ edits you've made via the dashboard. Conversations,
// messages, and leads ARE wiped and recreated every run, since they're just
// demo content.
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const ago = (hours) => new Date(now - hours * HOUR);

const DEMO_SELLERS = [
  {
    name: "Amara Styles",
    whatsappNumber: "254700000001",
    products: [
      { name: "Floral Dress", priceKES: 2500, sizes: ["S", "M", "L"], stock: 5 },
      { name: "Denim Jacket", priceKES: 3200, sizes: ["M", "L"], stock: 3 },
    ],
    deliveryInfo: {
      nairobi: { feeKES: 200, eta: "1-2 days" },
      upcountry: { feeKES: 500, eta: "3-5 days" },
    },
    faqs: [
      {
        question: "Do you accept M-Pesa?",
        answer: "Yes, a Till number is provided at checkout.",
      },
    ],
  },
  {
    name: "Kiko Jewellery",
    whatsappNumber: "254700000002",
    products: [
      { name: "Beaded Necklace", priceKES: 1200, sizes: [], stock: 8 },
      { name: "Gold-Plated Earrings", priceKES: 800, sizes: [], stock: 15 },
    ],
    deliveryInfo: {
      nairobi: { feeKES: 150, eta: "same day" },
      upcountry: { feeKES: 400, eta: "2-4 days" },
    },
    faqs: [
      {
        question: "Do you offer gift wrapping?",
        answer: "Yes, free gift wrapping on all orders over KES 1,000.",
      },
    ],
  },
];

async function upsertSellers() {
  const sellers = {};
  for (const data of DEMO_SELLERS) {
    const seller = await prisma.seller.upsert({
      where: { whatsappNumber: data.whatsappNumber },
      update: {},
      create: data,
    });
    sellers[data.whatsappNumber] = seller;
  }
  return sellers;
}

async function seedAmaraConversations(seller) {
  // 1. Jane — asked a question, then completed an order.
  const jane = await prisma.conversation.create({
    data: { sellerId: seller.id, customerPhone: "254712345678", createdAt: ago(50) },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: jane.id,
        sender: "customer",
        content: "Hi, do you have the floral dress in size M?",
        timestamp: ago(50),
      },
      {
        conversationId: jane.id,
        sender: "agent",
        content:
          "Hi! Yes, the Floral Dress is available in size M — KES 2,500, and we currently have stock. Would you like to order it?",
        timestamp: ago(49.9),
      },
      {
        conversationId: jane.id,
        sender: "customer",
        content: "I'll take it, deliver to Kilimani, my name is Jane",
        timestamp: ago(49.5),
      },
      {
        conversationId: jane.id,
        sender: "agent",
        content:
          "Great, thank you Jane! I've recorded your order: 1x Floral Dress (size M), delivery to Kilimani (KES 200, 1-2 days). Our team will follow up shortly with M-Pesa payment details.",
        timestamp: ago(49.4),
      },
    ],
  });
  await prisma.lead.create({
    data: {
      conversationId: jane.id,
      item: "Floral Dress",
      quantity: 1,
      variant: "M",
      deliveryLocation: "Kilimani, Nairobi",
      customerName: "Jane",
      status: "new",
      createdAt: ago(49.4),
    },
  });

  // 2. Mercy — still browsing, asked about price/stock, no order yet.
  const mercy = await prisma.conversation.create({
    data: { sellerId: seller.id, customerPhone: "254798765432", createdAt: ago(26) },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: mercy.id,
        sender: "customer",
        content: "How much is the denim jacket and do you have size L?",
        timestamp: ago(26),
      },
      {
        conversationId: mercy.id,
        sender: "agent",
        content:
          "The Denim Jacket is KES 3,200 and yes, we have size L in stock (also available in M). Let me know if you'd like to order!",
        timestamp: ago(25.9),
      },
      {
        conversationId: mercy.id,
        sender: "customer",
        content: "ok let me think about it, thanks",
        timestamp: ago(25.8),
      },
    ],
  });

  // 3. Amina — asked about payment, then ordered (upcountry delivery).
  const amina = await prisma.conversation.create({
    data: { sellerId: seller.id, customerPhone: "254722111222", createdAt: ago(6) },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: amina.id,
        sender: "customer",
        content: "Do you accept M-Pesa?",
        timestamp: ago(6),
      },
      {
        conversationId: amina.id,
        sender: "agent",
        content:
          "Yes, we accept M-Pesa — a Till number is provided at checkout once your order is confirmed.",
        timestamp: ago(5.9),
      },
      {
        conversationId: amina.id,
        sender: "customer",
        content:
          "Perfect. I want the denim jacket size L, deliver to Nakuru. I'm Amina Hassan",
        timestamp: ago(5.5),
      },
      {
        conversationId: amina.id,
        sender: "agent",
        content:
          "Thank you Amina! Order recorded: 1x Denim Jacket (size L), delivery to Nakuru (KES 500, 3-5 days). We'll be in touch shortly with M-Pesa payment details.",
        timestamp: ago(5.4),
      },
    ],
  });
  await prisma.lead.create({
    data: {
      conversationId: amina.id,
      item: "Denim Jacket",
      quantity: 1,
      variant: "L",
      deliveryLocation: "Nakuru",
      customerName: "Amina Hassan",
      status: "new",
      createdAt: ago(5.4),
    },
  });

  // 4. Grace — most recent activity, asked about delivery, still undecided.
  const grace = await prisma.conversation.create({
    data: { sellerId: seller.id, customerPhone: "254733444555", createdAt: ago(0.5) },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: grace.id,
        sender: "customer",
        content: "Hi, do you deliver to Mombasa? And how much would that cost?",
        timestamp: ago(0.5),
      },
      {
        conversationId: grace.id,
        sender: "agent",
        content:
          "Hi! Yes, we deliver upcountry including Mombasa — KES 500, taking about 3-5 days. Is there something from the catalog I can help you with?",
        timestamp: ago(0.45),
      },
    ],
  });
}

async function seedKikoConversations(seller) {
  // 1. Faith — asked about gift wrapping, still browsing.
  const faith = await prisma.conversation.create({
    data: { sellerId: seller.id, customerPhone: "254711222333", createdAt: ago(18) },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: faith.id,
        sender: "customer",
        content: "Hi, how much is the beaded necklace? Do you do gift wrapping?",
        timestamp: ago(18),
      },
      {
        conversationId: faith.id,
        sender: "agent",
        content:
          "Hi! The Beaded Necklace is KES 1,200, and yes — we offer free gift wrapping on orders over KES 1,000, so yours would qualify. Would you like to order?",
        timestamp: ago(17.9),
      },
      {
        conversationId: faith.id,
        sender: "customer",
        content: "nice, let me check with my sister first",
        timestamp: ago(17.8),
      },
    ],
  });

  // 2. Brenda — ordered earrings.
  const brenda = await prisma.conversation.create({
    data: { sellerId: seller.id, customerPhone: "254744555666", createdAt: ago(3) },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: brenda.id,
        sender: "customer",
        content: "I want to order the gold-plated earrings, deliver to Westlands, I'm Brenda",
        timestamp: ago(3),
      },
      {
        conversationId: brenda.id,
        sender: "agent",
        content:
          "Thank you Brenda! Order recorded: 1x Gold-Plated Earrings, delivery to Westlands (KES 150, same day). We'll follow up shortly with M-Pesa payment details.",
        timestamp: ago(2.95),
      },
    ],
  });
  await prisma.lead.create({
    data: {
      conversationId: brenda.id,
      item: "Gold-Plated Earrings",
      quantity: 1,
      variant: null,
      deliveryLocation: "Westlands",
      customerName: "Brenda",
      status: "new",
      createdAt: ago(2.95),
    },
  });
}

async function main() {
  console.log("Upserting demo sellers...");
  const sellers = await upsertSellers();

  console.log("Clearing existing leads/messages/conversations...");
  await prisma.lead.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();

  console.log("Seeding conversations for Amara Styles...");
  await seedAmaraConversations(sellers["254700000001"]);

  console.log("Seeding conversations for Kiko Jewellery...");
  await seedKikoConversations(sellers["254700000002"]);

  console.log(
    "Done: 2 sellers, 6 conversations (3 with completed leads)."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
