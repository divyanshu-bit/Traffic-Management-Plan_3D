const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Asset = sequelize.define('Asset', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  zoneId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'Zones', key: 'id' },
    onDelete: 'CASCADE',
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false, // cone, barrier, truck, etc.
  },
  source: {
    type: DataTypes.ENUM('auto', 'manual'),
    defaultValue: 'manual',
  },
  // Spatial location of the asset
  location: {
    type: DataTypes.GEOMETRY('POINT', 4326),
    allowNull: false,
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  }
}, {
  timestamps: true,
});

module.exports = Asset;
