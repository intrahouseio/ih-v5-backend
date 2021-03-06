/* eslint-disable object-shorthand */
/**
 * datagetter.js
 *
 * Функции подготовки данных
 * на прикладном уровне
 *
 * Имеет доступ к
 */
const util = require('util');

const appconfig = require('../appconfig');

const hut = require('../utils/hut');
const loadsys = require('../utils/loadsys');
const exportPack = require('../utils/exportPack');
const sqlutil = require('../utils/sqlutil');

const dataformer = require('../api/dataformer');
const tabledata = require('../api/tabledataformer');


const liststore = require('../dbs/liststore');

const specreq = require('../domain/specreq');
const specform = require('../domain/specform');
const specdata = require('../domain/specdata');
const specsubtree = require('../domain/specsubtree');
const virttables = require('../domain/virttables');
const domaindata = require('../domain/domaindata');
const exportmethods = require('../domain/exportmethods');
const logconnector = require('../log/logconnector');

function isVirttable(tableName) {
  return !!virttables[tableName];
}

async function getVirttable(tableName, dataFromTable, table, cNodeid, item, holder) {
  return isVirttable(tableName) ? virttables[tableName](dataFromTable, table, cNodeid, item, holder) : [];
}

function isSpecType(type) {
  return specreq.isSpecType(type);
}

function isSpecMeta(type, id) {
  if (type == 'form') return specform.isSpecForm(id);
}

function isSpec(type, id) {
  // if (type == 'form') return specform.isSpecForm(id);
  if (type == 'popup') return specreq.isSpecPopup(id);
  if (type == 'droplist') return specreq.isSpecDroplist(id);

  if (type == 'subtree') return specsubtree.isSpecSubtree(id);
}

async function getSpecMeta(query, dm) {
  if (query && query.type == 'form') return specform.getForm(query, dm);
}

async function getSpecData(query, holder) {
  if (!query) return;
  if (query.type == 'xform') return specdata.getSpecData(query, holder);

  if (query.type == 'popup') return specreq.getSpecPopup(query, holder);
  if (query.type == 'droplist') return specreq.getSpecDroplist(query, holder);
  if (query.type == 'subtree') return specsubtree.getSpecSubtree(query, holder);
}

async function getSpecTree(query, dm) {
  if (query.type == 'subtree') return specsubtree.getSpecSubtree(query, dm);
}

async function processSpecType(query, holder) {
  return specreq.processSpec(query, holder);
}

function getMetaCacheIds(query) {
  return specform.getMetaCacheIds(query);
}

function needFinishing(query) {
  return specreq.needFinishing(query);
}

function finishing(query, data, dm) {
  return specreq.finishing(query, data, dm);
}

function getRecordDependentForms(table) {
  return specform.recordDependentForms[table];
}

async function getRecordIdByLink(formId, nodeid, rowid, dm) {
  if (formId.startsWith('channellink')) {
    // nodeid = d0800.value - найти id записи в таблице devhard, если нет rowid
    if (rowid && rowid != '__clear') return rowid;

    const [did, prop] = nodeid.split('.');
    const hdoc = await dm.dbstore.findOne('devhard', { did, prop });
    // if (!hdoc) throw { err: 'SOFTERR', message: 'Not found channellink record in "devhard" for nodeid:' + nodeid };
    return hdoc ? hdoc._id : '';
  }

  if (formId == 'typeprophandler') {
    return nodeid.split('.').shift();
  }
  return nodeid;
}

function chooseTreeItemComponent(item, desc, dm) {
  if (desc.table == 'units') {
    // Найти в списке
    const listItem = liststore.getItemFromList('unitList', item.id);
    // Здесь нужно расширить логику!!
    // return listItem.id == listItem.plugin ? 'pluginview1Tab' : 'pluginview';

    const manifest = dm.getFromCache({ method: 'getmeta', type: 'manifest', id: listItem.plugin });

    const ext = manifest && manifest.data && manifest.data.extratab;
    return listItem.id == listItem.plugin
      ? 'pluginview1Tab'
      : ext // : listItem.plugin.startsWith('mqtt')
      ? 'pluginviewPubSub'
      : 'pluginview';
  }
}

function getTreeItemTitle(table, item, olditem) {
  return domaindata.getTreeItemTitle(table, item, olditem);
}

