/**
 * Snippetengine.js
 *  - запускает сниппеты с интервалом, значения передает целевому устройству или глобальной переменной
 *  - запуск кода выполняется в отдельном worker-е (один для всех сниппетов)
 *
 */

const util = require('util');

const hut = require('../utils/hut');
const Timerman = require('../utils/timermanager');

const tm = new Timerman(0.1); // Запустить механизм таймеров c мин интервалом 100 мсек

class Snippetengine {
  constructor(holder) {
    this.holder = holder;
    this.dm = holder.dm; // для snippetmate

    this.snippetSet = {};
    holder.snippetSet = this.snippetSet;

    tm.on('ready', this.onTimerReady.bind(this));

    // Интерактивный запуск??
    holder.on('startsnippet', (did, period) => {
      this.startSnippet(did, period);
    });

    holder.on('debugctl', (mode, uuid) => {
      if (uuid && uuid.startsWith('scene_snippet')) {
        this.debugctl(mode, uuid.split('_').pop());
      }
    });
  }

  start(snippets) {
    // [{did, file, period}]
    snippets.forEach(item => {
      this.addItem(item);
    });
  }

  addItem(item) {
    const did = item.did;
    this.snippetSet[did] = item;
    this.snippetSet[did].active = 0;
    this.snippetSet[did].debug = 0;
    this.snippetSet[did].resets = 0;
    this.run(did);
  }

  updateItem(item) {
    const did = item.did;
    if (this.snippetSet[did]) {
      tm.deleteAllTimers({ owner: 'snippet', tname: did });

      // Если в текущий момент работает, то не учитывать результат работы??
      // Будет запущен после отработки
      if (this.snippetSet[did].active) {
        this.snippetSet[did] = item;
        this.snippetSet[did].active = 1;
        this.snippetSet[did].modif = 1;
        return;
      }
      item.debug = this.snippetSet[did].debug;
    }
    this.addItem(item);
  }

  removeItem(did) {
    if (this.snippetSet[did]) delete this.snippetSet[did];
  }

  needRun(did) {
    return this.snippetSet[did] && !this.snippetSet[did].error && hasPeriod(this.snippetSet[did].period);
  }

  getTarget(did) {
    return this.snippetSet[did].global ? this.holder.global.getItem(did) : this.holder.devSet[did];
  }

  run(did) {
    if (!this.needRun(did)) return;

    const file = this.snippetSet[did].file;
    const target = this.getTarget(did);
    if (!target) {
      this.debugSnippet(did, 'Not found target=' + did);
      return;
    }

    this.snippetSet[did].active = 1;
    this.snippetSet[did].startTs = 0;
    this.snippetSet[did].stopTs = 0;
    this.holder.snippetWorker.postMessage({ name: 'run:snippet', data: { did, file, target } });
   
  }

  getResult({ did, result, ts, error }) {
    this.snippetSet[did].active = 0;
    this.snippetSet[did].stopTs = ts;
    this.debugSnippet(did, 'Result: ' + util.inspect(result) + (error ? ' Error: ' + error : ''));

    // Могли уже сниппет отключить тогда ничего не делаем
    if (!this.snippetSet[did]) return;

    if (this.snippetSet[did].modif) {
      this.snippetSet[did].modif = 0;
    } else {
      let name = 'received:device:data';
      let valObj = typeof result == 'object' ? result : { value: result };
      
      if (this.snippetSet[did].global) {
        name = 'received:globals';
        valObj = result; // Просто значение?
      }   
      this.holder.emit(name, { [did]: valObj });
    }
    /*
    } else if (this.snippetSet[did].global) {
      this.holder.emit('received:globals', { [did]: result });
     
      // const val = typeof result == 'object' ? result.value : result;
      // if (val != undefined) this.holder.global.setValue(did, result);
      
    } else {
      const valObj = typeof result == 'object' ? result : { value: result };
      this.holder.emit('received:device:data', { [did]: valObj });
    }
    */

    // Запуск следующий раз
    const { qts } = tm.startTimer(this.snippetSet[did].period, { owner: 'snippet', tname: did });
    this.snippetSet[did].qts = qts;
    this.debugSnippet(did, 'Next start ' + hut.getDateTimeFor(new Date(qts), 'shortdt'));
  }

