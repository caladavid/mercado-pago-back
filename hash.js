const bcrypt = require('bcryptjs');

const passwordClaro = "celcom123";

bcrypt.hash(passwordClaro, 10, (err, hash) => {
    console.log("Copia este hash en tu BD:");
    console.log(hash);
});