function getDeviceDidByDn(dn) {
  const listname = dn.startsWith('global') ? 'globalList' : 'deviceList';
  const arr = liststore.getListAsArray(listname);
  for (const item of arr) {
    if (item.dn == dn) return item.id;
  }
}

function getDeviceDnByDid(did) {
  const listname = did.startsWith('gl') ? 'globalList' : 'deviceList';
  const arr = liststore.getListAsArray(listname);
  for (const item of arr) {
    if (item.id == did) return item.dn;
  }
}

function isRealtimeTable(table) {
  return ['unitchannelsTable', 'devicecommonTable'].includes(table);
}

async function getRealtimeValues(table, id, nodeid, holder) {
  switch (table) {
    case 'devicecommonTable':
      if (!holder.devSet[nodeid]) {
        console.log('holder.devSet =' + util.inspect(holder.devSet));
        throw { err: 'SOFTERR', message: 'Not found device ' + nodeid + ' in holder.devSet ' };
      }
      return getDevicecommonTableRtObject(holder.devSet[nodeid], holder);

    case 'unitchannelsTable':
      // каналы плагина - взять также значения привязанных устройств
      //  Вернуть объект, ключ - id канала
      return getUnitchannelsTableRtObject(holder.unitSet[nodeid], holder);
    default:
      return {};
  }
}

function getUnitchannelsTableRtObject(unitItem, holder) {
  if (!unitItem || !unitItem.chano || !unitItem.chano.channels) return {};
  const robj = {};

  const unitChanObj = unitItem.chano;

  unitChanObj.charr.forEach(item => {
    robj[item.chan] = {
      realtime_chan_value: '',
      realtime_chan_ts: '',
      realtime_dev_value: '',
      realtime_dev_ts: '',
      realtime_dev_err: '',
      realtime_dev_cts: ''
    };

    if (unitChanObj.channels[item.chan]) {
      robj[item.chan].realtime_chan_val = unitChanObj.channels[item.chan].val;
      robj[item.chan].realtime_chan_ts = unitChanObj.channels[item.chan].ts;
    }

    if (item.did && item.prop && holder.devSet[item.did]) {
      const devRaw = holder.devSet[item.did]._raw;
      if (devRaw[item.prop]) {
        robj[item.chan].realtime_dev_val = devRaw[item.prop].val;
        robj[item.chan].realtime_dev_ts = devRaw[item.prop].ts;
        robj[item.chan].realtime_dev_cts = devRaw[item.prop].cts;
        robj[item.chan].realtime_dev_err = devRaw[item.prop].err;
      }
    }
  });
  return robj;
}

// function getDevicecommonTableRtObject(devItem, holder) {
async function getDevicecommonTableRtObject(dobj, holder) {
  if (!dobj) return {};
  const robj = {};

  // Внутри устройства по свойствам
  // const devRaw = devItem._raw;
  try {
    // const devRaw = await getDeviceRaw(dobj, holder);
    const devRaw = dobj._raw;
    Object.keys(devRaw).forEach(prop => {
      robj[prop] = {};
      robj[prop].realtime_dev_val = devRaw[prop].val;
      robj[prop].realtime_dev_fval = devRaw[prop].fval;
      robj[prop].realtime_dev_ts = devRaw[prop].ts;
      robj[prop].realtime_dev_cts = devRaw[prop].cts;
      robj[prop].realtime_dev_err = devRaw[prop].err;
    });

    return robj;
  } catch (e) {
    console.log('ERROR:  getDeviceRaw ' + util.inspect(e));
    return {};
  }
}

function getDeviceRaw(dobj, holder) {
  return new Promise((resolve, reject) => {
    holder.emit('getcb:device:raw', { did: dobj._id }, (err, result) => {
      if (!err) {
        resolve(result);
      } else reject(err);
    });
  });
}

function formSubTreeLeafItem(doc, id, nodeid) {
  const item = { id: doc._id, title: doc.title || doc.name, parent: doc.parent || 0, order: doc.order };
  if (id == 'channels' && nodeid) {
    item.title = doc.chan;
    item.component = 'channelview.' + nodeid;
  }
  return item;
}

