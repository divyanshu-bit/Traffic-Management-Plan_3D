const User = require('./User');
const Project = require('./Project');
const Zone = require('./Zone');
const Asset = require('./Asset');
const Export = require('./Export');

// Relationships
User.hasMany(Project, { foreignKey: 'userId', as: 'projects' });
Project.belongsTo(User, { foreignKey: 'userId' });

Project.hasMany(Zone, { foreignKey: 'projectId', as: 'zones' });
Zone.belongsTo(Project, { foreignKey: 'projectId' });

Project.hasMany(Export, { foreignKey: 'projectId', as: 'exports' });
Export.belongsTo(Project, { foreignKey: 'projectId' });

Zone.hasMany(Asset, { foreignKey: 'zoneId', as: 'assets' });
Asset.belongsTo(Zone, { foreignKey: 'zoneId' });

module.exports = {
  User,
  Project,
  Zone,
  Asset,
  Export
};
