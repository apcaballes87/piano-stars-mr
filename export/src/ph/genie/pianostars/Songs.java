package ph.genie.pianostars;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The song book. All melodies are traditional or public domain.
 * Each song has a key and a time signature, so the app can make a left-hand part.
 */
public final class Songs {

    public static final int EASY = 0;
    public static final int MEDIUM = 1;
    public static final int ADVANCED = 2;
    public static final String[] LEVEL_NAMES = {"Easy", "Medium", "Advanced"};

    public static final class Note {
        public final int midi;
        public final double beat;
        public final double len;
        public final boolean left;

        Note(int midi, double beat, double len, boolean left) {
            this.midi = midi;
            this.beat = beat;
            this.len = len;
            this.left = left;
        }
    }

    public static final class Song {
        public final String id;
        public final String title;
        public final int level;
        public final int bpm;
        public final int keyPc;
        public final boolean minor;
        public final double barBeats;
        public final double pickup;
        public final List<Note> notes;
        public boolean custom;
        public boolean full;
        private List<Note> leftCache;

        Song(String id, String title, int level, int bpm, String key, double barBeats, double pickup,
             List<Note> notes, List<Note> left) {
            this(id, title, level, bpm, key, barBeats, pickup, notes);
            if (left != null && !left.isEmpty()) {
                leftCache = Collections.unmodifiableList(new ArrayList<>(left));
            }
        }

        Song(String id, String title, int level, int bpm, String key, double barBeats, double pickup,
             List<Note> notes) {
            this.id = id;
            this.title = title;
            this.level = level;
            this.bpm = bpm;
            this.minor = key.endsWith("m");
            this.keyPc = Math.floorMod(parse(key.replace("m", "") + "4"), 12);
            this.barBeats = barBeats;
            this.pickup = pickup;
            this.notes = notes;
        }

        public double lengthBeats() {
            double end = 0;
            for (Note n : notes) {
                end = Math.max(end, n.beat + n.len);
            }
            return end;
        }

        /** Melody and (optional) left hand, in time order. */
        public List<Note> parts(boolean twoHands) {
            List<Note> all = new ArrayList<>(notes);
            if (twoHands) {
                all.addAll(leftHand());
            }
            Collections.sort(all, (a, b) -> a.beat != b.beat ? Double.compare(a.beat, b.beat)
                    : Integer.compare(a.midi, b.midi));
            return all;
        }

        /** First white key of the 2-octave (14 white keys) window for one-hand play. */
        public int windowLow() {
            if (notes.isEmpty()) {
                return 60;
            }
            int lo = 127;
            int hi = 0;
            for (Note n : notes) {
                lo = Math.min(lo, n.midi);
                hi = Math.max(hi, n.midi);
            }
            int best = (lo / 12) * 12;
            int bestCount = -1;
            for (int start = Math.max(0, lo - 23); start <= hi; start++) {
                if (!isWhite(start)) {
                    continue;
                }
                int top = nthWhite(start, 13);
                int count = 0;
                for (Note n : notes) {
                    if (n.midi >= start && n.midi <= top) {
                        count++;
                    }
                }
                boolean better = count > bestCount
                        || (count == bestCount && start % 12 == 0 && best % 12 != 0);
                if (better) {
                    bestCount = count;
                    best = start;
                }
            }
            return best;
        }

        /** A simple left-hand part made from the melody: one chord per bar. */
        public synchronized List<Note> leftHand() {
            if (leftCache != null) {
                return leftCache;
            }
            List<Note> out = new ArrayList<>();
            double total = lengthBeats();
            int minMel = 127;
            for (Note n : notes) {
                minMel = Math.min(minMel, n.midi);
            }
            int base = minMel >= 60 ? 48 : 36; // C3 or C2
            int[] offs = minor ? new int[]{0, 5, 7, 8, 3, 10} : new int[]{0, 5, 7, 9, 2};
            boolean[] minQ = minor ? new boolean[]{true, true, false, false, false, false}
                    : new boolean[]{false, false, false, true, true};
            double[] prior = minor ? new double[]{0.4, 0.2, 0.3, 0.1, 0.05, 0.05}
                    : new double[]{0.4, 0.2, 0.3, 0.05, 0.05};
            for (double bs = pickup; bs < total - 1e-6; bs += barBeats) {
                double be = Math.min(bs + barBeats, total);
                boolean last = be >= total - 1e-6;
                int best = 0;
                double bestScore = -1e9;
                for (int c = 0; c < offs.length; c++) {
                    int root = (keyPc + offs[c]) % 12;
                    int third = (root + (minQ[c] ? 3 : 4)) % 12;
                    int fifth = (root + 7) % 12;
                    double s = prior[c];
                    for (Note n : notes) {
                        double ov = Math.min(n.beat + n.len, be) - Math.max(n.beat, bs);
                        if (ov <= 0) {
                            continue;
                        }
                        double w = ov * (Math.abs(n.beat - bs) < 1e-6 ? 2 : 1);
                        int pc = n.midi % 12;
                        if (pc == root) {
                            s += 1.3 * w;
                        } else if (pc == third || pc == fifth) {
                            s += w;
                        } else {
                            s -= 0.3 * w;
                        }
                    }
                    if (s > bestScore) {
                        bestScore = s;
                        best = c;
                    }
                }
                if (last) {
                    best = 0;
                }
                int r = base + (keyPc + offs[best]) % 12;
                int thirdUp = r + (minQ[best] ? 3 : 4) + 12;
                double len = be - bs;
                if (level == EASY) {
                    add(out, r, bs, len, be);
                } else if (level == MEDIUM) {
                    boolean triple = Math.abs(barBeats - 3) < 1e-6 || Math.abs(barBeats - 4.5) < 1e-6;
                    if (triple) {
                        double u = barBeats / 3;
                        add(out, r, bs, u, be);
                        add(out, r + 7, bs + u, u, be);
                        add(out, r + 7, bs + 2 * u, u, be);
                    } else {
                        double half = barBeats / 2;
                        add(out, r, bs, half, be);
                        add(out, r + 7, bs + half, half, be);
                    }
                } else {
                    double step = Math.abs(barBeats - 4.5) < 1e-6 ? 1.5 : 1.0;
                    int[] pat = {r, r + 7, thirdUp, r + 7};
                    int i = 0;
                    for (double t = bs; t < be - 1e-6; t += step) {
                        add(out, pat[i % 4], t, step, be);
                        i++;
                    }
                }
            }
            leftCache = Collections.unmodifiableList(out);
            return leftCache;
        }

        private void add(List<Note> out, int midi, double start, double len, double barEnd) {
            if (start >= barEnd - 1e-6) {
                return;
            }
            int minMel = 127;
            for (Note n : notes) {
                minMel = Math.min(minMel, n.midi);
            }
            while (midi >= minMel && midi - 12 >= 36) {
                midi -= 12;
            }
            double l = Math.min(len, barEnd - start);
            if (l >= 0.2) {
                out.add(new Note(midi, start, l, true));
            }
        }
    }

