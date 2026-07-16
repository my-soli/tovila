const express = require("express");
const {
  listConversationsWithPreview,
  getConversationWithMessages,
} = require("../services/conversation");
const { listLeads } = require("../services/leads");
const { listSellers, updateSeller } = require("../services/sellers");

const router = express.Router();

// Resolves which seller the dashboard is currently viewing from ?sellerId=,
// defaulting to the first seller alphabetically. Every view gets `sellers`
// and `currentSeller` in scope automatically via res.locals, so the header's
// nav links and seller switcher can render without each route wiring it up.
router.use(async (req, res, next) => {
  const sellers = await listSellers();

  if (sellers.length === 0) {
    return res
      .status(500)
      .send('No sellers configured yet. Run "npm run seed" to create demo sellers.');
  }

  const requestedId = req.query.sellerId;
  const currentSeller =
    sellers.find((s) => s.id === requestedId) || sellers[0];

  res.locals.sellers = sellers;
  res.locals.currentSeller = currentSeller;
  req.currentSeller = currentSeller;
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

  res.render("conversation-detail", { conversation });
});

router.get("/leads", async (req, res) => {
  const leads = await listLeads(req.currentSeller.id);
  res.render("leads", { leads });
});

router.get("/products", (req, res) => {
  res.render("products", { seller: req.currentSeller, saved: req.query.saved === "1" });
});

// Simple full-replace save: the form posts back the whole catalog/FAQ list
// as parallel arrays, which we zip back into the seller's JSON columns.
router.post("/products", async (req, res) => {
  const body = req.body;

  const productNames = [].concat(body.productName || []);
  const productPrices = [].concat(body.productPrice || []);
  const productSizes = [].concat(body.productSizes || []);
  const productStock = [].concat(body.productStock || []);

  const products = productNames
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

  const faqQuestions = [].concat(body.faqQuestion || []);
  const faqAnswers = [].concat(body.faqAnswer || []);

  const faqs = faqQuestions
    .map((question, i) => ({
      question: (question || "").trim(),
      answer: (faqAnswers[i] || "").trim(),
    }))
    .filter((f) => f.question && f.answer);

  const deliveryInfo = {
    nairobi: {
      feeKES: Number(body.nairobiFee) || 0,
      eta: (body.nairobiEta || "").trim(),
    },
    upcountry: {
      feeKES: Number(body.upcountryFee) || 0,
      eta: (body.upcountryEta || "").trim(),
    },
  };

  const sellerId = req.currentSeller.id;
  await updateSeller(sellerId, {
    name: (body.sellerName || req.currentSeller.name).trim(),
    deliveryInfo,
    products,
    faqs,
  });

  res.redirect(`/products?sellerId=${sellerId}&saved=1`);
});

module.exports = router;
