const { User } = require('../models');

/**
 * Middleware to sync Auth0 user with local database
 * Assumes checkJwt has already run and populated req.auth
 */
const syncUser = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.payload.sub) {
      return res.status(401).json({ error: 'Unauthorized: No user identifier found' });
    }

    const auth0Sub = req.auth.payload.sub;
    
    // Extract info from payload with better fallbacks
    const email = req.auth.payload['https://margrakshak.shield/email'] || 
                  req.auth.payload.email || 
                  `user_${auth0Sub.split('|')[1]}@margrakshak.internal`;
                  
    const name = req.auth.payload['https://margrakshak.shield/name'] || 
                 req.auth.payload.name || 
                 'Anonymous Operator';
    
    const [user, created] = await User.findOrCreate({
      where: { auth0Sub },
      defaults: { email, name }
    });

    req.user = user;
    next();
  } catch (error) {
    console.error('Error syncing user:', error);
    res.status(500).json({ error: 'Internal server error during user sync' });
  }
};

module.exports = { syncUser };
