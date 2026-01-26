require("dotenv").config();
const { app } = require("./app");

const port = process.env.PORT || 3000;
app.use(require("./modules/one_time_checkout/routes"));

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