    // ------------------------------------------------------------------ data

    private static final String ODE_A =
            "E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2 ";
    private static final String ODE_A2 =
            "E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2 ";
    private static final String ODE_B =
            "D4:1 D4:1 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 D4:1 C4:1 D4:1 G3:2 ";
    private static final String MINUET_A =
            "D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5:1 G4:1 G4:1 "
            + "E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5:1 G4:1 G4:1 "
            + "C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 ";
    private static final String ELISE_A =
            "E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1.5 "
            + "C4:0.5 E4:0.5 A4:0.5 B4:1.5 E4:0.5 G#4:0.5 B4:0.5 C5:1.5 ";
    private static final String BUMBLE_RUN =
            "E5 D#5 D5 C#5 D5 C#5 C5 B4 C5 B4 A#4 A4 G#4 G4 F#4 F4 ";

    public static final List<Song> ALL = Collections.synchronizedList(new ArrayList<>());
    private static boolean loaded;

    static {
        List<Song> s = new ArrayList<>();

        // ================= EASY =================
        s.add(song("hcb", "Hot Cross Buns", EASY, 90, "C", 4, 0,
                "E4:1 D4:1 C4:2 E4:1 D4:1 C4:2 C4:0.5 C4:0.5 C4:0.5 C4:0.5 "
                + "D4:0.5 D4:0.5 D4:0.5 D4:0.5 E4:1 D4:1 C4:2"));
        s.add(song("mary", "Mary Had a Little Lamb", EASY, 100, "C", 4, 0,
                "E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 D4:1 D4:1 D4:2 E4:1 G4:1 G4:2 "
                + "E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:1 E4:1 D4:1 D4:1 E4:1 D4:1 C4:4"));
        s.add(song("twinkle", "Twinkle Twinkle Little Star", EASY, 100, "C", 4, 0,
                "C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 "
                + "G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 "
                + "C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2"));
        s.add(song("row", "Row Row Row Your Boat", EASY, 90, "C", 3, 0,
                "C4:1.5 C4:1.5 C4:1 D4:0.5 E4:1.5 E4:1 D4:0.5 E4:1 F4:0.5 G4:3 "
                + "C5:0.5 C5:0.5 C5:0.5 G4:0.5 G4:0.5 G4:0.5 E4:0.5 E4:0.5 E4:0.5 "
                + "C4:0.5 C4:0.5 C4:0.5 G4:1 F4:0.5 E4:1 D4:0.5 C4:3"));
        s.add(song("london", "London Bridge", EASY, 100, "C", 4, 0,
                "G4:1.5 A4:0.5 G4:1 F4:1 E4:1 F4:1 G4:2 D4:1 E4:1 F4:2 E4:1 F4:1 G4:2 "
                + "G4:1.5 A4:0.5 G4:1 F4:1 E4:1 F4:1 G4:2 D4:2 G4:2 E4:1 C4:3"));
        s.add(song("frere", "Frère Jacques", EASY, 100, "C", 4, 0,
                "C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 F4:1 G4:2 E4:1 F4:1 G4:2 "
                + "G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 "
                + "C4:1 G3:1 C4:2 C4:1 G3:1 C4:2"));
        s.add(song("auclair", "Au Clair de la Lune", EASY, 90, "C", 4, 0,
                "C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 "
                + "C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 "
                + "D4:1 D4:1 D4:1 D4:1 A3:2 A3:2 D4:1 C4:1 B3:1 A3:1 G3:4 "
                + "C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4"));
        s.add(song("lightly", "Lightly Row", EASY, 100, "C", 4, 0,
                "G4:1 E4:1 E4:2 F4:1 D4:1 D4:2 C4:1 D4:1 E4:1 F4:1 G4:1 G4:1 G4:2 "
                + "G4:1 E4:1 E4:2 F4:1 D4:1 D4:2 C4:1 E4:1 G4:1 G4:1 C4:4 "
                + "D4:1 D4:1 D4:1 D4:1 D4:1 E4:1 F4:2 E4:1 E4:1 E4:1 E4:1 E4:1 F4:1 G4:2 "
                + "G4:1 E4:1 E4:2 F4:1 D4:1 D4:2 C4:1 E4:1 G4:1 G4:1 C4:4"));
        s.add(song("rain", "Rain Rain Go Away", EASY, 100, "C", 4, 0,
                "G4:1 E4:1 G4:0.5 G4:0.5 E4:1 G4:0.5 G4:0.5 E4:0.5 A4:0.5 G4:0.5 G4:0.5 E4:1 "
                + "G4:1 E4:1 G4:0.5 G4:0.5 E4:1 G4:0.5 G4:0.5 E4:0.5 A4:0.5 G4:0.5 G4:0.5 E4:1"));
        s.add(song("oldman", "This Old Man", EASY, 110, "C", 4, 0,
                "G4:1 E4:1 G4:2 G4:1 E4:1 G4:2 A4:1 G4:1 F4:1 E4:1 D4:1 E4:1 F4:2 "
                + "E4:0.5 F4:0.5 G4:1 C4:1 C4:0.5 C4:0.5 C4:0.5 D4:0.5 E4:0.5 F4:0.5 G4:2 "
                + "G4:1 D4:1 D4:1 F4:1 E4:1 D4:1 C4:2"));
        s.add(song("rhody", "Go Tell Aunt Rhody", EASY, 100, "C", 4, 0,
                "E4:2 E4:1 D4:1 C4:2 C4:2 D4:2 D4:1 F4:1 E4:1 D4:1 C4:2 "
                + "G4:2 G4:1 F4:1 E4:2 E4:2 D4:1 C4:1 D4:1 E4:1 C4:4"));
        s.add(song("skiplou", "Skip to My Lou", EASY, 110, "C", 4, 0,
                "E4:1 E4:1 C4:1 C4:1 E4:1 E4:1 G4:2 D4:1 D4:1 B3:1 B3:1 D4:1 D4:1 F4:2 "
                + "E4:1 E4:1 C4:1 C4:1 E4:1 E4:1 G4:2 D4:1 E4:1 F4:1 D4:1 C4:4"));
        s.add(song("yankee", "Yankee Doodle", EASY, 110, "C", 4, 0,
                "C4:0.5 C4:0.5 D4:0.5 E4:0.5 C4:0.5 E4:0.5 D4:0.5 G3:0.5 "
                + "C4:0.5 C4:0.5 D4:0.5 E4:0.5 C4:1 B3:1 "
                + "C4:0.5 C4:0.5 D4:0.5 E4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:0.5 "
                + "B3:0.5 G3:0.5 A3:0.5 B3:0.5 C4:1 C4:1 "
                + "A3:0.75 B3:0.25 A3:0.5 G3:0.5 A3:0.5 B3:0.5 C4:1 G3:0.75 A3:0.25 G3:0.5 F3:0.5 E3:1 G3:1 "
                + "A3:0.75 B3:0.25 A3:0.5 G3:0.5 A3:0.5 B3:0.5 C4:0.5 A3:0.5 "
                + "G3:0.5 C4:0.5 B3:0.5 D4:0.5 C4:1 C4:1"));
        s.add(song("weasel", "Pop Goes the Weasel", EASY, 100, "C", 3, 0,
                "C4:1 C4:0.5 D4:1 D4:0.5 E4:0.5 G4:0.5 E4:0.5 C4:1 G3:0.5 "
                + "C4:1 C4:0.5 D4:1 D4:0.5 E4:1.5 C4:1 G3:0.5 "
                + "C4:1 C4:0.5 D4:1 D4:0.5 E4:0.5 G4:0.5 E4:0.5 C4:1.5 "
                + "A4:1.5 D4:1 F4:0.5 E4:1.5 C4:1.5"));
        s.add(song("wheels", "The Wheels on the Bus", EASY, 110, "F", 4, 1,
                "C4:1 F4:1 F4:0.5 F4:0.5 F4:1 A4:1 C5:1 A4:1 F4:2 G4:1 E4:1 C4:2 "
                + "C5:1 A4:1 F4:1 C4:1 F4:1 F4:0.5 F4:0.5 F4:1 A4:1 C5:1 A4:1 F4:2 "
                + "G4:2 C4:2 F4:3"));
        s.add(song("kumbaya", "Kumbaya", EASY, 90, "C", 4, 0,
                "C4:1 E4:1 G4:2 G4:2 G4:2 A4:1 A4:1 G4:4 C4:1 E4:1 G4:2 G4:2 G4:2 F4:1 E4:1 D4:4 "
                + "C4:1 E4:1 G4:2 G4:2 G4:2 A4:1 A4:1 G4:4 F4:2 E4:2 E4:2 D4:2 D4:2 C4:4"));
        s.add(song("saints", "When the Saints Go Marching In", EASY, 120, "C", 4, 3,
                "C4:1 E4:1 F4:1 G4:5 C4:1 E4:1 F4:1 G4:5 C4:1 E4:1 F4:1 G4:2 E4:2 C4:2 E4:2 D4:5 "
                + "E4:1 E4:1 D4:1 C4:3 C4:1 E4:2 G4:2 G4:1 F4:4 "
                + "E4:1 F4:1 G4:2 E4:2 C4:2 D4:2 C4:4"));
        s.add(song("wewish", "We Wish You a Merry Christmas", EASY, 110, "C", 3, 1,
                "G3:1 C4:1 C4:0.5 D4:0.5 C4:0.5 B3:0.5 A3:1 A3:1 A3:1 "
                + "D4:1 D4:0.5 E4:0.5 D4:0.5 C4:0.5 B3:1 G3:1 G3:1 "
                + "E4:1 E4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:1 A3:1 G3:0.5 G3:0.5 A3:1 D4:1 B3:1 C4:2"));
        s.add(song("wenceslas", "Good King Wenceslas", EASY, 100, "C", 4, 0,
                "C4:1 C4:1 C4:1 D4:1 C4:1 C4:1 G3:2 A3:1 G3:1 A3:1 B3:1 C4:2 C4:2 "
                + "C4:1 C4:1 C4:1 D4:1 C4:1 C4:1 G3:2 A3:1 G3:1 A3:1 B3:1 C4:2 C4:2 "
                + "G4:1 F4:1 E4:1 D4:1 E4:1 D4:1 C4:2 A3:1 G3:1 A3:1 B3:1 C4:2 C4:2 "
                + "G3:1 G3:1 A3:1 B3:1 C4:1 C4:1 D4:2 G4:1 F4:1 E4:1 D4:1 C4:2 F4:2 C4:4"));
        s.add(song("amazing", "Amazing Grace", EASY, 80, "C", 3, 1,
                "G3:1 C4:2 E4:0.5 C4:0.5 E4:2 D4:1 C4:2 A3:1 G3:2 G3:1 "
                + "C4:2 E4:0.5 C4:0.5 E4:2 D4:1 G4:5 E4:1 "
                + "G4:2 E4:0.5 G4:0.5 E4:2 C4:1 G3:2 A3:0.5 C4:0.5 C4:0.5 A3:0.5 G3:2 G3:1 "
                + "C4:2 E4:0.5 C4:0.5 E4:2 D4:1 C4:5"));
        s.add(song("clementine", "Oh My Darling Clementine", EASY, 100, "C", 3, 1,
                "C4:0.75 C4:0.25 C4:1 G3:1 E4:0.75 E4:0.25 E4:1 C4:1 C4:0.75 E4:0.25 "
                + "G4:1.5 G4:0.5 F4:0.5 E4:0.5 D4:2 D4:0.75 E4:0.25 "
                + "F4:1 F4:1 E4:0.75 D4:0.25 E4:1 C4:1 C4:0.75 E4:0.25 "
                + "D4:1.5 G3:0.5 B3:0.5 D4:0.5 C4:2"));
        s.add(song("michael", "Michael Row the Boat Ashore", EASY, 90, "C", 4, 0,
                "C4:1 E4:1 G4:2 E4:1 G4:1 A4:2 G4:4 E4:1 G4:1 A4:4 G4:4 "
                + "E4:1 G4:1 G4:2 E4:1 F4:1 E4:2 D4:4 C4:1 D4:1 E4:2 D4:1 C4:1 D4:2 C4:4"));
        s.add(song("auralee", "Aura Lee", EASY, 80, "C", 4, 0,
                "G3:1 C4:1 B3:1 C4:1 D4:1 A3:1 D4:2 C4:1 B3:1 A3:1 B3:1 C4:4 "
                + "G3:1 C4:1 B3:1 C4:1 D4:1 A3:1 D4:2 C4:1 B3:1 A3:1 B3:1 C4:4 "
                + "E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 D4:1 C4:1 D4:1 E4:4 "
                + "E4:1 E4:1 F4:1 E4:1 D4:1 A3:1 D4:2 C4:1 B3:1 A3:1 B3:1 C4:4"));
        s.add(song("susanna", "Oh! Susanna", EASY, 110, "C", 4, 1,
                "C4:0.5 D4:0.5 E4:1 G4:1 G4:1.5 A4:0.5 G4:1 E4:1 C4:1.5 D4:0.5 "
                + "E4:1 E4:1 D4:1 C4:1 D4:3 C4:0.5 D4:0.5 "
                + "E4:1 G4:1 G4:1.5 A4:0.5 G4:1 E4:1 C4:1.5 D4:0.5 E4:1 E4:1 D4:1 D4:1 C4:4"));
        s.add(song("bingo", "Bingo", EASY, 110, "C", 4, 1,
                "G3:1 C4:1 C4:1 G3:1 G3:1 A3:1 A3:1 G3:2 G3:1 C4:1 C4:1 D4:1 D4:1 E4:2 C4:2 "
                + "E4:2 E4:2 F4:4 D4:2 D4:2 E4:4 C4:2 C4:2 D4:2 D4:2 "
                + "B3:1 G3:1 A3:1 B3:1 C4:2 C4:2"));

        // ================= MEDIUM =================
        s.add(song("ode", "Ode to Joy", MEDIUM, 100, "C", 4, 0, ODE_A + ODE_A2));
        s.add(song("jingle", "Jingle Bells", MEDIUM, 110, "C", 4, 0,
                "E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4 "
                + "F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 "
                + "E4:1 D4:1 D4:1 E4:1 D4:2 G4:2 "
                + "E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4 "
                + "F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 "
                + "G4:1 G4:1 F4:1 D4:1 C4:4"));
        s.add(song("bday", "Happy Birthday", MEDIUM, 90, "C", 3, 1,
                "G3:0.75 G3:0.25 A3:1 G3:1 C4:1 B3:2 G3:0.75 G3:0.25 A3:1 G3:1 D4:1 C4:2 "
                + "G3:0.75 G3:0.25 G4:1 E4:1 C4:1 B3:1 A3:2 F4:0.75 F4:0.25 E4:1 C4:1 D4:1 C4:3"));
        s.add(song("oldmac", "Old MacDonald", MEDIUM, 110, "C", 4, 0,
                "C4:1 C4:1 C4:1 G3:1 A3:1 A3:1 G3:2 E4:1 E4:1 D4:1 D4:1 C4:3 G3:1 "
                + "C4:1 C4:1 C4:1 G3:1 A3:1 A3:1 G3:2 E4:1 E4:1 D4:1 D4:1 C4:4"));
        s.add(song("silent", "Silent Night", MEDIUM, 80, "C", 3, 0,
                "G4:1.5 A4:0.5 G4:1 E4:3 G4:1.5 A4:0.5 G4:1 E4:3 D5:2 D5:1 B4:3 C5:2 C5:1 G4:3 "
                + "A4:2 A4:1 C5:1.5 B4:0.5 A4:1 G4:1.5 A4:0.5 G4:1 E4:3 "
                + "A4:2 A4:1 C5:1.5 B4:0.5 A4:1 G4:1.5 A4:0.5 G4:1 E4:3 "
                + "D5:2 D5:1 F5:1.5 D5:0.5 B4:1 C5:3 E5:3 C5:1 G4:1 E4:1 G4:1.5 F4:0.5 D4:1 C4:6"));
        s.add(song("deck", "Deck the Halls", MEDIUM, 110, "C", 4, 0,
                "G4:1.5 F4:0.5 E4:1 D4:1 C4:1 D4:1 E4:1 C4:1 "
                + "D4:0.5 E4:0.5 F4:0.5 D4:0.5 E4:1.5 D4:0.5 C4:1 B3:1 C4:2 "
                + "G4:1.5 F4:0.5 E4:1 D4:1 C4:1 D4:1 E4:1 C4:1 "
                + "D4:0.5 E4:0.5 F4:0.5 D4:0.5 E4:1.5 D4:0.5 C4:1 B3:1 C4:2 "
                + "D4:1.5 E4:0.5 F4:1 D4:1 E4:1.5 F4:0.5 G4:1 D4:1 "
                + "E4:0.5 F#4:0.5 G4:1 A4:0.5 B4:0.5 C5:1 B4:1 A4:1 G4:2 "
                + "G4:1.5 F4:0.5 E4:1 D4:1 C4:1 D4:1 E4:1 C4:1 "
                + "A4:0.5 A4:0.5 A4:0.5 A4:0.5 G4:1.5 F4:0.5 E4:1 D4:1 C4:2"));
        s.add(song("joy", "Joy to the World", MEDIUM, 90, "C", 4, 0,
                "C5:2 B4:1.5 A4:0.5 G4:3 F4:1 E4:2 D4:2 C4:3 G4:1 A4:3 A4:1 B4:3 B4:1 C5:7 "
                + "C5:1 C5:1 B4:1 A4:1 G4:1 G4:1.5 F4:0.5 E4:1 "
                + "C5:1 C5:1 B4:1 A4:1 G4:1 G4:1.5 F4:0.5 E4:1 "
                + "E4:1 E4:1 E4:1 E4:1 E4:0.5 F4:0.5 G4:3 F4:0.5 E4:0.5 "
                + "D4:1 D4:1 D4:1 D4:0.5 E4:0.5 F4:3 E4:0.5 D4:0.5 "
                + "C4:1 C5:2 A4:1 G4:1.5 F4:0.5 E4:1 F4:1 E4:2 D4:2 C4:4"));
        s.add(song("brahms", "Brahms' Lullaby", MEDIUM, 80, "C", 3, 1,
                "E4:0.5 E4:0.5 G4:2 E4:0.5 E4:0.5 G4:2 E4:0.5 G4:0.5 C5:1 B4:1.5 A4:0.5 A4:1 G4:1 "
                + "D4:0.5 E4:0.5 F4:1 D4:1 D4:0.5 E4:0.5 F4:2 D4:0.5 F4:0.5 B4:0.5 A4:0.5 G4:1 B4:1 C5:2 "
                + "C4:0.5 C4:0.5 C5:2 A4:0.5 F4:0.5 G4:2 E4:0.5 C4:0.5 F4:1 G4:1 A4:1 G4:2 "
                + "C4:0.5 C4:0.5 C5:2 A4:0.5 F4:0.5 G4:2 E4:0.5 C4:0.5 F4:1 E4:1 D4:1 C4:3"));
        s.add(song("auld", "Auld Lang Syne", MEDIUM, 90, "C", 4, 1,
                "G3:1 C4:1.5 C4:0.5 C4:1 E4:1 D4:1.5 C4:0.5 D4:1 E4:0.5 D4:0.5 "
                + "C4:1.5 C4:0.5 E4:1 G4:1 A4:3 A4:1 "
                + "G4:1.5 E4:0.5 E4:1 C4:1 D4:1.5 C4:0.5 D4:1 E4:0.5 D4:0.5 "
                + "C4:1.5 A3:0.5 A3:1 G3:1 C4:3"));
        s.add(song("morning", "Morning Mood (Grieg)", MEDIUM, 70, "C", 3, 0,
                "G4:0.5 E4:0.5 D4:0.5 C4:0.5 D4:0.5 E4:0.5 "
                + "G4:0.5 E4:0.5 D4:0.5 C4:0.5 D4:0.25 E4:0.25 D4:0.25 E4:0.25 "
                + "G4:0.5 E4:0.5 G4:0.5 A4:0.5 E4:0.5 A4:0.5 G4:0.5 E4:0.5 D4:0.5 C4:1.5 "
                + "G4:0.5 E4:0.5 D4:0.5 C4:0.5 D4:0.5 E4:0.5 "
                + "G4:0.5 E4:0.5 D4:0.5 C4:0.5 D4:0.25 E4:0.25 D4:0.25 E4:0.25 "
                + "G4:0.5 E4:0.5 G4:0.5 A4:0.5 E4:0.5 A4:0.5 G4:0.5 E4:0.5 D4:0.5 C4:1.5"));
        s.add(song("bridal", "Bridal Chorus (Wagner)", MEDIUM, 80, "F", 4, 1,
                "C4:1 F4:0.75 F4:0.25 F4:2 C4:1 G4:0.75 E4:0.25 F4:2 C4:1 "
                + "F4:0.75 Bb4:0.25 Bb4:1 A4:0.75 G4:0.25 F4:1 E4:0.75 F4:0.25 G4:3 "
                + "C4:1 F4:0.75 F4:0.25 F4:2 C4:1 G4:0.75 E4:0.25 F4:2 C4:1 "
                + "F4:0.75 Bb4:0.25 Bb4:1 A4:0.75 G4:0.25 F4:1 E4:0.75 G4:0.25 F4:3"));
        s.add(song("sakura", "Sakura Sakura", MEDIUM, 70, "Am", 4, 0,
                "A4:1 A4:1 B4:2 A4:1 A4:1 B4:2 A4:1 B4:1 C5:1 B4:1 A4:1 B4:0.5 A4:0.5 F4:2 "
                + "E4:1 C4:1 E4:1 F4:1 E4:1 E4:0.5 C4:0.5 B3:2 "
                + "A4:1 B4:1 C5:1 B4:1 A4:1 B4:0.5 A4:0.5 F4:2 "
                + "E4:1 C4:1 E4:1 F4:1 E4:1 E4:0.5 C4:0.5 B3:2 "
                + "A4:1 A4:1 B4:2 A4:1 A4:1 B4:2 E4:1 F4:1 B4:0.5 A4:0.5 F4:1 E4:4"));
        s.add(song("largo", "Goin' Home (Dvořák)", MEDIUM, 60, "C", 4, 0,
                "E4:1.5 G4:0.5 G4:2 E4:1.5 D4:0.5 C4:2 D4:1 E4:1 G4:1 E4:1 D4:4 "
                + "E4:1.5 G4:0.5 G4:2 E4:1.5 D4:0.5 C4:2 D4:1 E4:1 D4:1 C4:1 C4:4"));
        s.add(song("cucaracha", "La Cucaracha", MEDIUM, 120, "F", 4, 0,
                "C4:0.5 C4:0.5 C4:0.5 F4:1.5 A4:1 C4:0.5 C4:0.5 C4:0.5 F4:1.5 A4:1 "
                + "F4:1 F4:0.5 E4:0.5 E4:0.5 D4:0.5 D4:0.5 C4:2.5 "
                + "C4:0.5 C4:0.5 C4:0.5 E4:1.5 G4:1 C4:0.5 C4:0.5 C4:0.5 E4:1.5 G4:1 "
                + "C5:1 D5:0.5 C5:0.5 Bb4:0.5 A4:0.5 G4:0.5 F4:2.5"));
        s.add(song("godrest", "God Rest Ye Merry Gentlemen", MEDIUM, 100, "Em", 4, 0,
                "E4:1 E4:1 B4:1 B4:1 A4:1 G4:1 F#4:1 E4:1 D4:1 E4:1 F#4:1 G4:1 A4:1 B4:3 "
                + "E4:1 E4:1 B4:1 B4:1 A4:1 G4:1 F#4:1 E4:1 D4:1 E4:1 F#4:1 G4:1 A4:1 B4:3"));
        s.add(song("hark", "Hark! The Herald Angels Sing", MEDIUM, 100, "F", 4, 0,
                "C4:1 F4:1 F4:1.5 E4:0.5 F4:1 A4:1 A4:1 G4:1 "
                + "C5:1 C5:1 C5:1.5 Bb4:0.5 A4:1 G4:1 A4:2 "
                + "C4:1 F4:1 F4:1.5 E4:0.5 F4:1 A4:1 A4:1 G4:1 "
                + "C5:1 G4:1 G4:1.5 E4:0.5 E4:1 D4:1 C4:2"));
        s.add(song("adeste", "O Come All Ye Faithful", MEDIUM, 90, "G", 4, 0,
                "G4:1 G4:2 D4:1 G4:1 A4:2 D4:2 B4:1 A4:1 B4:1 C5:1 B4:2 A4:1 G4:1 "
                + "G4:2 F#4:1 E4:1 F#4:1 G4:1 A4:1 B4:1 F#4:2 E4:1.5 D4:0.5 D4:4"));
        s.add(song("noel", "The First Noel", MEDIUM, 100, "C", 3, 1,
                "E4:0.5 D4:0.5 C4:1.5 D4:0.5 E4:0.5 F4:0.5 G4:2 A4:0.5 B4:0.5 C5:1 B4:1 A4:1 G4:2 "
                + "A4:0.5 B4:0.5 C5:1 B4:1 A4:1 G4:1 A4:1 B4:1 C5:1 G4:1 F4:1 E4:2 "
                + "E4:0.5 D4:0.5 C4:1.5 D4:0.5 E4:0.5 F4:0.5 G4:2 C5:0.5 B4:0.5 A4:2 A4:1 G4:3 "
                + "C5:1 B4:1 A4:1 G4:1 A4:1 B4:1 C5:1 G4:1 F4:1 E4:2"));
        s.add(song("chimes", "Westminster Chimes", MEDIUM, 60, "C", 4, 0,
                "E4:1 C4:1 D4:1 G3:1 G3:1 D4:1 E4:1 C4:1 E4:1 D4:1 C4:1 G3:1 G3:1 D4:1 E4:1 C4:1"));
        s.add(song("fifth", "Symphony No. 5 (Beethoven)", MEDIUM, 108, "Cm", 2, 0,
                "R:0.5 G4:0.5 G4:0.5 G4:0.5 Eb4:2 R:0.5 F4:0.5 F4:0.5 F4:0.5 D4:2 "
                + "R:0.5 G4:0.5 G4:0.5 G4:0.5 Eb4:0.5 Ab4:0.5 Ab4:0.5 Ab4:0.5 "
                + "G4:0.5 Eb5:0.5 Eb5:0.5 Eb5:0.5 C5:2 "
                + "R:0.5 G4:0.5 G4:0.5 G4:0.5 D4:0.5 Ab4:0.5 Ab4:0.5 Ab4:0.5 "
                + "G4:0.5 F5:0.5 F5:0.5 F5:0.5 D5:2"));
        s.add(song("america", "America the Beautiful", MEDIUM, 90, "C", 4, 1,
                "G4:1 G4:1.5 E4:0.5 E4:1 G4:1 G4:1.5 D4:0.5 D4:1 E4:1 F4:1 G4:1 A4:1 B4:1 G4:3 "
                + "G4:1 G4:1.5 E4:0.5 E4:1 G4:1 G4:1.5 D4:0.5 D4:1 D5:1 C#5:1 D5:1 E5:1 B4:1 D5:3 "
                + "G4:1 E5:1.5 E5:0.5 D5:1 C5:1 C5:1.5 B4:0.5 B4:1 C5:1 D5:1 B4:1 A4:1 G4:1 C5:3 "
                + "C5:1 C5:1.5 A4:0.5 A4:1 C5:1 C5:1.5 G4:0.5 G4:1 G4:1 A4:1 C5:1 G4:1 D5:1 C5:3"));
        s.add(song("daisy", "Daisy Bell", MEDIUM, 110, "C", 3, 0,
                "G5:3 E5:3 C5:3 G4:3 A4:1 B4:1 C5:1 A4:2 C5:1 G4:6 "
                + "D5:3 G5:3 E5:3 C5:3 A4:1 B4:1 C5:1 D5:2 E5:1 D5:6"));
        s.add(song("minuetpart", "Minuet in G (part 1)", MEDIUM, 90, "G", 3, 0,
                MINUET_A + "F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 A4:3"));
        s.add(song("eliseshort", "Für Elise (first phrase)", MEDIUM, 70, "Am", 3, 1,
                "E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1.5 "
                + "C4:0.5 E4:0.5 A4:0.5 B4:1.5 E4:0.5 C5:0.5 B4:0.5 A4:3"));

        // ================= ADVANCED =================
        s.add(song("elise", "Für Elise (opening)", ADVANCED, 80, "Am", 3, 1,
                ELISE_A + "E4:0.5 " + ELISE_A.replace("G#4:0.5 B4:0.5 C5:1.5 ", "C5:0.5 B4:0.5 A4:2")));
        s.add(song("minuet", "Minuet in G", ADVANCED, 100, "G", 3, 0,
                MINUET_A + "F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 A4:3 "
                + MINUET_A + "A4:1 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 G4:3"));
        s.add(song("odefull", "Ode to Joy (full)", ADVANCED, 120, "C", 4, 0, ODE_A + ODE_A2 + ODE_B + ODE_A2));
        s.add(song("greensleeves", "Greensleeves", ADVANCED, 100, "Am", 3, 0.5,
                "A4:0.5 C5:1 D5:0.5 E5:0.75 F5:0.25 E5:0.5 D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 "
                + "C5:1 A4:0.5 A4:0.75 G#4:0.25 A4:0.5 B4:1 G#4:0.5 E4:1 A4:0.5 "
                + "C5:1 D5:0.5 E5:0.75 F5:0.25 E5:0.5 D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 "
                + "C5:0.75 B4:0.25 A4:0.5 G#4:0.75 F#4:0.25 G#4:0.5 A4:1.5 A4:1 "
                + "G5:1.5 G5:0.75 F#5:0.25 E5:0.5 D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 "
                + "C5:1 A4:0.5 A4:0.75 G#4:0.25 A4:0.5 B4:1 G#4:0.5 E4:1.5 "
                + "G5:1.5 G5:0.75 F#5:0.25 E5:0.5 D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 "
                + "C5:0.75 B4:0.25 A4:0.5 G#4:0.75 F#4:0.25 G#4:0.5 A4:1.5"));
        s.add(song("kleine", "Eine kleine Nachtmusik", ADVANCED, 120, "G", 4, 0,
                "G4:1 R:0.5 D4:0.5 G4:1 R:0.5 D4:0.5 G4:0.5 D4:0.5 G4:0.5 B4:0.5 D5:2 "
                + "C5:1 R:0.5 A4:0.5 C5:1 R:0.5 A4:0.5 C5:0.5 A4:0.5 F#4:0.5 A4:0.5 D4:2"));
        s.add(song("turkish", "Turkish March (Mozart)", ADVANCED, 100, "Am", 2, 1,
                "B3:0.25 A3:0.25 G#3:0.25 A3:0.25 C4:1 D4:0.25 C4:0.25 B3:0.25 C4:0.25 E4:1 "
                + "F4:0.25 E4:0.25 D#4:0.25 E4:0.25 B4:0.25 A4:0.25 G#4:0.25 A4:0.25 "
                + "B4:0.25 A4:0.25 G#4:0.25 A4:0.25 C5:2"));
        s.add(song("mountain", "In the Hall of the Mountain King", ADVANCED, 120, "Bm", 4, 0,
                "B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:1 F4:0.5 C#4:0.5 F4:1 E4:0.5 C4:0.5 E4:1 "
                + "B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:0.5 B4:0.5 A4:0.5 F#4:0.5 D4:0.5 F#4:0.5 A4:2 "
                + "F#4:0.5 G#4:0.5 A#4:0.5 B4:0.5 C#5:0.5 A#4:0.5 C#5:1 D5:0.5 A#4:0.5 D5:1 C#5:0.5 A#4:0.5 C#5:1 "
                + "F#4:0.5 G#4:0.5 A#4:0.5 B4:0.5 C#5:0.5 A#4:0.5 C#5:1 D5:0.5 A#4:0.5 D5:1 C#5:2"));
        s.add(song("swan", "Swan Lake", ADVANCED, 80, "Bm", 4, 0,
                "F#4:4 B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:1.5 D4:0.5 F#4:1.5 D4:0.5 "
                + "F#4:1.5 B3:0.5 D4:0.5 B3:0.5 G3:0.5 D4:0.5 B3:4"));
        s.add(song("entertainer", "The Entertainer (Joplin)", ADVANCED, 90, "C", 4, 0,
                "D4:0.5 D#4:0.5 E4:0.5 C5:1 E4:0.5 C5:1 E4:0.5 C5:2.5 "
                + "C5:0.5 D5:0.5 D#5:0.5 E5:0.5 C5:0.5 D5:0.5 E5:1 B4:0.5 D5:1 C5:3 "
                + "D4:0.5 D#4:0.5 E4:0.5 C5:1 E4:0.5 C5:1 E4:0.5 C5:2.5 "
                + "A4:0.5 G4:0.5 F#4:0.5 A4:0.5 C5:0.5 E5:1 D5:0.5 C5:0.5 A4:0.5 D5:3"));
        s.add(song("canon", "Canon in D (Pachelbel)", ADVANCED, 70, "D", 4, 0,
                "F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2 "
                + "D5:2 C#5:2 B4:2 A4:2 G4:2 F#4:2 G4:2 E4:2 "
                + "D4:1 F#4:1 A4:1 G4:1 F#4:1 D4:1 F#4:1 E4:1 D4:1 B3:1 D4:1 A4:1 G4:1 B4:1 A4:1 G4:1"));
        s.add(song("prelude", "Prelude in C (Bach)", ADVANCED, 70, "C", 4, 0,
                twice("C4 E4 G4 C5 E5 G4 C5 E5 ") + twice("C4 D4 A4 D5 F5 A4 D5 F5 ")
                + twice("B3 D4 G4 D5 F5 G4 D5 F5 ") + twice("C4 E4 G4 C5 E5 G4 C5 E5 ")
                + twice("C4 E4 A4 E5 A5 A4 E5 A5 ") + twice("C4 D4 F#4 A4 D5 F#4 A4 D5 ")
                + twice("B3 D4 G4 D5 G5 G4 D5 G5 ") + twice("B3 C4 E4 G4 C5 E4 G4 C5 "), 0.25));
        s.add(song("jesu", "Jesu, Joy of Man's Desiring", ADVANCED, 80, "G", 3, 0,
                "G4 A4 B4 D5 C5 C5 E5 D5 D5 G5 F#5 G5 D5 B4 G4 A4 B4 C5 "
                + "D5 E5 D5 C5 B4 A4 B4 G4 F#4 G4 A4 D4 F#4 A4 C5 B4 A4 B4", 1.0 / 3));
        s.add(song("toccata", "Toccata in D minor (Bach)", ADVANCED, 60, "Dm", 4, 0,
                "A5:0.25 G5:0.25 A5:2.5 G5:0.25 F5:0.25 E5:0.25 D5:0.25 C#5:1 D5:3 "
                + "A4:0.25 G4:0.25 A4:2.5 E4:0.5 F4:0.5 C#4:1 D4:3"));
        s.add(song("bumblebee", "Flight of the Bumblebee", ADVANCED, 90, "Am", 4, 0,
                BUMBLE_RUN + BUMBLE_RUN + shiftOctave(BUMBLE_RUN, -1) + "E4:2", 0.25));
        s.add(song("invention", "Invention No. 1 (Bach)", ADVANCED, 70, "C", 4, 0,
                "R:0.25 C4:0.25 D4:0.25 E4:0.25 F4:0.25 D4:0.25 E4:0.25 C4:0.25 G4:0.5 C5:0.5 B4:0.5 C5:0.5 "
                + "D5:0.25 G4:0.25 A4:0.25 B4:0.25 C5:0.25 A4:0.25 B4:0.25 G4:0.25 D5:0.5 G5:0.5 F5:0.5 G5:0.5"));
        s.add(song("sym40", "Symphony No. 40 (Mozart)", ADVANCED, 110, "Gm", 4, 1,
                "Eb5:0.5 D5:0.5 D5:1 Eb5:0.5 D5:0.5 D5:1 Eb5:0.5 D5:0.5 D5:1 Bb5:2 "
                + "Bb5:0.5 A5:0.5 G5:1 G5:0.5 F5:0.5 Eb5:1 Eb5:0.5 D5:0.5 C5:1 C5:2 "
                + "D5:0.5 C5:0.5 C5:1 D5:0.5 C5:0.5 C5:1 D5:0.5 C5:0.5 C5:1 A5:2 "
                + "A5:0.5 G5:0.5 F#5:1 F#5:0.5 Eb5:0.5 D5:1 D5:0.5 C5:0.5 Bb4:1 Bb4:2"));
        s.add(song("valkyries", "Ride of the Valkyries", ADVANCED, 100, "Bm", 4.5, 1.5,
                "B4:0.75 F#4:0.25 B4:0.5 D5:1.5 B4:1.5 D5:0.75 B4:0.25 D5:0.5 F#5:1.5 D5:1.5 "
                + "F#5:0.75 D5:0.25 F#5:0.5 A5:1.5 A4:1.5 D5:0.75 A4:0.25 D5:0.5 F#5:4.5"));
        s.add(song("spring", "Spring (Vivaldi)", ADVANCED, 110, "E", 4, 1,
                "E4:1 G#4:1 G#4:1 G#4:1 F#4:0.5 E4:0.5 B4:3 B4:0.5 A4:0.5 "
                + "G#4:1 G#4:1 G#4:1 F#4:0.5 E4:0.5 B4:3 B4:0.5 A4:0.5 "
                + "G#4:1 A4:0.5 B4:0.5 A4:1 G#4:1 F#4:3"));
        s.add(song("promenade", "Promenade (Mussorgsky)", ADVANCED, 90, "Bb", 5, 0,
                "G4:1 F4:1 Bb4:1 C5:0.5 F5:0.5 D5:1 C5:0.5 F5:0.5 D5:1 Bb4:1 C5:1 G4:1 F4:2"));
        s.add(song("tell", "William Tell Overture", ADVANCED, 140, "C", 2, 0,
                "G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 C5:0.5 D5:0.5 E5:0.5 "
                + "G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 C5:0.5 E5:0.25 E5:0.25 D5:0.5 B4:0.5 G4:0.5 "
                + "G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 G4:0.5 G4:0.25 G4:0.25 C5:0.5 D5:0.5 E5:0.5 "
                + "C5:0.5 E5:0.5 D5:0.5 B4:0.5 C5:1"));
        s.add(song("gymno", "Gymnopédie No. 1 (Satie)", ADVANCED, 72, "D", 3, 0,
                "F#5:1 A5:1 G5:1 F#5:1 C#5:1 B4:1 C#5:1 D5:1 A4:1 F#4:6"));
        s.add(song("cancan", "Can-Can (Offenbach)", ADVANCED, 150, "C", 2, 0,
                "C4:1 D4:0.5 F4:0.5 E4:0.5 D4:0.5 G4:1 G4:1 G4:0.5 A4:0.5 E4:0.5 F4:0.5 D4:1 D4:1 "
                + "D4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:0.5 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:2 "
                + "C4:1 D4:0.5 F4:0.5 E4:0.5 D4:0.5 G4:1 G4:1 G4:0.5 A4:0.5 E4:0.5 F4:0.5 D4:1 D4:1 "
                + "D4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:0.5 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:2"));
        s.add(song("danube", "The Blue Danube (Strauss)", ADVANCED, 150, "C", 3, 0,
                "C4:1 C4:1 E4:1 G4:1 G4:2 G5:1 G5:2 E5:1 E5:2 "
                + "C4:1 C4:1 E4:1 G4:1 G4:2 G5:1 G5:2 F5:1 F5:2 "
                + "B3:1 B3:1 D4:1 A4:1 A4:2 A5:1 A5:2 F5:1 F5:2 "
                + "B3:1 B3:1 D4:1 A4:1 A4:2 A5:1 A5:2 E5:1 E5:2 "
                + "C4:1 C4:1 E4:1 G4:1 C5:2 G5:1 G5:2 E5:1 E5:2 "
                + "C4:1 C4:1 E4:1 G4:1 C5:2 G5:1 G5:2 F5:1 F5:2"));

        ALL.addAll(s);
    }

