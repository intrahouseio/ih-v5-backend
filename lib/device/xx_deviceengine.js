/**
 * deviceengine.js
 */
const util = require('util');

const hut = require('../utils/hut');
const Devo = require('./devo');
const deviceutil = require('./deviceutil');
const device_struct = require('./device_struct');
const Timerman = require('../utils/timermanager');

class Deviceengine {
  constructor(holder, agent) {
    this.holder = holder;
    this.dm = holder.dm;
    this.agent = agent;

    this.devSet = {}; // key= _id (did)
    this.dnSet = {}; // key = dn,
    this.holder.devSet = this.devSet;
    this.holder.dnSet = this.dnSet;
    this.onChangeByType = {}; // {t002:['state','temp'], t003:'*'}
    this.onGlobalChange = {}; // {dayNight:new Set([type1, type2]), 'Guard':new Set([type1, type2])} // Наоборот

    this.onScheduleByType = {}; // {hourly: new Set([type1, type2])}
    this.onIntervalByType = {}; // {10: new Set([type1, type2])}

    this.globals = wrapGlobal(this.holder.glSet);
    this.tm = new Timerman(0.1); // Запустить механизм таймеров c мин интервалом 100 мсек
    this.tm.on('ready', this.onTimerReady.bind(this));

    agent.start(holder);
  }

  start(typestore) {
    this.typestore = typestore;
    this.typeMap = typestore.getTypeMap();

    //  Создать системный индикатор  Возможно, он уже создан - тогда не создавать
    this.holder.on('create:unitIndicator', unitId => {
      const id = deviceutil.getUnitIndicatorId(unitId);
      if (!this.hasDevice(id)) {
        this.addDevice(deviceutil.createUnitIndicatorDoc(unitId), 'boot');
        this.dm.invalidateCache({ type: 'tree', id: 'sysdevices' });
      }
    });

    // Удалить системный индикатор
    this.holder.on('remove:unitIndicator', unitId => {
      const id = deviceutil.getUnitIndicatorId(unitId);
      if (this.hasDevice(id)) {
        this.removeDevice({ _id: id });
        deviceutil.removeUnitIndicatorDoc(unitId);
        this.dm.invalidateCache({ type: 'tree', id: 'sysdevices' });
      }
    });

    // Событие received:device:data - получены данные от плагина
    this.holder.on('received:device:data', getObj => {
      const accepted = [];
      Object.keys(getObj).forEach(did => {
        if (did && this.devSet[did]) {
          accepted.push(...this.devSet[did].acceptData(getObj[did]));
        } else {
          console.log('ERROR: received:device:data. Device not found ' + did);
        }
      });

      if (accepted.length) {
        this.agent.emitDeviceDataAccepted(accepted);
      }
    });

    // Событие accepted:device:data - данные приняты на уровне устройства  (м б от плагина или setValue )
    this.holder.on('accepted:device:data', accepted => {
      const changed = accepted.filter(item => item && item.changed);
      if (changed.length) {
        this.holder.emit('changed:device:data', changed);
        this.runHandlersOnChange(changed);
      }
    });

    // Запуск обработчиков при изменении глобальных переменных
    this.holder.on('changed:globals', changed => {
      this.runHandlersOnGlobalChange(changed);
    });

    // Запуск обработчиков по расписанию
    this.holder.on('scheduler:ready', (timername, triggers) => {
      this.runHandlersOnSchedule(timername, triggers);
    });
  }

  getHandlerForType(type, event) {
    return this.typestore.getHandlerFun(type, '_' + event);
  }

  runDeviceHandler(did, fn, triggers) {
    try {
      if (fn) fn(this.devSet[did], triggers, this.globals);
    } catch (e) {
      console.log('ERROR: Device Handler: ' + util.inspect(e));
      this.devSet[did].agent.logDevice(did, { prop: 'error', txt: 'Device Handler error!' });
    }
  }

  runHandlersOnChange(changed) {
    // Группировать изменения по устройству - обработчик должен запуститься один раз
    // Если внутри обработчиков будут изменения - это будет новая порция событий для changed?
    const devChanged = {};
    changed.forEach(item => {
      if (
        item.did &&
        this.devSet[item.did] &&
        this.devSet[item.did].type &&
        this.onChangeByType[this.devSet[item.did].type]
      ) {
        if (!devChanged[item.did]) devChanged[item.did] = [];
        devChanged[item.did].push(item.prop);
      }
    });

    Object.keys(devChanged).forEach(did => {
      // Запуск обработчика типа, если совпадает свойство
      const type = this.devSet[did].type;
      const fun = this.getHandlerForType(type, 'OnChange');
      const props = this.onChangeByType[type];
      if (fun && props) {
        const triggers = props == '*' ? devChanged[did] : hut.arrayIntersection(props, devChanged[did]);
        if (triggers.length) {
          this.runDeviceHandler(did, fun, triggers);
        }
      }
    });
  }

