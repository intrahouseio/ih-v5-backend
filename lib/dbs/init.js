/**
 * dbs/init.js - инициализация структур работы с данными
 */

// const util = require('util');

const hut = require('../utils/hut');

const dbstore = require('./dbstore');
const descriptor = require('./descriptor');
const numerator = require('./numerator');
const loadsys = require('./loadsys');
const tagstore = require('./tagstore');
const cache = require('./cache');
const treeguide = require('./treeguide');

const collectionsWithTags = ['devices', 'types'];

module.exports = async function() {
  // Запуск хранилища, передать ему список коллекций
  dbstore.start(loadsys.loadAndTranslateJsonFileSync('dbs', 'collections'));

  // Создать tagMap, из некоторых коллекций считать тэги
  tagstore.start();
  for (const collection of collectionsWithTags) {
    const docs = await dbstore.get(collection, { tags: { $exists: true } }, { fields: { tags: 1 } });
    tagstore.addFromDocs(docs, collection);
  }

  // Запуск объекта-дескриптора, передать ему описание деревьев, таблиц и списков
  const tables = loadsys.loadAndTranslateJsonFileSync('dbs', 'tables');
  descriptor.start(
    loadsys.loadAndTranslateJsonFileSync('dbs', 'trees'),
    tables,
    loadsys.loadAndTranslateJsonFileSync('dbs', 'lists')
  );

  // Загрузить из каждого файла в папке tree (trees берет все файлы из папки tree)
  descriptor.setTreeDefaultComponents(await loadsys.loadMeta('trees'));

  // Запуск объекта-нумератора, для каждой таблицы сформировать правило нумерации
  for (const table in tables) {
    await numerator.createNumerator(table, tables[table]);
  }

  // Создать корневые записи для иерархических справочников в lists
  const data = await dbstore.get('lists', { parent: 0 });
  const found = hut.arrayToObject(data, 'list');
  const docsToWrite = descriptor.createNonexistentListsRootNodes(found);
  if (docsToWrite.length > 0) {
    await dbstore.insert('lists', docsToWrite);
  }

  cache.start();
  treeguide.start();
};