    /** Full public-domain scores in the app (assets/scores). Source: The Mutopia Project. */
    private static final String[][] FULL = {
            // id, title, file, bpm (0 = from file)
            {"elise", "Für Elise", "fur_Elise_WoO59.mid", "0"},
            {"minuet", "Minuet in G", "anna-magdalena-04.mid", "110"},
            {"odefull", "Ode to Joy (full, with bass)", "ode.mid", "0"},
            {"greensleeves", "Greensleeves", "GreensleevesAcc.mid", "0"},
            {"kleine", "Eine kleine Nachtmusik (1st movement)", "eine-kleine-nachtmusik-mvt1.mid", "0"},
            {"turkish", "Turkish March (Mozart)", "KV331_3_RondoAllaTurca.mid", "110"},
            {"mountain", "In the Hall of the Mountain King", "Dans_l_antre_du_roi_de_la_montagne.mid", "0"},
            {"entertainer", "The Entertainer (Joplin)", "entertainer.mid", "0"},
            {"canon", "Canon in D (Pachelbel)", "CanonInD.mid", "0"},
            {"prelude", "Prelude in C (Bach)", "wtk1-prelude1.mid", "0"},
            {"toccata", "Toccata and Fugue in D minor (Bach)", "ToccataFugue.mid", "0"},
            {"invention", "Invention No. 1 (Bach)", "bach-invention-01.mid", "0"},
            {"promenade", "Promenade (Mussorgsky)", "promenade-1.mid", "0"},
            {"gymno", "Gymnopédie No. 1 (Satie)", "gymnopedie_1.mid", "0"},
            {"danube", "The Blue Danube (Strauss)", "blue_danube.mid", "0"},
    };

