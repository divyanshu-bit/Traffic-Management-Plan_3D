/**
 * Marg Rakshak - Global Constants
 */

module.exports = {
  SCHEMA_VERSION: 2,
  
  SNAP_THRESHOLDS: {
    ROAD_SNAP: 15,    // meters
    BOUNDARY_SNAP: 12, // meters
    DRAW_SNAP: 30     // meters
  },

  IRC_PARAMS: {
    '30': {
      taperLen: 15,
      advWarn: 50,
      coneSpacing: 12,
      riskLevel: 'LOW',
      standard: 'IRC SP 55:2014'
    },
    '50': {
      taperLen: 40,
      advWarn: 100,
      coneSpacing: 18,
      riskLevel: 'MEDIUM',
      standard: 'IRC SP 55:2014'
    },
    '80': {
      taperLen: 107,
      advWarn: 200,
      coneSpacing: 24,
      riskLevel: 'HIGH',
      standard: 'IRC SP 55:2014'
    }
  }
};
