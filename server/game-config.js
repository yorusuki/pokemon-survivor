'use strict';
function gameConfig(value = process.env.GAME_EVENT_BOOST_ENABLED || 'false') {
  if (!['true','false'].includes(value)) throw new Error('GAME_EVENT_BOOST_ENABLED 必須是 true 或 false');
  const enabled=value==='true';
  return { eventBoostEnabled:enabled, gachaRates:enabled?[[1,40],[2,30],[3,17],[4,6.5],[5,6.5]]:[[1,45],[2,30],[3,17],[4,6.5],[5,1.5]], wildShinyRate:1/(enabled?2048:4096),riftShinyRate:1/(enabled?40:512) };
}
module.exports={gameConfig};