function formSubTreeBranchItem(doc, id, nodeid) {
  const item = { id: doc._id, title: doc.title || doc.name, parent: doc.parent || 0, order: doc.order };

  if (id == 'channels' && nodeid) {
    item.title = doc.chan;
    item.component = 'channelfolder.' + nodeid;
  }
  return item;
}

// col, item, item[col.prop]
function formSmartbutton2Obj(col, item, val) {
  switch (col.prop) {
    case 'dn_prop':
      //  DN002.value => {id:"d0022", prop:'state', dn:'DN002', title:'DN002.value'} id-did устройства
      if (!val || typeof val != 'string') return {};
      if (!val) return {};
      return val.indexOf('.') > 0 ? getObjByDn_prop(val) : {};

    case 'id_prop':
      //  d001.value => {id:"d0022", prop:'state', dn:'DN002', title:'DN002.value'} id-did устройства
      if (!val || typeof val != 'string') return {};
      if (!val) return {};
      return val.indexOf('.') > 0 ? getObjByDid_prop(val) : {};  

    default:
      return {};
  }

  function getObjByDn_prop(dn_prop) {
    const [dn, prop] = dn_prop.split('.');
    // По dn найти did
    const id = getDeviceDidByDn(dn);
    return id ? { id, prop, dn, title: dn + '.' + prop } : {};
  }

  function getObjByDid_prop(did_prop) {
    const [did, prop] = did_prop.split('.');
  
    const dn = getDeviceDnByDid(did);
    return { id:did, prop, dn, title: dn + '.' + prop };
  }
}

function formLinkObj(table, colItem, item, val) {
  return domaindata.formLinkObj(table, colItem, item, val);
}

function getDroplist(query, holder) {
  const { id } = query;
  return isSpec('droplist', id) ? getSpecData(query, holder) : domaindata.getDroplist(id);
}

function getDroplistItem(listdata, key) {
  if (Array.isArray(listdata)) return listdata.find(el => el.id == key) || '';
  return domaindata.getDroplistItemFromList(listdata, key);
}

async function prepareToExport(query, user, holder) {
  if (!query.nodeid) throw { error: 'ERRGET', message: 'Missing nodeid!' };
  if (!query.param) throw { error: 'ERRGET', message: 'Missing param!' };

  if (query.param == 'image') return prepareToExportImage(query, holder);

  let data;
  const packExport = ['template', 'dialog', 'container', 'type', 'project']; // Выгружаются как ihpack
  if (packExport.includes(query.param)) {
    const title = 'Export: ' + query.param + ' ' + query.nodeid;
    const url = getUrl(query);
    const filename = await exportPack.formPackName(query, '', holder);
    data = { title, url, filename };
  } else if (query.param == 'extlog') {
    // Выгрузка лога
    const title = 'Export ' + query.nodeid+' log';
    const url = getUrl(query);
    const filename = 'ih_'+query.nodeid+'.log';
    data = { title, url, filename };

  } else if (query.param.indexOf(':') > 0) {
    // Прикладного уровня
    // channels:csv devices:csv
    const [param, format] = query.param.split(':');
    const nodeid = param == 'devices' ? '' : query.nodeid;
    const title = 'Export: ' + param + ' ' + nodeid;
    const url = getUrl({ param, nodeid, format });
    const filename = (param == 'devices' ? 'devices' : query.nodeid) + '.' + format;
    data = { title, url, filename };
  } else {
    throw { error: 'ERRGET', message: 'Unexpected param for export!' };
  }
  return { data };
}

function getUrl({ param, nodeid, format }) {
  return '/api/export?param=' + param + '&nodeid=' + nodeid + (format ? '&format=' + format : '');
}

/**
 * Подготовка к выгрузке одного файла изображения или несколько файлов внутри папки
 *
 * @param {Object} query
 *   nodeid: имя файла изображения или id папки
 * @param {Object} holder
 */
