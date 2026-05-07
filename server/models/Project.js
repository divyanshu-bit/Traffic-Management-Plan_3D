const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Project = sequelize.define('Project', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  reportId: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'Users', key: 'id' },
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  permitNumber: DataTypes.STRING,
  contractorName: DataTypes.STRING,
  clientName: DataTypes.STRING,
  startDate: DataTypes.DATEONLY,
  endDate: DataTypes.DATEONLY,
  workingHours: DataTypes.STRING,
  nightWork: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  superintendent: DataTypes.STRING,
  safetyOfficer: DataTypes.STRING,
  emergencyContact: DataTypes.STRING,
  isWazeSync: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  schemaVersion: {
    type: DataTypes.INTEGER,
    defaultValue: 2,
  },
}, {
  timestamps: true,
});

module.exports = Project;