    /** Loads the full scores and the songs the user added. Safe to call many times. */
    public static synchronized void load(android.content.Context ctx) {
        if (loaded) {
            return;
        }
        loaded = true;
        for (String[] f : FULL) {
            try (java.io.InputStream in = ctx.getAssets().open("scores/" + f[2])) {
                ScoreImport.Result r = ScoreImport.read(ScoreImport.readAll(in), f[2]);
                int bpm = Integer.parseInt(f[3]) > 0 ? Integer.parseInt(f[3]) : (int) Math.round(r.bpm);
                Song song = new Song(f[0], f[1], ADVANCED, bpm, "C", r.barBeats, 0, r.right, r.left);
                song.full = true;
                replace(song);
            } catch (Exception e) {
                android.util.Log.w("PianoStars", "Could not load " + f[2], e);
            }
        }
        for (String id : new String[]{"jesu", "swan", "bumblebee", "sym40", "valkyries", "spring", "tell", "cancan"}) {
            Song old = byId(id);
            if (old != null && old.id.equals(id) && !old.title.endsWith("(theme)")) {
                replace(new Song(old.id, old.title + " (theme)", old.level, old.bpm,
                        keyName(old.keyPc, old.minor), old.barBeats, old.pickup, old.notes));
            }
        }
        for (Song s : UserSongs.loadAll(ctx)) {
            ALL.add(s);
        }
    }

