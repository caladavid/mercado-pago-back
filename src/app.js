const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const adminRoutes = require("./routes/admin");
const merchantRoutes = require("./routes/merchant");
const subscriptionRoutes = require("./modules/subscriptions/routes");
const planRoutes = require("./modules/plans/routes");
const webhookRoutes = require("./modules/webhooks/routes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/admin", adminRoutes);
app.use("/api", merchantRoutes);
/* app.use("/api/subscriptions", subscriptionRoutes);
app.use('/api/plans', planRoutes); */

app.post("/webhooks/test", (req, res) => {
    console.log("🚀 DEBUG: Webhook Directo Recibido!");
    console.log("Data:", req.body);
    res.status(200).send("OK DEBUG");
});

app.use("/webhooks", webhookRoutes);

/* app.use(require("./modules/one_time_checkout/routes"));  */

/* app.use((req, res, next) => {  
  console.error("🔍 404 HANDLER:", req.path);  
  res.status(404).json({ error: "Route not found" });  
});  */ 

// error fallback
app.use((err, req, res, next) => {
  /* console.error("Unhandled error:", err); */
  /* console.error("🔍 ERROR HANDLER:", { status: err.status, message: err.message }); */  
  const status = err.status || 500;
  const message = err.message || "Server error";

  console.error("🔍 SENDING RESPONSE:", { status, message }); 

  res.status(status).json({ error: message });
});

module.exports = { app };
