const { auth } = require('express-oauth2-jwt-bearer');
const dotenv = require('dotenv');

dotenv.config();

let checkJwt;

if (process.env.AUTH0_AUDIENCE && process.env.AUTH0_DOMAIN) {
  checkJwt = auth({
    audience: process.env.AUTH0_AUDIENCE,
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
    tokenSigningAlg: 'RS256'
  });
} else {
  console.warn('[AUTH] Missing AUTH0_AUDIENCE or AUTH0_DOMAIN. Authentication is disabled for development.');
  checkJwt = (req, res, next) => {
    // Mock user for development
    req.auth = { payload: { sub: 'auth0|dev-user-id', email: 'dev@marg.rakshak' } };
    next();
  };
}

module.exports = {
  checkJwt
};
