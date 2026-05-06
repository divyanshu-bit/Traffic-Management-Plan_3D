const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Zone = sequelize.define('Zone', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  projectId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'Projects', key: 'id' },
    onDelete: 'CASCADE',
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  color: {
    type: DataTypes.STRING,
    defaultValue: '#0ea5e9',
  },
  shapeType: {
    type: DataTypes.ENUM('polygon', 'polyline', 'rectangle'),
    defaultValue: 'polygon',
  },
  // GeoJSON-compatible field for spatial queries
  geometry: {
    type: DataTypes.GEOMETRY('GEOMETRY', 4326),
    allowNull: false,
  },
  approachEdgeIndices: {
    type: DataTypes.JSONB,
    defaultValue: [0],
  },
  speedLimit: {
    type: DataTypes.STRING,
    defaultValue: '50',
  },
  workZoneSpeed: {
    type: DataTypes.STRING,
    defaultValue: '30',
  },
  laneCount: DataTypes.STRING,
  laneWidth: DataTypes.STRING,
  surfaceType: DataTypes.STRING,
  gradient: DataTypes.STRING,
  closureType: DataTypes.STRING,
  roadLevel: DataTypes.STRING,
  hasGenerated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  timestamps: true,
});

module.exports = Zone;
