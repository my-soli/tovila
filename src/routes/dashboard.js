const express = require("express");
const {
  listConversationsWithPreview,
  getConversationWithMessages,
  setConversationStatus,
} = require("../services/conversation");
const {
  listLeads,
  updateLeadStatus,
  markLeadPaid,
  getLeadOwnerSellerId,
} = require("../services/leads");
const { listSellers, getSellerById, updateSeller, createSeller } = require("../services/sellers");
const { isWithin24hWindow } = require("../services/messagingWindow");
const { notifyCustomerOfStatusChange } = require("../services/orderNotifications");
const { getSellerStats } = require("../services/stats");

const router = express.Router();

// Resolves which seller the dashboard is currently viewing, differently per
// session type (set by dashboardAuth in src/middleware/auth.js):
//  - "admin" (the shared operator login) — any seller via ?sellerId=,
//    defaulting to the first alphabetically; the full list is exposed so
//    the header can render the seller switcher.
//  - "seller" (a self-serve account) — always pinned to their own record,
//    ?sellerId= is ignored entirely so one seller can never view another's
//    data; no switcher (res.locals.sellers stays empty).
// /onboarding is admin-only (see the route below) — self-serve signup is
// how a seller session's very first record gets created.
router.use(async (req, res, next) => {
  const isAdminSession = req.session.type === "admin";
  res.locals.isAdminSession = isAdminSession;

  let sellers = [];
  let currentSeller = null;

  if (isAdminSession) {
    sellers = await listSellers();
    const requestedId = req.query.sellerId;
    currentSeller = sellers.find((s) => s.id === requestedId) || sellers[0] || null;
  } else {
    currentSeller = await getSellerById(req.session.sellerId);
  }

  res.locals.sellers = sellers;
  res.locals.currentSeller = currentSeller;
  res.locals.currentPath = req.path;
  req.currentSeller = currentSeller;

  if (!currentSeller && req.path !== "/onboarding") {
    return res
      .status(500)
      .send('No sellers configured yet. Visit /onboarding to add one, or run "npm run seed" for demo data.');
  }

  next();
});

// The default landing page: what needs the seller's attention right now,
// rather than a raw activity feed. Pulls from the same data the
// Conversations/Orders/Stats pages already show — no new service functions.
router.get("/overview", async (req, res) => {
  const [conversations, leads, stats] = await Promise.all([
    listConversationsWithPreview(req.currentSeller.id),
    listLeads(req.currentSeller.id),
    getSellerStats(req.currentSeller.id),
  ]);

  const needsAttention = conversations.filter((c) => c.status === "needs_attention");
  const pendingOrders = leads.filter((l) => l.status === "pending");

  res.render("overview", { needsAttention, pendingOrders, stats });
});

router.get("/conversations", async (req, res) => {
  const conversations = await listConversationsWithPreview(req.currentSeller.id);
  res.render("conversations", { conversations });
});

router.get("/conversations/:id", async (req, res) => {
  const conversation = await getConversationWithMessages(req.params.id);
  if (!conversation) {
    return res.status(404).render("not-found", { message: "Conversation not found." });
  }

  // A seller session may only ever view its own conversations — a raw ID
  // in the URL must not leak another seller's customer thread. An admin
  // session can view any conversation, and the nav/switcher reflects
  // whichever seller it actually belongs to (regardless of ?sellerId=).
  if (!res.locals.isAdminSession && conversation.seller.id !== req.currentSeller.id) {
    return res.status(404).render("not-found", { message: "Conversation not found." });
  }
  res.locals.currentSeller = conversation.seller;

  const withinWindow = await isWithin24hWindow(conversation.id);

  res.render("conversation-detail", { conversation, withinWindow });
});

// Resolves a flagged conversation back to normal handling.
router.post("/conversations/:id/resolve", async (req, res) => {
  const conversation = await getConversationWithMessages(req.params.id);
  if (!conversation) {
    return res.status(404).render("not-found", { message: "Conversation not found." });
  }
  if (!res.locals.isAdminSession && conversation.seller.id !== req.currentSeller.id) {
    return res.status(404).render("not-found", { message: "Conversation not found." });
  }

  await setConversationStatus(req.params.id, "open");
  res.redirect(`/conversations/${req.params.id}`);
});

router.get("/leads", async (req, res) => {
  const leads = await listLeads(req.currentSeller.id);
  res.render("leads", { leads });
});

