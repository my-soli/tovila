const express = require("express");
const {
  listConversationsWithPreview,
  getConversationWithMessages,
  setConversationStatus,
} = require("../services/conversation");
const { listLeads, updateLeadStatus, markLeadPaid } = require("../services/leads");
const { listSellers, updateSeller, createSeller } = require("../services/sellers");
const { isWithin24hWindow } = require("../services/messagingWindow");
const { notifyCustomerOfStatusChange } = require("../services/orderNotifications");

const router = express.Router();

// Resolves which seller the dashboard is currently viewing from ?sellerId=,
// defaulting to the first seller alphabetically. Every view gets `sellers`
// and `currentSeller` in scope automatically via res.locals, so the header's
// nav links and seller switcher can render without each route wiring it up.
// /onboarding is exempt from requiring an existing seller, since it's how
// you create the very first one.
router.use(async (req, res, next) => {
  const sellers = await listSellers();
  const requestedId = req.query.sellerId;
  const currentSeller = sellers.find((s) => s.id === requestedId) || sellers[0] || null;

  res.locals.sellers = sellers;
  res.locals.currentSeller = currentSeller;
  req.currentSeller = currentSeller;

  if (!currentSeller && req.path !== "/onboarding") {
    return res
      .status(500)
      .send('No sellers configured yet. Visit /onboarding to add one, or run "npm run seed" for demo data.');
  }

  next();
});

router.get("/", async (req, res) => {
  const conversations = await listConversationsWithPreview(req.currentSeller.id);
  res.render("conversations", { conversations });
});

router.get("/conversations/:id", async (req, res) => {
  const conversation = await getConversationWithMessages(req.params.id);
  if (!conversation) {
    return res.status(404).render("not-found", { message: "Conversation not found." });
  }

  // A conversation belongs to whichever seller it was created under —
  // reflect that in the nav/switcher regardless of the ?sellerId= in the URL.
  res.locals.currentSeller = conversation.seller;

  const withinWindow = await isWithin24hWindow(conversation.id);

  res.render("conversation-detail", { conversation, withinWindow });
});

// Resolves a flagged conversation back to normal handling.
router.post("/conversations/:id/resolve", async (req, res) => {
  await setConversationStatus(req.params.id, "open");
  res.redirect(`/conversations/${req.params.id}`);
});

router.get("/leads", async (req, res) => {
  const leads = await listLeads(req.currentSeller.id);
  res.render("leads", { leads });
});

router.post("/leads/:id/status", async (req, res) => {
  const lead = await updateLeadStatus(req.params.id, req.body.status);
  await notifyCustomerOfStatusChange(lead);
  res.redirect(`/leads?sellerId=${req.currentSeller.id}`);
});

router.post("/leads/:id/paid", async (req, res) => {
  await markLeadPaid(req.params.id, req.body.paid === "true");
  res.redirect(`/leads?sellerId=${req.currentSeller.id}`);
});

router.get("/products", (req, res) => {
  res.render("products", { seller: req.currentSeller, saved: req.query.saved === "1" });
});

// Simple full-replace save: the form posts back the whole catalog/FAQ list
// as parallel arrays, which we zip back into the seller's JSON columns.
router.post("/products", async (req, res) => {
  const body = req.body;
  const sellerId = req.currentSeller.id;

  await updateSeller(sellerId, {
    name: (body.sellerName || req.currentSeller.name).trim(),
    sellerNotificationEmail: (body.sellerNotificationEmail || "").trim() || null,
    mpesaTillNumber: (body.mpesaTillNumber || "").trim() || null,
    deliveryInfo: parseDeliveryInfoFromBody(body),
    products: parseProductsFromBody(body),
    faqs: parseFaqsFromBody(body),
  });

  res.redirect(`/products?sellerId=${sellerId}&saved=1`);
});

router.get("/onboarding", (req, res) => {
  res.render("onboarding", {});
});

router.post("/onboarding", async (req, res) => {
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

  res.redirect(`/?sellerId=${seller.id}`);
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
