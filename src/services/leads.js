const prisma = require("../db/client");

async function saveLead({
  conversationId,
  item,
  quantity,
  variant,
  deliveryLocation,
  customerName,
}) {
  return prisma.lead.create({
    data: {
      conversationId,
      item,
      quantity,
      variant: variant || null,
      deliveryLocation,
      customerName,
    },
  });
}

/** Returns every lead for a seller, with the customer's phone number, most recent first. */
async function listLeads(sellerId) {
  return prisma.lead.findMany({
    where: { conversation: { sellerId } },
    orderBy: { createdAt: "desc" },
    include: {
      conversation: { select: { customerPhone: true } },
    },
  });
}

/** Updates a lead's fulfillment status, returning it with the conversation (for customer messaging). */
async function updateLeadStatus(leadId, status) {
  return prisma.lead.update({
    where: { id: leadId },
    data: { status },
    include: { conversation: true },
  });
}

async function markLeadPaid(leadId, paid) {
  return prisma.lead.update({
    where: { id: leadId },
    data: { paid },
  });
}

module.exports = { saveLead, listLeads, updateLeadStatus, markLeadPaid };
