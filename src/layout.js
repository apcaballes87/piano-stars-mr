// Where each piano key is, in the "keyboard frame".
// Origin: the top of the C3 key (one octave below Middle C), at the point the user touched.
// x: to the right (higher notes). y: up. z: toward the player.

export const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const WHITE_IDX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

export const NOMINAL_OCTAVE = 0.1645; // 7 white keys of a normal piano, in metres
export const FRONT_Z = 0.015; // front edge of the white keys (the user touches a bit behind it)
export const WHITE_FRONT_DEPTH = 0.05; // the part of a white key in front of the black keys
export const BLACK_LEN = 0.095;
export const BLACK_H = 0.012; // a black key top is this much higher than a white key top
export const CAL_LOW = 48; // C3
export const CAL_HIGH = 72; // C5

export function isBlack(m) {
  return BLACK[((m % 12) + 12) % 12];
}

export class KeyLayout {
  constructor(octave = NOMINAL_OCTAVE) {
    this.setOctave(octave);
  }

  setOctave(o) {
    this.octave = o;
    this.white = o / 7;
    this.blackW = this.white * 0.58;
  }

  /** x of the key centre, relative to the C3 key centre. */
  x(m) {
    const oct = Math.floor((m - 48) / 12);
    const pc = ((m % 12) + 12) % 12;
    if (!BLACK[pc]) {
      return oct * this.octave + WHITE_IDX[pc] * this.white;
    }
    // Black keys sit on an even 12-step grid across the octave.
    return -this.white / 2 + oct * this.octave + (pc + 0.5) * this.octave / 12;
  }

  topY(m) {
    return isBlack(m) ? BLACK_H : 0;
  }

  /** z where a falling block lands (the part of the key a finger presses). */
  landZ(m) {
    return isBlack(m) ? FRONT_Z - WHITE_FRONT_DEPTH - 0.035 : FRONT_Z - 0.025;
  }

  keyW(m) {
    return isBlack(m) ? this.blackW : this.white;
  }

  /** The front-to-back span of the key part we light up: [zFront, zBack]. */
  lightZ(m) {
    return isBlack(m)
      ? [FRONT_Z - WHITE_FRONT_DEPTH, FRONT_Z - WHITE_FRONT_DEPTH - BLACK_LEN]
      : [FRONT_Z, FRONT_Z - WHITE_FRONT_DEPTH];
  }

  /** Left and right x of a range of keys (outer edges). */
  span(lo, hi) {
    return [this.x(lo) - this.keyW(lo) / 2, this.x(hi) + this.keyW(hi) / 2];
  }
}