  onTimerReady(timeobj) {
    if (timeobj.owner == 'snippet') {
      // TODO Проверить, что сниппет для устройства еще нужен
      const did = timeobj.tname;
      if (this.snippetSet[did]) {
        // Если callback не сработал - выставить ошибку timeout??
        this.run(did);
      }
    }
  }

  updateSnippet(snipid, filename) {
    // 
    this.holder.snippetWorker.postMessage({ name: 'update:snippet', data: { filename } });
    this.getDidsBySnipId(snipid).forEach(did => {
      // Сбросить ошибку, таймеры, перезапустить
      this.snippetSet[did].error = '';
      this.snippetSet[did].debugerror = '';
      this.snippetSet[did].resets = 0;

      tm.deleteAllTimers({ owner: 'snippet', tname: did });
      this.run(did);
    });
  }

  getDidsBySnipId(snipid) {
    return Object.keys(this.snippetSet).filter(did => this.snippetSet[did].snipid == snipid);
  }

  debugctl(mode, snipid) {
    Object.keys(this.snippetSet).forEach(did => {
      if (this.snippetSet[did].snipid == snipid) {
        this.snippetSet[did].debug = mode; // 0 || 1
        if (mode) {
          // Включена подписка - вывести текущее состояние
          this.showState(did);
        }
      }
    });
  }

  debugSnippet(did, msg) {
    if (this.snippetSet[did] && this.snippetSet[did].debug) {
      const snipid = this.snippetSet[did].snipid;
      this.holder.emit(
        'debug',
        'scene_' + snipid,
        hut.getDateTimeFor(new Date(), 'shortdtms') + ' target: ' + did + ' ' + msg
      );
    }
  }

  showState(did) {
    if (!this.snippetSet[did]) return;
    let msg;
    if (this.snippetSet[did].error) {
      msg = 'ERROR: '+this.snippetSet[did].error;
    } else if (this.snippetSet[did].qts) {
      msg = 'Next start ' + hut.getDateTimeFor(new Date(this.snippetSet[did].qts), 'shortdt');
    } else if (this.snippetSet[did].active) {
      msg = 'Working..';
    } else {
      msg = 'Stopped ' ;
    }
    this.debugSnippet(did, msg);
  }
}

function hasPeriod(str) {
  if (!str) return;
  // str = str.replace(':', '');
  return !isNaN(str) && Number(str) > 0;
}

module.exports = Snippetengine;


 /*
    // Запустить сниппет. После первого require модуль кэшируется
    this.snippetSet[did].active = 1;
    this.snippetSet[did].lts = Date.now();
    this.snippetSet[did].qts = 0;
    this.debugSnippet(did, 'Started');

    try {
   
      const fn = require(file);
      if (typeof fn != 'function') throw {message:'Модуль должен экспортировать функцию!'}

      const str = fn.toString();
      const arr = /^([^)]+)\)/.exec(str);
       
      if (!arr && arr[0]) {
        throw {message:'Функция должна иметь аргументы!'}
      }

      const args = arr[0].split(',');
      if (!args || args.length != 2) {
        throw {message:'Функция должна иметь 2 аргумента: (target, callback) '}
      }

      fn(target, (error, result) => {
        this.snippetSet[did].active = 0;
        this.debugSnippet(did, 'Result: ' + util.inspect(result) + (error ? ' Error: ' + error : ''));

        // Могли уже сниппет отключить тогда ничего не делаем
        if (!this.snippetSet[did]) return;

        if (this.snippetSet[did].modif) {
          this.snippetSet[did].modif = 0;
        } else if (this.snippetSet[did].global) {
          const val = typeof result == 'object' ? result.value : result;
          if (val != undefined) this.holder.global.setValue(did, result);
        } else {
          const valObj = typeof result == 'object' ? result : { value: result };
          this.holder.emit('received:device:data', { [did]: valObj });
        }

        // Запуск следующий раз
        const { qts } = tm.startTimer(this.snippetSet[did].period, { owner: 'snippet', tname: did });
        this.snippetSet[did].qts = qts;
        this.debugSnippet(did, 'Next start ' + hut.getDateTimeFor(new Date(qts), 'shortdt'));
      }); // end of callback

    } catch (e) {
      // Ошибка при запуске сниппета
      const errStr = hut.getShortErrStr(e);
      this.snippetSet[did].err = errStr;
      this.debugSnippet(did, errStr);
      console.log('ERROR: Snippet run error for ' + did + ': ' + errStr);
    }
    */