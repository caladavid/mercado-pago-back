const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const adminRoutes = require("./routes/admin");
const merchantRoutes = require("./routes/merchant");
const webhookRoutes = require("./modules/webhooks/routes");
const { checkMPStatus } = require("./modules/Health/controller/health.controller");

const app = express();

app.use(helmet());

const corsOptions = {
  origin: "*", // Permite que cualquier URL (tus túneles) se conecte
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type", 
    "Authorization", 
    "bypass-tunnel-reminder", // <- Clave para engañar a la pantalla de Microsoft
    "x-localtunnel-skip-warning"
  ]
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", checkMPStatus);

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