    private static String keyName(int pc, boolean minor) {
        String[] n = {"C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"};
        return n[pc] + (minor ? "m" : "");
    }

    static void replace(Song song) {
        synchronized (ALL) {
            for (int i = 0; i < ALL.size(); i++) {
                if (ALL.get(i).id.equals(song.id)) {
                    ALL.set(i, song);
                    return;
                }
            }
            ALL.add(song);
        }
    }

    public static void remove(String id) {
        synchronized (ALL) {
            for (int i = 0; i < ALL.size(); i++) {
                if (ALL.get(i).id.equals(id)) {
                    ALL.remove(i);
                    return;
                }
            }
        }
    }

    private Songs() {
    }

    public static List<Song> forLevel(int level) {
        List<Song> out = new ArrayList<>();
        synchronized (ALL) {
            for (Song s : ALL) {
                if (s.level == level) {
                    out.add(s);
                }
            }
        }
        return out;
    }

    public static Song byId(String id) {
        synchronized (ALL) {
            for (Song s : ALL) {
                if (s.id.equals(id)) {
                    return s;
                }
            }
            return ALL.get(0);
        }
    }

    static boolean isWhite(int midi) {
        int pc = midi % 12;
        return pc == 0 || pc == 2 || pc == 4 || pc == 5 || pc == 7 || pc == 9 || pc == 11;
    }

