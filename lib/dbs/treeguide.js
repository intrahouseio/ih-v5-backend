/**
 * Объект для работы с деревьями.
 *   treeMap хранит для каждого дерева объекты - узлы, ключ - id узла
 *   Используется для построения breadcrumbs
 *   Раздел дерева всегда создается заново при перегенерации дерева (после сброса кэша)
 *   При изменении узлов редактируется, а не сбрасывается, так как дерево часто заново не запрашивается
 *    => перегенерация происходит не всегда!
 */

// const util = require('util');

const descriptor = require('../dbs/descriptor');

module.exports = {
  start() {
    this.treeMap = {};
  },

  get(treeId) {
    return this.treeMap[treeId];
  },

  getItem(treeId, nodeId) {
    return this.treeMap[treeId][nodeId];
  },

  create(treeId, b_array, l_array, desc) {
    const tree_guide = {};

    b_array.forEach(item => {
      tree_guide[item.id] = {
        id: item.id,
        title: item.title,
        parent: item.parent,
        table: desc.branch.table
      };
    });
    l_array.forEach(item => {
      tree_guide[item.id] = {
        id: item.id,
        title: item.title,
        parent: item.parent,
        table: desc.leaf.table,
        leaf: true
      };
    });
    this.treeMap[treeId] = tree_guide;
    return tree_guide;
  },

  addItem(treeId, nodeId, item) {
    if (!this.treeMap[treeId]) this.treeMap[treeId] = {};
    this.treeMap[treeId][nodeId] = item;
  },

  updateItem(treeId, nodeId, item) {
    if (!this.treeMap[treeId]) this.treeMap[treeId] = {};
    if (!this.treeMap[treeId][nodeId]) this.treeMap[treeId][nodeId] = { id: nodeId };
    Object.assign(this.treeMap[treeId][nodeId], item);
  },

  deleteItem(treeId, nodeId) {
    if (this.treeMap[treeId] && this.treeMap[treeId][nodeId]) delete this.treeMap[treeId][nodeId];
  },

  async getBreadcrumbs(treeId, nodeId) {
    const tree_guide = this.treeMap[treeId];

    const defComp = descriptor.getTreeDefaultComponents(treeId);
    const breadArr = [];
    let parent = nodeId;
    while (parent) {
      if (tree_guide[parent]) {
        breadArr.unshift({ id: parent, title: tree_guide[parent].title, component: getComponent(tree_guide[parent]) });
        parent = tree_guide[parent].parent;
      } else parent = '';
    }
    return breadArr;

    function getComponent(item) {
      if (!defComp) return '';

      return item.leaf ? defComp.child : defComp.parent;
    }
  }
};