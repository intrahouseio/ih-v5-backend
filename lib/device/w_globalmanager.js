/**
 * w_globalmanager.js
 */

const util = require('util');
const appconfig = require('../appconfig');
const hut = require('../utils/hut');

class Globalmanager {
  constructor(wCore) {
    this.wCore = wCore;

    this.glByDid = {}; // key= _id (did), содержит всю инф-ю, [did].value - текущее значение
    this.glByDn = {}; // key= dn (просто указатель на объект в glSet dn=> did)
    this.triggersOnChange = {}; // {<dn>:{<prop>: new Set [gl001, gl001]}}
    this.handlersOnChange = {}; // {<gl_did>:function
  }

  getItem(id) {
    return id.startsWith('gl') ? this.glByDid[id] : this.glByDn[id];
  }

  // При присваивании - сразу принимается 
  // генерируется событие для передачи и для отработки скриптов
  setValue(id, value, sender) {
    const item = this.getItem(id);
    if (item) {
      if (item.value != value) {
        const prev = item.value;
        item.value = value;

        const did = item._id;
        const prop = item.dn;
        const ts = Date.now();
        this.wCore.postMessage('accepted:globals',  [{ did, prop, value, ts, changed: 1, prev }]);
        this.wCore.emit('changed:globals', [{ did, prop, value, ts, changed: 1, prev }]);
      }
    } else {
      console.log('ERROR: Globalset var not found ' + id);
    }
  }

  
  getValue(id) {
    const item = this.getItem(id);
    return item ? item.value : 0;
  }

  updateItem(did, doc) {
    console.log('GL updateItem did=' + did + util.inspect(doc));
    let clone;
    if (this.glByDid[did]) {
      clone = hut.clone(this.glByDid[did]);
      // {val, ts, prev} = this.glByDid[did];

      this.removeItem(did);
    }

    // Удалить ссылки на обработчик для всех триггеров
    // removeFromAllSet(this.triggersOnChange, doc._id);

    // Добавить заново˝- значение нужно сохранить!!!??
    this.addItem(did, doc, clone ? { val: clone.val, ts: clone.val, prev: clone.prev } : '');
  }


  
  removeItem(did) {
    if (this.glByDid[did]) {
      const dn = this.glByDid[did].dn;
      if (dn) delete this.glByDn[dn];
      delete this.glByDid[did];
    }
    /*
    removeFromAllSet(this.triggersOnChange, did);
    if (this.glSet[did]) {
      const dn = this.glSet[did].dn;
      if (dn) delete this.gldnSet[dn];
      delete this.glSet[did];
    }
    */
  }

  // Пришло вместе с данными
  addItem(did, doc) {
    if (!doc || !did) return;
    this.glByDid[did] = doc;

    this.glByDn[doc.dn] = this.glByDid[did];
  

    /*  
    

      // Может содержать обработчик, запускаемый по триггерам
      if (doc.scriptOnChange) {
        if (!this.handlersOnChange[doc._id]) this.handlersOnChange[doc._id] = {devs:{}, handler:''};
        this.addTriggers(doc);
        this.addHandler(doc._id); 
      } else {
        if (this.handlersOnChange[doc._id]) delete this.handlersOnChange[doc._id];
        unrequireHandler(doc._id)
      }
    }
  */
  }

  addTriggers(doc) {
    if (!doc.scripttriggers) return;
    Object.keys(doc.scripttriggers).forEach(el => {
      if (doc.scripttriggers[el].devtrig) {
        const [did, prop] = doc.scripttriggers[el].devtrig.split('.');
        if (did && this.holder.devSet[did]) {
          addToSet(this.triggersOnChange, did, prop, doc._id);

          // В сценарии обращение по dn
          const dobj = this.holder.devSet[did];
          this.handlersOnChange[doc._id].devs[dobj.dn] = dobj;
        }
      }
    });
  }

  addHandler(gl_did) {
    this.handlersOnChange[gl_did].filename = appconfig.getHandlerFilenameIfExists(gl_did);
  }

  /*
  runHandlersOnChange(changed) {
    // Группировать изменения  - обработчик должен запуститься один раз
    const toRun = new Set();
    changed.forEach(item => {
      if (
        item.did &&
        item.prop &&
        this.triggersOnChange[item.did] &&
        this.triggersOnChange[item.did][item.prop] // это Set
      ) {
        for (const gl_did of this.triggersOnChange[item.did][item.prop]) {
          if (this.handlersOnChange[gl_did]) toRun.add(gl_did);
        }
      }
    });

    if (!toRun.size)  return;
    for (const gl_did of toRun) {
      // Запуск функции 
      if (this.handlersOnChange[gl_did].filename) {
        const handler = require(this.handlersOnChange[gl_did].filename);
       
        const res = handler(this.getValue(gl_did), this.handlersOnChange[gl_did].devs);
        if (res != undefined)  this.setValue(gl_did, res);
      }
    }
  }
  */
}

// Private
function addToSet(obj, did, prop, gl_did) {
  if (!obj[did]) obj[did] = {};
  if (!obj[did][prop]) obj[did][prop] = new Set();
  obj[did][prop].add(gl_did);
}

function removeFromAllSet(obj, gl_did) {
  Object.keys(obj).forEach(did => {
    Object.keys(obj[did]).forEach(prop => {
      if (obj[did][prop] && obj[did][prop].has(gl_did)) obj[did][prop].delete(gl_did);
    });
  });
}

module.exports = Globalmanager;