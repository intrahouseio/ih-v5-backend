/**
 *  Объект для формирования команд от сервера клиенту 
 * 
 */

module.exports = {

  /** gotoLayout
   * Формирует команду перехода на экран 
   * @param {String} layoutId 
   * @param {Object || Array of Objects} - frames
   *      Если приходит от команды Goto Layout - то массив 
   *          [{target_frame: {id: "frame_1"}, target_container_id: {id: "vc033"},device: {id: "d0081"}}
   *      Если приходит от скрипта (responder.gotoLayout) то объект
   *          {frame_1:{ }} 
   * 
   * @return {
   *    method: "servercommand", 
   *    command: "gotolayout", 
   *    id: "l011", 
   *    context:{ 
   *        frames:{ 
   *           frame_1:{container_id: "vc033", device:"d003"}  // device:"__device" ??
   *        }
   *     }
   *  }

        // target_container_id: "vc033"
        // target_frame: "frame_1"

   */
  gotoLayout(layoutId, frames) {
    const resObj = { method: 'servercommand', command: 'gotolayout', id: layoutId, context:{} };
    if (frames && typeof frames == 'object') {
      if (Array.isArray(frames)) {
        frames.forEach(item => {
          if (item.target_frame && item.target_frame.id && item.target_container_id && item.target_container_id.id) {
            if (!resObj.context.frames) resObj.context.frames = {};
            let device;
            if (item.device && item.device.id)  device = item.device.id;
            resObj.context.frames[item.target_frame.id] = {container_id: item.target_container_id.id, device};
          }
        })
      } else {
        Object.keys(frames).forEach(frame => {
          if (!resObj.context.frames) resObj.context.frames = {};
          resObj.context.frames[frame] = {container_id: frames[frame]};
        });
      }
    }
    return resObj;
  },

}

/*
command: "gotolayout"
context: {frames: {frame_1: {container_id: "vc033", device: "d0081"}}}
frames: {frame_1: {container_id: "vc033", device: "d0081"}}
frame_1: {container_id: "vc033", device: "d0081"}
container_id: "vc033"
device: "d0081"
id: "l011"
method: "servercommand"
uuid: "S2soXrI_ZWM"
*/