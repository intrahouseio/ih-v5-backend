/**
 * Main ih-backend-d.
 *
 *  app.js
 */

const util = require('util');
const init = require('./lib/init');
const holder = require('./lib/holder');

init(__dirname)
  .then(() => {
    holder.start();
  })
  .then(() => {
    require('./lib/web/webserver').start(holder);
  })
  .catch(e => {
    console.log('ERR: FATAL ERROR. ' + util.inspect(e));
    setTimeout(() => {
      process.exit();
    }, 500);
  });

  process.on('exit', () => {
    if (holder) holder.emit('finish');
  });

  process.on('SIGINT', () => {
    process.exit(0);
  });

  process.on('uncaughtException', err => {
    console.log('ERR: uncaughtException ' + util.inspect(err));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.log('ERR: Unhandled Rejection at:', promise, 'reason:', reason);
  });