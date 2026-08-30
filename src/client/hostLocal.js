// ============================================================
// 单机宿主:浏览器内嵌同一份 shared/sim.js,零延迟直通
// ============================================================
import { createGame } from "/src/shared/sim.js";

const FIXED_DT = 1 / 60;

export function createLocalHost(difficulty) {
  const sim = createGame({ humans: [0], aiTeams: [1, 2], difficulty });
  let acc = 0;
  return {
    mode: "local",
    myTeam: 0,
    netDifficulty: null,
    sim,
    update(dt, playing) {
      if (!playing) return [];
      acc += Math.min(dt, 0.1);
      let guard = 0;
      while (acc >= FIXED_DT && guard < 6) { sim.step(FIXED_DT); acc -= FIXED_DT; guard++; }
      return sim.collectEvents();
    },
    submit(cmd) { sim.applyCommand(0, cmd); },
    flush() {},
  };
}