  runHandlersOnGlobalChange(changed) {
    //  {did: 'gl002', prop: 'dayNight', value: 1, ts: 1615487425742,}
    changed.forEach(item => {
      if (this.onGlobalChange[item.did]) {
        // Есть обработчики типов, которые запускаются по этой глобальной переменной
        for (const type of this.onGlobalChange[item.did]) {
          const fun = this.getHandlerForType(type, 'OnChange');
          Object.keys(this.devSet).forEach(did => {
            if (this.devSet[did].type == type) {
              this.runDeviceHandler(did, fun, ['globals.' + item.prop]);
            }
          });
        }
      }
    });
  }

  runHandlersOnSchedule(timername, triggers) {
    if (!timername || !this.onScheduleByType[timername]) return;

    for (const type of this.onScheduleByType[timername]) {
      // Найти все устройства данного типа, запустить обработчик для каждого устройства
      const fun = this.getHandlerForType(type, 'OnSchedule');
      Object.keys(this.devSet).forEach(did => {
        if (this.devSet[did].type == type) {
          this.runDeviceHandler(did, fun, triggers);
        }
      });
    }
  }

  onTimerReady(timeobj) {
    // Проверить, какие типы запускаются с этим интервалом
    const interval = timeobj.tname;
    if (this.onIntervalByType[interval]) {
      // 
      this.tm.startTimer(interval, { owner: 'type', tname: interval });
      for (const type of this.onIntervalByType[interval]) {
        // Найти все устройства данного типа, запустить обработчик для каждого устройства
        const fun = this.getHandlerForType(type, 'OnInterval');
        Object.keys(this.devSet).forEach(did => {
          if (this.devSet[did].type == type) {
            this.runDeviceHandler(did, fun, [interval]);
          }
        });
      }
    }
  }

  /**
   * Формирует структуры для запуска обработчиков
   * Вызывается при добавлении/ редактировании/удалении типа
   * @param {Array of Objects} - arr  Массив новых документов или изменений
   *
   */
  formTypeHandlerSets(arr) {
    arr.forEach(item => {
      const type = item._id;

      let par_OnChange = '';
      let par2_OnChange = '';
      if (item.scriptOnChange) {
        if (item.par_OnChange == '*') {
          par_OnChange = '*';
        } else  if (item.par_OnChange) {
          par_OnChange = Array.isArray(item.par_OnChange) ? item.par_OnChange : item.par_OnChange.split(/\s*,\s*/);
        }
        par2_OnChange = item.par2_OnChange; // Если существует глобальная переменная??
      }
      this.onChangeByType[type] = par_OnChange; // Если сбросили - будет пусто

      if (par2_OnChange) {
        addToSet(this.onGlobalChange, type, par2_OnChange);
      } else {
        removeFromAllSet(this.onGlobalChange, type);
      }

      if (item.scriptOnInterval) {
        addToSet(this.onIntervalByType, type, item.par_OnInterval || 600);
      } else {
        // сбросить
        removeFromAllSet(this.onIntervalByType, type);
      }

      this.updateSchedule(
        item.scriptOnSchedule,
        item.par_OnSchedule == 'cron' ? item.par2_OnSchedule : item.par_OnSchedule,
        type
      );
    });
    // console.log('this.onChangeByType=' + util.inspect(this.onChangeByType));
    // console.log('this.onIntervalByType=' + util.inspect(this.onIntervalByType));
  }

  updateSchedule(flag, par, type) {
    // console.log('DEVICEENGINE updateSchedule flag='+flag+' par='+par+' type='+type);
    // Проверить, что было включено
    const included = getKeyOfSet(this.onScheduleByType, type);

    if (!flag && !included) return;
    if (flag && included == par) return;

    if (included) {
      this.onScheduleByType[included].delete(type);
      this.holder.emit('schedule:exclude', included);
    }

    if (flag && par) {
      addToSet(this.onScheduleByType, type, par);
      console.log('schedule:include par=' + par + ' type=' + type);
      this.holder.emit('schedule:include', par);
    }
  }