async function prepareToExportImage(query, holder) {
  const url = getUrl(query);
  const nodeid = query.nodeid;

  let data;
  // Если это id файла с изображением
  if (hut.isImgFile(nodeid)) {
    data = { title: nodeid, filename: nodeid, url };
  } else {
    const doc = await holder.dm.findRecordById('imagegroup', nodeid);
    if (!doc) throw { message: 'Not found imagegroup ' + nodeid };

    // Это папка - выбрать все файлы, посчитать их
    const imagegrid = await dataformer.getImagegrid(nodeid, holder.dm);

    const imgArr = imagegrid ? imagegrid.data : '';

    if (!imgArr || !imgArr.length) throw { message: doc.name + '. ' + appconfig.getMessage('EmptyFolder') };

    const title = `${imgArr.length} ${appconfig.getMessage('filesFromFolder')} ${doc.name}`;
    data = { title, url, filename: query.nodeid + '.zip' };
  }
  return { data };
}

async function exportOne(query, holder) {
  if (query.format) {
    if (exportmethods[query.format] && exportmethods[query.format][query.param]) {
      return exportmethods[query.format][query.param](query, holder);
    }
    throw { message: 'Not found exportmethod for ' + query.param + ', format ' + query.format };
  }

  switch (query.param) {
    case 'image':
      return exportPack.exportImage(query, holder);
    case 'extlog':
        return exportPack.exportLog(query, holder);
    case 'project':
      return exportPack.exportProject(query, holder);
    default:
      return exportPack.exec(query, holder);
  }
}

/**
 * Возвращает массив объектов [{dn, prop, days:30}]
 * Упорядоченный по days
 *
 * @param {*} query
 * @param {*} holder
 */
async function getDbRetention(query, holder) {
  const docs = await holder.dm.get(
    'devicedb',
    { days: { $gt: 0 }, dbmet: { $gt: 0 } },
    { sort: { days: 1 }, fields: { did: 1, prop: 1, days: 1 } }
  );

  const res = [];
  docs.forEach(item => {
    // Нужен dn вместо did
    if (holder.devSet[item.did] && holder.devSet[item.did].dn) {
      res.push({ dn: holder.devSet[item.did].dn, prop: item.prop, days: item.days });
    }
  });
  return res;
}

/**
 *
 * Упорядоченный по days
 *
 * @param {*} query
 * @param {*} holder
 */
async function getLogRetention(query, holder) {
  const res = {};
  // По def - 1 день
  res.devicelog = await holder.dm.get('device', {}, { sort: { days: 1 }, fields: { did: 1, days: 1 } });
  res.devicelog.forEach(item => {
    if (!item.days) item.days = 1;
  });
  res.pluginlog = await holder.dm.get('units', {}, { sort: { days: 1 }, fields: { unit: 1, days: 1 } });
  res.pluginlog.forEach(item => {
    if (!item.days) item.days = 1;
  });
  return res;
}

async function getLogRetentionDays(query, holder) {
  const res = {};
  const list = await domaindata.getDroplist('journalsrcList', true);
  if (!list || !list.data) {
    console.log('WARN: getLogRetentionDays. Not found journalsrcList');
    return {};
  }
  const tableNames = list.data.map(item => item.id);

  const jlevels = await holder.dm.get('jlevels');
  jlevels.forEach(rec => {
    const name = rec._id;
    if (tableNames.includes(name) && rec.props && typeof rec.props == 'object') {
      const arr = tabledata.transfromGenfieldObjToArray(rec.props).sort(hut.byorder('level'));
      if (arr.length) {
        res[name] = arr.map(item => ({ level: item.level, days: item.days || 1 }));
      }
    }
  });
  return res;
}

// Получить данные журнала для UI (по запросу /api/engine/get?type=journal&id=ir002&count=10&rowid=0)

async function getLogData(query, holder) {
  // id - номер журнала

  const { id, rowid, count } = query;
  const doc = await holder.dm.findRecordById('journal', id);
  if (!doc || !doc.src) return [];

  const columns = [];
  if (doc.props) {
    Object.keys(doc.props).forEach(el => {
      if (doc.props[el].prop) columns.push(doc.props[el].prop);
    });
  }
  columns.push('level'); // Для раскрашивания

  const startTsid = rowid == 0 ? '' : rowid;
  const limit = Number(count) || 1000;
  const sql = 'SELECT * FROM ' + doc.src + sqlutil.formLogWhere(doc, startTsid) + ' ORDER BY tsid DESC LIMIT ' + limit;
  const recs = await logconnector.read(sql);

  // Получен результат - формировать столбцы с учетом выбранных
  const data = recs.map(rec => formRow(rec));
  return { data };

  function formRow(rec) {
    const row = { id: rec.tsid };
    columns.forEach(prop => {
      let val = rec[prop] != undefined ? rec[prop] : '';
      if (prop == 'dts') val = hut.getDateTimeFor(new Date(rec.ts));
      row[prop] = val;
    });
    return row;
  }
}

