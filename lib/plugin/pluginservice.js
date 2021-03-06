/**
 * pluginservice.js
 *   Движок для модулей - дочерних процессов (плагины, dbagent, ...)
 *   У каждого вида - свой mate
 */

// const util = require('util');
const appconfig = require('../appconfig');

const Pluginengine = require('./pluginengine');
const Pluginmate = require('./pluginmate');
const Dbagentmate = require('../dbs/dbagentmate');

const pluginutil = require('./pluginutil');
const dbagentutil = require('../dbs/dbagentutil');

// Просто EE
const Pluginagent = require('events');

module.exports = async function(holder) {
  const agent = new Pluginagent();
  const engine = new Pluginengine(holder, agent);
  const pluginmate = new Pluginmate(engine);

  // Dbagent - один модуль
  await addDbagent();

  // Системные плагины
  const systemplugins = appconfig.getSystemplugins();
 //  systemplugins.forEach(item => {
    for (const item of systemplugins) {
    if (item.name && item.type == 'plugin') {
      const info = await holder.dm.getPluginInfo(item.name);
      const unitobj = pluginutil.createSystempluginUnit(item, info);
      engine.addUnit(item.name, unitobj);
    }
  }
  

  // Остальные плагины 
  const unitDocs = await pluginutil.getUnitDocs(holder);
  for (const doc of unitDocs) {
    const uobj = await engine.createUnit(doc);
    engine.addUnit(doc._id, uobj);
  }

  pluginmate.start();
  engine.start();
  console.log('INFO: Plugin engine has started, units: ' + unitDocs.length);

  async function addDbagent() {
    const dbagentDoc = await dbagentutil.getActiveUnitDoc(holder);

    let msg = '';
    if (dbagentDoc === null) {
      msg = appconfig.getMessage('NoDbUsed');
    } else {
      const dbagentmate = new Dbagentmate(engine);
      const unitId = dbagentDoc._id;
      const info = await holder.dm.getDbagentInfo(unitId);
      msg = getDbagentMessage(unitId, info);
      const dbagentobj = await dbagentutil.createUnit(dbagentDoc, info);
      engine.addUnit(unitId, dbagentobj);
      dbagentmate.start(); // Агент может поменяться 
    }
    engine.logUnit('dbagent', msg);
  }

  function getDbagentMessage(unitId, info) {
    let res = '';
    if (info && info.version) res += ' v' + info.version;
    console.log('INFO: ' + unitId + res);
    return appconfig.getMessage('Dbagent') + ' ' + unitId + res;
  }
};
