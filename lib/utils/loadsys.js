/**
 *  loadsys.js
 *   Загрузка из папки sysbase (данные, метаданные)
 *   Папка sysbase входит в состав сервера (не проекта)
 *   Файлы внутри расположены в папках по типу: menu, tree, form, component
 */

const util = require('util');
const fs = require('fs');
const path = require('path');

const appconfig = require('../appconfig');
const hut = require('./hut');
const translate = require('./translate');

/**
 * Возвращает объект из системного файла или папки по запросу getmeta
 * @param {*} type - тип определяет папку. Если заканчивается 's', то считываются все файлы папки в один json
 *             type:'components' => все файлы из папки 'component'
 * @param {*} id  - имя файла без json
 */
async function loadMeta(type, id) {
  if (type && type.endsWith('s')) {
    // Содержимое папки
    const folder = getSysbaseFoldername(type.substr(0, type.length - 1));
    return loadAndTranslateJsonFromFolder(folder);
  }

  if (type == 'manifest') {
    return loadManifest(id);
  }
  const filename = getSysbaseFilename(type, id);
  return loadAndTranslateJsonFile(filename);
}

function loadManifest(id) {
  const plugin = id.substr(0, id.length - 1);

  appconfig.getThePluginPath(plugin);
  const filename = path.resolve(appconfig.getThePluginPath(plugin), plugin + '.json');
  return loadAndTranslateJsonFile(filename); // Файлы-словари в плагине!!
}

/**
 *
 * @param {*} type
 * @param {*} id
 */
async function loadSystemData(type, id) {
  const filename = getSysbaseFilename(type, id);
  return loadAndTranslateJsonFile(filename);
}

function getSysbaseFilename(type, id) {
  return path.resolve(appconfig.get('sysbasepath'), type, id + '.json');
}

function getSysbaseFoldername(type) {
  return path.resolve(appconfig.get('sysbasepath'), type);
}

async function loadAndTranslateJsonFile(filename, dictFilename) {
  try {
    const buf = await fs.promises.readFile(filename, 'utf8');
    const data = JSON.parse(buf.toString());
    if (dictFilename) {
      const dict = await fs.promises.readFile(dictFilename, 'utf8');
      translate.translateIt(data, JSON.parse(dict.toString()));
    } else {
      appconfig.translateSys(data);
    }
    return data;
  } catch (e) {
    throw { err: 'ERRREAD', message: 'File ' + filename + ' ' + e.message };
  }
}

function loadAndTranslateJsonFileSync(folder, file) {
  const filename = getSysbaseFilename(folder, file);
  const buf = fs.readFileSync(filename, 'utf8');
  const data = JSON.parse(buf.toString());
  appconfig.translateSys(data);
  return data;
}

async function loadAndTranslateJsonFromFolder(folder) {
  const files = await fs.promises.readdir(folder);

  if (!files || !files.length) return {};
  const res = {};
  for (let file of files) {
    if (file && file.length > 3 && hut.getFileExt(file) == 'json') {
      const name = hut.getFileNameExtLess(file);

      res[name] = await loadAndTranslateJsonFile(folder + '/' + file);
    }
  }
  return res;
}

async function loadScene(sceneId) {
  const filename = appconfig.getScriptFilename(sceneId);
  return fs.existsSync(filename) ? loadFile(filename) : '';
}
async function loadHandler(id) {
  const filename = appconfig.getHandlerFilename(id);
  return fs.existsSync(filename) ? loadFile(filename) : '';
}

async function loadFile(filename) {
  try {
    const buf = await fs.promises.readFile(filename, 'utf8');
    const data = buf.toString();
    return data;
  } catch (e) {
    throw { err: 'ERRREAD', message: 'File ' + filename + ' ' + e.message };
  }
}

async function loadPluginMetaData(type, id, unit) {
  const plugin = hut.removeLastNumFromStr(unit);
  const filename = path.resolve(appconfig.getThePluginPath(plugin), 'v5', id + '.json');

  // Перевод делается дважды - сначала из основного файла, потом locale плагина
  if (fs.existsSync(filename)) {
    let data = await loadAndTranslateJsonFile(filename);

    const dictFilename = appconfig.getPluginDictFilename(plugin);
    if (dictFilename) {
      try {
        const dict = await fs.promises.readFile(dictFilename, 'utf8');
        if (dict) {
          const dictObj = JSON.parse(dict);

          data = translate.translateIt(data, dictObj);
        }
      } catch (e) {
        console.log('dictObj error in file:' + dictFilename);
      }
    }
    return data;
  }

  // Если файл не существует - возвращаем типовой из папки сервера. Он будет закеширован как файл плагина
  return loadMeta(type, id);
}

async function loadProjectJson(folder, fileId) {
  const filename = path.resolve(appconfig.get('jbasepath'), folder, fileId + '.json');
  let res = {};
  try {
    const data = await fs.promises.readFile(filename, 'utf8');
    if (data) {
      res = JSON.parse(data);
    }
  } catch (e) {
    console.log('Object loading error from file:' + filename + '. ' + util.inspect(e));
  }
  return res;
}

function loadProjectJsonSync(folder, fileId) {
  const filename = path.resolve(appconfig.get('jbasepath'), folder, fileId + '.json');
  let res = {};
  try {
    const data = fs.readFileSync(filename, 'utf8');
    if (data) {
      res = JSON.parse(data);
    }
  } catch (e) {
    console.log('Object loading error from file:' + filename + '. ' + util.inspect(e));
  }
  return res;
}

module.exports = {
  loadMeta,
  loadSystemData,
  loadProjectJson,
  loadProjectJsonSync,
  loadAndTranslateJsonFileSync,
  loadScene,
  loadHandler,
  loadPluginMetaData
};