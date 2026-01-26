const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const adminRoutes = require("./routes/admin");
const merchantRoutes = require("./routes/merchant");
const webhookRoutes = require("./modules/webhooks/routes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/admin", adminRoutes);
app.use("/api", merchantRoutes);
app.use("/webhooks", webhookRoutes);

// error fallback
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Server error" });
});

module.exports = { app };
