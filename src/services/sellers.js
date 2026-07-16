const prisma = require("../db/client");

async function listSellers() {
  return prisma.seller.findMany({ orderBy: { name: "asc" } });
}

async function getSellerById(id) {
  return prisma.seller.findUnique({ where: { id } });
}

/** Looks up the seller a WhatsApp message was sent TO, by their business number. */
async function getSellerByWhatsappNumber(whatsappNumber) {
  return prisma.seller.findUnique({ where: { whatsappNumber } });
}

async function updateSeller(id, data) {
  return prisma.seller.update({ where: { id }, data });
}

module.exports = {
  listSellers,
  getSellerById,
  getSellerByWhatsappNumber,
  updateSeller,
};