async function getAlertLogData(query, holder) {
  // id - номер журнала
 
  const { id } = query;
  const doc = await holder.dm.findRecordById('alertjournal', id);
  if (!doc ) return [];
 
  const filter = {};
  const columns = [];
  const data = await getAlertLogRows(filter, columns, holder);
  return {data};
}

// Чтение алертов - для UI и PM

async function getAlertLogRows(filter, columns, holder) {
  // const docs = await holder.dm.dbstore.get('alerts', filter);
  const docs = await holder.dm.dbstore.get('alerts');

  const userList = liststore.getListMap('userList');
  
  const arr = docs.sort(hut.byorder('tsStart', 'D')).map(item => ({
    ...item,
    id: item._id,
    _command:'api_ack_alert',
    username: item.userId && userList.get(item.userId) ? userList.get(item.userId).title : '',
    state: item.tsStop > 0 ? 0 : 1,
    stateStr: item.tsStop > 0 ? 'stopped: ' + item.reason : 'active',
    tsStartStr: getTsStr(item.tsStart),
    tsStopStr: getTsStr(item.tsStop),
    tsAckStr: getTsStr(item.tsAck)
  }));

  return columns && columns.length ? arr.map(rec => formRow(rec)) : arr;

  function formRow(rec) {
    const row = { id: rec.id };
    columns.forEach(prop => {
      row[prop] = rec[prop] != undefined ? rec[prop] : '';
    });
    return row;
  }

  function getTsStr(ts) {
    return hut.isTs(ts) ? hut.getDateTimeFor(new Date(ts), 'dtms') : '';
  }
}

function getDefaultJournalColumns(table) {
  switch (table) {
    case 'alertjournal':
      return [
        { title: 'Время начала', prop: 'tsStartStr', width: 200 },
        { title: 'Сообщение', prop: 'txt', width: 500 },
        { title: 'Время завершения', prop: 'tsStopStr', width: 200 },
        { title: 'Квитировать', prop: 'rowbutton', width: 200 },
        { title: 'Время квитирования', prop: 'tsAckStr', width: 200 },
        { title: 'Оператор', prop: 'username', width: 200 }
      ];
    default:
      return [
        { title: 'Дата', prop: 'dts', width: 200 },
        { title: 'Сообщение', prop: 'txt', width: 500 },
        { title: 'Тэги', prop: 'tags', width: 200 }
      ];
  }
}

function isSpecSystemData(type, id) {
  return type == 'menu' && id == 'pmmenu';
}

async function getSpecSystemData(query, dm) {
  if (!query || !isSpecSystemData(query.type, query.id)) return;

  if (query.id == 'pmmenu') {
    const data = await loadsys.loadSystemData(query.type, query.id);
   
    // Проверить наличие модулей; 
    for (let i = data.length-1; i>=0; i--) {
      const section  = data[i].route;
      if (section && appconfig.disSection(section)) {
        data.splice(i,1);
      }
    }
    return data;
  }
}


module.exports = {
  isVirttable,
  getVirttable,
  isSpecType,
  isSpec,
  isSpecMeta,
  getSpecMeta,
  getSpecData,
  getSpecTree,
  processSpecType,
  getMetaCacheIds,
  needFinishing,
  finishing,
  getDroplist,
  getDroplistItem,
  getRecordDependentForms,
  prepareToExport,
  exportOne,

  getRecordIdByLink,
  chooseTreeItemComponent,

  getTreeItemTitle,
  isRealtimeTable,
  getRealtimeValues,
  formSubTreeLeafItem,
  formSubTreeBranchItem,
  formLinkObj,
  formSmartbutton2Obj,
  getDeviceDidByDn,
  getDbRetention,
  getLogRetention,
  getLogRetentionDays,
  getLogData,
  getAlertLogData,
  getAlertLogRows,
  getDefaultJournalColumns,
  isSpecSystemData,
  getSpecSystemData
};