    /** The white key that is n white keys above start (start must be white). */
    static int nthWhite(int start, int n) {
        int m = start;
        int count = 0;
        while (count < n) {
            m++;
            if (isWhite(m)) {
                count++;
            }
        }
        return m;
    }

    private static String twice(String s) {
        return s + s;
    }

    private static String shiftOctave(String notes, int octaves) {
        StringBuilder sb = new StringBuilder();
        for (String tok : notes.trim().split("\\s+")) {
            int m = parse(tok) + 12 * octaves;
            sb.append(name(m)).append(' ');
        }
        return sb.toString();
    }

    static String name(int midi) {
        String[] n = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
        return n[midi % 12] + (midi / 12 - 1);
    }

    private static Song song(String id, String title, int level, int bpm, String key,
                             double bar, double pickup, String data) {
        return song(id, title, level, bpm, key, bar, pickup, data, 1.0);
    }

    /** Tokens are "C4:1" (note and length in beats), "R:0.5" (rest) or "C4" (uses defLen). */
    private static Song song(String id, String title, int level, int bpm, String key,
                             double bar, double pickup, String data, double defLen) {
        List<Note> notes = new ArrayList<>();
        double beat = 0;
        for (String tok : data.trim().split("\\s+")) {
            String[] parts = tok.split(":");
            double len = parts.length > 1 ? Double.parseDouble(parts[1]) : defLen;
            if (!parts[0].equals("R")) {
                notes.add(new Note(parse(parts[0]), beat, len, false));
            }
            beat += len;
        }
        return new Song(id, title, level, bpm, key, bar, pickup, Collections.unmodifiableList(notes));
    }

    private static Song song(String id, String title, int level, int bpm, String key,
                             int bar, int pickup, String data, double defLen) {
        return song(id, title, level, bpm, key, (double) bar, (double) pickup, data, defLen);
    }

    /** "C4" = 60 (middle C), "F#5" = 78, "Bb3" = 58. */
    static int parse(String name) {
        int[] base = {9, 11, 0, 2, 4, 5, 7}; // A B C D E F G
        int semi = base[name.charAt(0) - 'A'];
        int i = 1;
        if (name.charAt(i) == '#') {
            semi++;
            i++;
        } else if (name.charAt(i) == 'b') {
            semi--;
            i++;
        }
        int octave = Integer.parseInt(name.substring(i));
        return 12 * (octave + 1) + semi;
    }
}