  /**
   * Добавить новое устройство
   *
   * @param {*} doc - запись из таблицы
   * @param {*} dataObj - сохраненные значения динамических свойств
   * @param {*} chanObj - привязки к каналам из devhard
   * @param {*} devLogArr - массив для формирования журнала устройства
   */
  addDevice(doc, dataObj, chanObj) {
    if (doc.dn) {
      // this.devSet[doc._id] = new Devo(doc, this.typestore, this.agent, dataObj, chanObj);
      const devStruct = device_struct.create(doc, this.typeMap, dataObj, chanObj );
      this.devSet[doc._id] = new Devo(devStruct, this.typeMap, this.agent);
      this.dnSet[doc.dn] = this.devSet[doc._id]; // Объект устройства для обращения по dn, свойства плоские
    } else {
      console.log('WARN: devices._id = ' + doc._id + '. NO dn! SKIPPED doc: ' + util.inspect(doc));
    }
  }

  removeDevice(doc) {
    if (!doc || !doc._id) return;
    if (doc.dn) this.dnSet[doc.dn] = null;

    if (this.devSet[doc._id]) {
      delete this.devSet[doc._id];
    }
  }

  getDevice(did) {
    return this.devSet[did];
  }

  hasDevice(did) {
    return !!this.devSet[did];
  }

  setChannelLink(did, prop, upDoc) {
    if (!this.devSet[did]) return;

    this.devSet[did].setChannel(prop, upDoc);
  }

  clearChannelLink(did, prop) {
    if (!this.devSet[did]) return;
    this.devSet[did].clearChannel(prop);
  }

  // Изменили dn устройства
  changeDeviceDn(did, olddn, newdn) {
    if (this.devSet[did]) {
      this.devSet[did].dn = newdn;
      this.dnSet[newdn] = this.devSet[did];
    }
    this.dnSet[olddn] = null;
  }

  // Изменили тип устройства
  changeDeviceType(did, type, addProps, deleteProps) {
    console.log('WARN: deviceengine.changeDeviceType');
    if (this.devSet[did]) {
      this.devSet[did].changeType(type, addProps, deleteProps);
      this.changeWithRaw(did);
    }
  }

  // Изменился сам тип (набор свойств)
  changeDeviceProps(did, addProps, deleteProps) {
    if (this.devSet[did]) {
      this.devSet[did].changeTypeProps(addProps, deleteProps);
      // Пересчитать значения
      this.changeWithRaw(did);
    }
  }

  // Изменение других плоских полей, хранимых в devSet
  changeDeviceFields(did, chobj) {
    if (this.devSet[did]) this.devSet[did].changeFlatFields(chobj);
  }

  changeDeviceAux(did, auxArr) {
    if (this.devSet[did] && auxArr) {
      auxArr.forEach(item => {
        this.devSet[did].updateAux(item.prop, item.auxprop, item.val);
      });
      // изменились свойства - пересчитать значения
      this.changeWithRaw(did);
    }
  }

  changeWithRaw(did) {
    if (!this.devSet[did]) return;
    // Перепринять данные на базе значений raw
    const accepted = this.devSet[did].changeWithRaw();

    if (accepted.length) {
      this.agent.emitDeviceDataAccepted(accepted);
    }
  }

  // При сбросе привязки к каналу - сбросить значение на дефолтное
  resetValueWithDefault(did, prop) {
    if (!this.devSet[did]) return;
    this.holder.emit('received:device:data', { [did]: { [prop]: 0 } });
  }
}

// Private
function addToSet(obj, type, par) {
  if (!obj[par]) obj[par] = new Set();
  obj[par].add(type);
}

function removeFromAllSet(obj, type) {
  Object.keys(obj).forEach(par => {
    if (obj[par] && obj[par].has(type)) obj[par].delete(type);
  });
}

function getKeyOfSet(obj, type) {
  for (const key of Object.keys(obj)) {
    if (obj[key] && obj[key].has(type)) return key;
  }
}

module.exports = Deviceengine;

function wrapGlobal(glSet) {
  return new Proxy(
    {},
    {
      get(target, prop) {
        return glSet.getValue(prop);
      },

      set(target, prop, value) {
        glSet.setValue(prop, value, { src: 'device' });
        return true;
      }
    }
  );
}
