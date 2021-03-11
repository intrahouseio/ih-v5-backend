/**
 * Компонент формирует записи для логов -
 *  добавляет уникальные идентификаторы ts (tsid)
 *
 * Проблема - с одним ts м б несколько записей, но нужно использовать ts для сортировки и пагинации
 * При этом в Tingodb нет compound index!!
 * При записи в лог tsid - хранит ts записи (время в журнале)+ порядковый номер внутри ts
 *    tsid = '166674000000_00000'
 *
 */

const util = require('util');
// const shortid = require('shortid');

// const dbstore = require('./dbstore');

module.exports = {
  start(store) {
    this.store = store; // Для чтения из таблицы
    this.recMap = new Map(); // Временный Map
    this.last = {}; //
  },

  //
  async exec(logname, recs) {
    if (!recs || !recs.length) return;

    const now = Date.now();
    // группировать по ts
    try {
      this.recMap.clear();
      recs.forEach(rec => {
        let { ts, ...xdoc } = rec;
        if (!ts) ts = now;
        if (!this.recMap.has(ts)) {
          this.recMap.set(ts, [xdoc]);
        } else this.recMap.get(ts).push(xdoc);
      });

      let lastts = 0;
      let ats = 0;
      if (this.last[logname]) {
        lastts = this.last[logname].ts;
        ats = this.last[logname].ats;
      } else {
        this.last[logname] = {ts:0, ats:0};
      }
      let max_ts;
      let max_ats;

      const docs = []; // массив документов для записи в БД

      this.recMap.forEach((xdocs, xts) => {
        let a;
        if (xts > lastts) {
          // смело пишем новые записи с инкрементом ats с нуля
          a = 0;
        } else if (xts == lastts) {
          // берем ats из last
          a = ats;
        } else {
          // Самый плохой случай - xts < lastts - запись в прошлое
          // TODO нужно считать данные за xts и найти последнее зн-е ats
          a = ats;
        }
        xdocs.forEach(xdoc => {
          a++;
          docs.push({ tsid: String(xts) + '_' + String(a).padStart(5, '0'), ...xdoc });
        });
        if (xts >= lastts) {
          max_ts = xts;
          max_ats = a;
        }
      });

      // Заменить last
      if (max_ts) {
        this.last[logname].ts = max_ts;
        this.last[logname].ats = max_ats;
      }
      this.store.insert(logname, docs);
    } catch (e) {
      console.log('ERROR: logformer. Insert '+recs.length+' records: '+util.inspect(e));
    }
  }
};