router.post("/leads/:id/status", async (req, res) => {
  const ownerSellerId = await getLeadOwnerSellerId(req.params.id);
  if (!ownerSellerId || (!res.locals.isAdminSession && ownerSellerId !== req.currentSeller.id)) {
    return res.status(404).render("not-found", { message: "Order not found." });
  }

  const lead = await updateLeadStatus(req.params.id, req.body.status);
  await notifyCustomerOfStatusChange(lead);
  res.redirect(`/leads?sellerId=${req.currentSeller.id}`);
});

router.post("/leads/:id/paid", async (req, res) => {
  const ownerSellerId = await getLeadOwnerSellerId(req.params.id);
  if (!ownerSellerId || (!res.locals.isAdminSession && ownerSellerId !== req.currentSeller.id)) {
    return res.status(404).render("not-found", { message: "Order not found." });
  }

  await markLeadPaid(req.params.id, req.body.paid === "true");
  res.redirect(`/leads?sellerId=${req.currentSeller.id}`);
});

router.get("/products", (req, res) => {
  res.render("products", {
    seller: req.currentSeller,
    saved: req.query.saved === "1",
    error: req.query.error || null,
    welcome: req.query.welcome === "1",
  });
});

// Simple full-replace save: the form posts back the whole catalog/FAQ list
// as parallel arrays, which we zip back into the seller's JSON columns.
router.post("/products", async (req, res) => {
  const body = req.body;
  const sellerId = req.currentSeller.id;
  const whatsappNumber = (body.whatsappNumber || "").trim();

  try {
    await updateSeller(sellerId, {
      name: (body.sellerName || req.currentSeller.name).trim(),
      whatsappNumber: whatsappNumber || null,
      sellerNotificationEmail: (body.sellerNotificationEmail || "").trim() || null,
      mpesaTillNumber: (body.mpesaTillNumber || "").trim() || null,
      deliveryInfo: parseDeliveryInfoFromBody(body),
      products: parseProductsFromBody(body),
      faqs: parseFaqsFromBody(body),
    });
  } catch (err) {
    if (err.code === "P2002") {
      return res.redirect(`/products?sellerId=${sellerId}&error=whatsapp_taken`);
    }
    throw err;
  }

  res.redirect(`/products?sellerId=${sellerId}&saved=1`);
});

router.get("/stats", async (req, res) => {
  const stats = await getSellerStats(req.currentSeller.id);
  res.render("stats", { stats });
});

// Manually adding a seller stays an admin-only tool — self-serve signup
// (/signup, see src/routes/marketing.js) is how a seller session's own
// record gets created.
router.get("/onboarding", (req, res) => {
  if (!res.locals.isAdminSession) return res.redirect("/overview");
  res.render("onboarding", {});
});

router.post("/onboarding", async (req, res) => {
  if (!res.locals.isAdminSession) return res.redirect("/overview");
  const body = req.body;

  const seller = await createSeller({
    name: (body.sellerName || "").trim(),
    whatsappNumber: (body.whatsappNumber || "").trim(),
    sellerNotificationEmail: (body.sellerNotificationEmail || "").trim() || null,
    mpesaTillNumber: (body.mpesaTillNumber || "").trim() || null,
    deliveryInfo: parseDeliveryInfoFromBody(body),
    products: parseProductsFromBody(body),
    faqs: parseFaqsFromBody(body),
  });

  res.redirect(`/overview?sellerId=${seller.id}`);
});

function parseDeliveryInfoFromBody(body) {
  return {
    nairobi: {
      feeKES: Number(body.nairobiFee) || 0,
      eta: (body.nairobiEta || "").trim(),
    },
    upcountry: {
      feeKES: Number(body.upcountryFee) || 0,
      eta: (body.upcountryEta || "").trim(),
    },
  };
}

function parseProductsFromBody(body) {
  const productNames = [].concat(body.productName || []);
  const productPrices = [].concat(body.productPrice || []);
  const productSizes = [].concat(body.productSizes || []);
  const productStock = [].concat(body.productStock || []);

  return productNames
    .map((name, i) => ({
      name: (name || "").trim(),
      priceKES: Number(productPrices[i]) || 0,
      sizes: (productSizes[i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      stock: Number(productStock[i]) || 0,
    }))
    .filter((p) => p.name);
}

function parseFaqsFromBody(body) {
  const faqQuestions = [].concat(body.faqQuestion || []);
  const faqAnswers = [].concat(body.faqAnswer || []);

  return faqQuestions
    .map((question, i) => ({
      question: (question || "").trim(),
      answer: (faqAnswers[i] || "").trim(),
    }))
    .filter((f) => f.question && f.answer);
}

module.exports = router;
