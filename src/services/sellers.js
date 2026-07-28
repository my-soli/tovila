const prisma = require("../db/client");
const { hashPassword, generateVerificationToken } = require("../middleware/auth");

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VERIFICATION_TOKEN_MS = 24 * 60 * 60 * 1000; // 24 hours to click the email link

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

/** Looks up the seller an Instagram DM was sent TO, by their linked Instagram account ID. */
async function getSellerByInstagramAccountId(instagramAccountId) {
  return prisma.seller.findUnique({ where: { instagramAccountId } });
}

async function updateSeller(id, data) {
  return prisma.seller.update({ where: { id }, data });
}

async function createSeller(data) {
  return prisma.seller.create({ data });
}

async function getSellerByEmail(email) {
  return prisma.seller.findUnique({ where: { email } });
}

/**
 * Self-serve signup — no WhatsApp number yet (that still requires manual
 * Twilio/Meta setup, see the dashboard's "not connected" banner), empty
 * catalog/FAQs to fill in, a 7-day trial starting now, and an unverified
 * email pending the verification link.
 */
async function createSellerAccount({ name, email, password }) {
  const now = new Date();

  return prisma.seller.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(password),
      whatsappNumber: null,
      products: [],
      faqs: [],
      deliveryInfo: {
        nairobi: { feeKES: 0, eta: "" },
        upcountry: { feeKES: 0, eta: "" },
      },
      emailVerified: false,
      emailVerificationToken: generateVerificationToken(),
      emailVerificationExpires: new Date(now.getTime() + VERIFICATION_TOKEN_MS),
      trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + TRIAL_MS),
    },
  });
}

/** Verifies a signup's email-verification token, marking the account verified. Returns the seller, or null if the token is missing/expired. */
async function verifySellerEmail(token) {
  const seller = await prisma.seller.findUnique({ where: { emailVerificationToken: token } });
  if (!seller) return null;
  if (!seller.emailVerificationExpires || seller.emailVerificationExpires < new Date()) return null;

  return prisma.seller.update({
    where: { id: seller.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    },
  });
}

module.exports = {
  listSellers,
  getSellerById,
  getSellerByWhatsappNumber,
  getSellerByInstagramAccountId,
  updateSeller,
  createSeller,
  getSellerByEmail,
  createSellerAccount,
  verifySellerEmail,
};
