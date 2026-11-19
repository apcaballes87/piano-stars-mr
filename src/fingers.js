// Key presses from hand tracking: a fingertip that moves down quickly onto a key = a press.
// This works without the microphone, because we know where every key is.
import { FRONT_Z, WHITE_FRONT_DEPTH, BLACK_LEN, isBlack } from './layout.js';

const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const WINDOW = 0.2; // seconds of fingertip history
const DROP = 0.006; // the tip must go down this much (metres) in the window
const NEAR_TOP = 0.004; // and end lower than this above the key top
const REARM = 0.004; // lift this much to allow the next press

export class FingerKeys {
  constructor(stage, onPress) {
    this.stage = stage;
    this.onPress = onPress;
    this.state = new Map();
  }

  reset() {
    this.state.clear();
  }

  /** The key under a point in the keyboard frame, or -1. */
  keyAt(x, z) {
    const L = this.stage.layout;
    if (z > FRONT_Z + 0.012 || z < FRONT_Z - WHITE_FRONT_DEPTH - BLACK_LEN - 0.01) return -1;
    const guess = 48 + Math.round(x / (L.octave / 12));
    if (z < FRONT_Z - WHITE_FRONT_DEPTH + 0.004) {
      for (let m = guess - 2; m <= guess + 2; m++) {
        if (isBlack(m) && Math.abs(x - L.x(m)) <= L.blackW / 2 + 0.001) return m;
      }
    }
    for (let m = guess - 3; m <= guess + 3; m++) {
      if (!isBlack(m) && Math.abs(x - L.x(m)) <= L.white / 2) return m;
    }
    return -1;
  }

  /** hands: three.js hand groups (joints in world space). */
  update(hands, now) {
    const L = this.stage.layout;
    const content = this.stage.content;
    content.updateWorldMatrix(true, false);
    for (let h = 0; h < hands.length; h++) {
      const joints = hands[h].joints || {};
      for (const name of TIPS) {
        const id = h + ':' + name;
        let st = this.state.get(id);
        if (!st) {
          st = { hist: [], armed: true, minY: 0 };
          this.state.set(id, st);
        }
        const j = joints[name];
        if (!j || !j.visible) {
          st.hist.length = 0;
          st.armed = true;
          continue;
        }
        const p = content.worldToLocal(j.position.clone());
        const bottom = p.y - (j.jointRadius || 0.008);
        st.hist.push({ t: now, y: bottom });
        while (st.hist.length && now - st.hist[0].t > WINDOW) st.hist.shift();
        const key = this.keyAt(p.x, p.z);
        if (st.armed) {
          if (key < 0) continue;
          let maxY = -1;
          for (const e of st.hist) maxY = Math.max(maxY, e.y);
          if (bottom < L.topY(key) + NEAR_TOP && maxY - bottom > DROP) {
            st.armed = false;
            st.minY = bottom;
            this.onPress(key);
          }
        } else {
          st.minY = Math.min(st.minY, bottom);
          if (bottom > st.minY + REARM || key < 0) st.armed = true;
        }
      }
    }
  }
}
