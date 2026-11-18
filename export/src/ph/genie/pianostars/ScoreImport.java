package ph.genie.pianostars;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Reads digital sheet music (MIDI, MusicXML, compressed MusicXML) and makes a
 * Piano Stars song: the right hand plays the top melody note, the left hand plays
 * the lowest bass note. This keeps the song playable for one child.
 */
public final class ScoreImport {

    /** One note from the file, before the hands are chosen. Times are in quarter-note beats. */
    static final class Raw {
        final int midi;
        final double start;
        final double len;
        final String group;

        Raw(int midi, double start, double len, String group) {
            this.midi = midi;
            this.start = start;
            this.len = len;
            this.group = group;
        }
    }

    public static final class Result {
        public String title = "My song";
        public double bpm = 100;
        public double barBeats = 4;
        public final List<Songs.Note> right = new ArrayList<>();
        public final List<Songs.Note> left = new ArrayList<>();
    }

    private ScoreImport() {
    }

    /** Reads any supported file. The name helps to choose the format. */
    public static Result read(byte[] data, String fileName) throws IOException {
        Result r;
        if (data.length >= 4 && data[0] == 'M' && data[1] == 'T' && data[2] == 'h' && data[3] == 'd') {
            r = readMidi(data);
        } else if (data.length >= 2 && data[0] == 'P' && data[1] == 'K') {
            r = readMusicXml(unzipMxl(data));
        } else {
            r = readMusicXml(data);
        }
        if (r.title == null || r.title.trim().isEmpty() || r.title.equals("My song")) {
            String t = fileName == null ? "My song" : fileName.replaceAll("\\.[A-Za-z0-9]+$", "");
            r.title = t.replace('_', ' ').replace('-', ' ').trim();
        }
        if (r.right.isEmpty() && r.left.isEmpty()) {
            throw new IOException("No notes found in this file.");
        }
        return r;
    }

    public static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    // ------------------------------------------------------------------ MIDI

    static Result readMidi(byte[] d) throws IOException {
        Result res = new Result();
        int p = 0;
        if (!(d[0] == 'M' && d[1] == 'T' && d[2] == 'h' && d[3] == 'd')) {
            throw new IOException("Not a MIDI file.");
        }
        int hlen = be32(d, 4);
        int ntrks = be16(d, 10);
        int division = be16(d, 12);
        int ppq = (division & 0x8000) != 0 ? 480 : division;
        p = 8 + hlen;
        List<Raw> raws = new ArrayList<>();
        boolean tempoSet = false;
        boolean timeSet = false;
        String trackName = null;
        for (int t = 0; t < ntrks && p + 8 <= d.length; t++) {
            if (!(d[p] == 'M' && d[p + 1] == 'T' && d[p + 2] == 'r' && d[p + 3] == 'k')) {
                p += 8 + be32(d, p + 4);
                t--;
                if (p >= d.length) {
                    break;
                }
                continue;
            }
            int len = be32(d, p + 4);
            int q = p + 8;
            int end = Math.min(d.length, q + len);
            long tick = 0;
            int status = 0;
            Map<Integer, long[]> on = new HashMap<>(); // key = channel*128+pitch -> start tick
            while (q < end) {
                long[] vl = varLen(d, q);
                tick += vl[0];
                q = (int) vl[1];
                if (q >= end) {
                    break;
                }
                int b = d[q] & 0xFF;
                if (b == 0xFF) {
                    int type = d[q + 1] & 0xFF;
                    long[] ml = varLen(d, q + 2);
                    int mlen = (int) ml[0];
                    int ms = (int) ml[1];
                    if (type == 0x51 && mlen == 3 && !tempoSet) {
                        int us = ((d[ms] & 0xFF) << 16) | ((d[ms + 1] & 0xFF) << 8) | (d[ms + 2] & 0xFF);
                        if (us > 0) {
                            res.bpm = Math.round(60_000_000.0 / us);
                            tempoSet = true;
                        }
                    } else if (type == 0x58 && mlen >= 2 && !timeSet) {
                        int nn = d[ms] & 0xFF;
                        int dd = d[ms + 1] & 0xFF;
                        res.barBeats = nn * 4.0 / (1 << dd);
                        timeSet = true;
                    } else if (type == 0x03 && t == 0 && trackName == null) {
                        trackName = new String(d, ms, mlen, java.nio.charset.StandardCharsets.ISO_8859_1).trim();
                    }
                    q = ms + mlen;
                    continue;
                }
                if (b == 0xF0 || b == 0xF7) {
                    long[] sl = varLen(d, q + 1);
                    q = (int) sl[1] + (int) sl[0];
                    continue;
                }
                int data1;
                if ((b & 0x80) != 0) {
                    status = b;
                    q++;
                }
                int type = status & 0xF0;
                int ch = status & 0x0F;
                if (type == 0xC0 || type == 0xD0) {
                    q += 1;
                    continue;
                }
                data1 = d[q] & 0xFF;
                int data2 = d[q + 1] & 0xFF;
                q += 2;
                if (ch == 9) {
                    continue; // drums
                }
                int key = ch * 128 + data1;
                if (type == 0x90 && data2 > 0) {
                    long[] prev = on.remove(key);
                    if (prev != null) {
                        addRaw(raws, data1, prev[0], tick, ppq, "t" + t + "c" + ch);
                    }
                    on.put(key, new long[]{tick});
                } else if (type == 0x80 || (type == 0x90 && data2 == 0)) {
                    long[] prev = on.remove(key);
                    if (prev != null) {
                        addRaw(raws, data1, prev[0], tick, ppq, "t" + t + "c" + ch);
                    }
                }
            }
            p = 8 + p + len;
        }
        if (trackName != null && trackName.length() > 2) {
            String lower = trackName.toLowerCase();
            boolean generic = lower.contains("track") || lower.contains("piano") || lower.contains("control")
                    || lower.contains("untitled") || lower.contains("staff") || lower.contains("voice")
                    || lower.matches(".*\\.(mid|midi)$");
            if (!generic) {
                res.title = trackName;
            }
        }
        makeHands(raws, res);
        return res;
    }

    private static void addRaw(List<Raw> raws, int midi, long a, long b, int ppq, String group) {
        double s = (double) a / ppq;
        double l = Math.max((double) (b - a) / ppq, 0.05);
        raws.add(new Raw(midi, s, l, group));
    }

    private static int be16(byte[] d, int i) {
        return ((d[i] & 0xFF) << 8) | (d[i + 1] & 0xFF);
    }

    private static int be32(byte[] d, int i) {
        return ((d[i] & 0xFF) << 24) | ((d[i + 1] & 0xFF) << 16) | ((d[i + 2] & 0xFF) << 8) | (d[i + 3] & 0xFF);
    }

    /** Returns {value, next index}. */
    private static long[] varLen(byte[] d, int i) {
        long v = 0;
        int b;
        do {
            b = d[i++] & 0xFF;
            v = (v << 7) | (b & 0x7F);
        } while ((b & 0x80) != 0 && i < d.length);
        return new long[]{v, i};
    }

    // ------------------------------------------------------------------ MusicXML

    static byte[] unzipMxl(byte[] data) throws IOException {
        Map<String, byte[]> files = new LinkedHashMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(data))) {
            ZipEntry e;
            while ((e = z.getNextEntry()) != null) {
                if (!e.isDirectory()) {
                    files.put(e.getName(), readAll(z));
                }
            }
        }
        byte[] container = files.get("META-INF/container.xml");
        if (container != null) {
            String c = new String(container, java.nio.charset.StandardCharsets.UTF_8);
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("full-path=\"([^\"]+)\"").matcher(c);
            if (m.find() && files.containsKey(m.group(1))) {
                return files.get(m.group(1));
            }
        }
        for (Map.Entry<String, byte[]> en : files.entrySet()) {
            String n = en.getKey().toLowerCase();
            if (!n.startsWith("meta-inf") && (n.endsWith(".xml") || n.endsWith(".musicxml"))) {
                return en.getValue();
            }
        }
        throw new IOException("No MusicXML inside this .mxl file.");
    }

    static Result readMusicXml(byte[] data) throws IOException {
        Result res = new Result();
        Document doc;
        try {
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setNamespaceAware(false);
            f.setValidating(false);
            try {
                f.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            } catch (Exception ignored) {
                // not supported on this platform
            }
            DocumentBuilder b = f.newDocumentBuilder();
            b.setEntityResolver((pub, sys) -> new org.xml.sax.InputSource(new java.io.StringReader("")));
            doc = b.parse(new ByteArrayInputStream(data));
        } catch (Exception e) {
            throw new IOException("This file is not MIDI or MusicXML.");
        }
        Element root = doc.getDocumentElement();
        if (!"score-partwise".equals(root.getTagName())) {
            throw new IOException("Only 'partwise' MusicXML is supported.");
        }
        String title = text(first(root, "work"), "work-title");
        if (title == null) {
            title = text(root, "movement-title");
        }
        if (title != null) {
            res.title = title.trim();
        }
        List<Raw> raws = new ArrayList<>();
        boolean tempoSet = false;
        boolean timeSet = false;
        int partIdx = 0;
        for (Element part : children(root, "part")) {
            double divisions = 1;
            double pos = 0;
            double lastStart = 0;
            Map<String, Integer> tieOpen = new HashMap<>(); // pitch+staff -> raw index
            for (Element measure : children(part, "measure")) {
                for (Element el : children(measure, null)) {
                    String tag = el.getTagName();
                    if (tag.equals("attributes")) {
                        String dv = text(el, "divisions");
                        if (dv != null) {
                            divisions = Double.parseDouble(dv.trim());
                        }
                        Element time = first(el, "time");
                        if (time != null && !timeSet) {
                            String bts = text(time, "beats");
                            String bt = text(time, "beat-type");
                            if (bts != null && bt != null) {
                                try {
                                    res.barBeats = Double.parseDouble(bts.trim().split("\\+")[0])
                                            * 4.0 / Double.parseDouble(bt.trim());
                                    timeSet = true;
                                } catch (NumberFormatException ignored) {
                                    // keep 4/4
                                }
                            }
                        }
                    } else if (tag.equals("backup")) {
                        pos -= num(text(el, "duration")) / divisions;
                    } else if (tag.equals("forward")) {
                        pos += num(text(el, "duration")) / divisions;
                    } else if (tag.equals("direction") || tag.equals("sound")) {
                        Element snd = tag.equals("sound") ? el : first(el, "sound");
                        if (snd != null && !tempoSet && snd.hasAttribute("tempo")) {
                            res.bpm = Math.round(num(snd.getAttribute("tempo")));
                            tempoSet = res.bpm > 0;
                        }
                    } else if (tag.equals("note")) {
                        if (first(el, "grace") != null) {
                            continue;
                        }
                        double dur = num(text(el, "duration")) / divisions;
                        boolean chord = first(el, "chord") != null;
                        double start = chord ? lastStart : pos;
                        if (!chord) {
                            pos += dur;
                            lastStart = start;
                        }
                        Element pitch = first(el, "pitch");
                        if (pitch == null) {
                            continue; // rest or unpitched
                        }
                        String step = text(pitch, "step");
                        int alter = (int) Math.round(num(text(pitch, "alter")));
                        int octave = (int) num(text(pitch, "octave"));
                        int midi = 12 * (octave + 1) + stepPc(step) + alter;
                        String staff = text(el, "staff");
                        String group = "p" + partIdx + "s" + (staff == null ? "1" : staff.trim());
                        String tieKey = midi + "|" + group;
                        boolean tieStop = false;
                        boolean tieStart = false;
                        for (Element tie : children(el, "tie")) {
                            if ("stop".equals(tie.getAttribute("type"))) {
                                tieStop = true;
                            }
                            if ("start".equals(tie.getAttribute("type"))) {
                                tieStart = true;
                            }
                        }
                        Integer open = tieOpen.get(tieKey);
                        if (tieStop && open != null) {
                            Raw old = raws.get(open);
                            raws.set(open, new Raw(old.midi, old.start, start + dur - old.start, old.group));
                            if (!tieStart) {
                                tieOpen.remove(tieKey);
                            }
                            continue;
                        }
                        raws.add(new Raw(midi, start, Math.max(dur, 0.05), group));
                        if (tieStart) {
                            tieOpen.put(tieKey, raws.size() - 1);
                        }
                    }
                }
            }
            partIdx++;
        }
        makeHands(raws, res);
        return res;
    }

    private static int stepPc(String step) {
        if (step == null) {
            return 0;
        }
        switch (step.trim().toUpperCase()) {
            case "C": return 0;
            case "D": return 2;
            case "E": return 4;
            case "F": return 5;
            case "G": return 7;
            case "A": return 9;
            default: return 11;
        }
    }

    private static double num(String s) {
        if (s == null) {
            return 0;
        }
        try {
            return Double.parseDouble(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static List<Element> children(Element parent, String tag) {
        List<Element> out = new ArrayList<>();
        if (parent == null) {
            return out;
        }
        NodeList nl = parent.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) {
            Node n = nl.item(i);
            if (n instanceof Element && (tag == null || ((Element) n).getTagName().equals(tag))) {
                out.add((Element) n);
            }
        }
        return out;
    }

    private static Element first(Element parent, String tag) {
        List<Element> l = children(parent, tag);
        return l.isEmpty() ? null : l.get(0);
    }

    private static String text(Element parent, String tag) {
        Element e = first(parent, tag);
        return e == null ? null : e.getTextContent();
    }

    // ------------------------------------------------------------------ hands

    /**
     * Picks the hands. With two or more parts (tracks or staves), the highest part is the
     * right hand and the lowest part is the left hand. With one part, notes from middle C
     * up are right hand. Then the right hand keeps only the top note of each chord, and the
     * left hand keeps only the bottom note.
     */
    static void makeHands(List<Raw> raws, Result res) {
        Map<String, double[]> stats = new LinkedHashMap<>(); // group -> {sum, count}
        for (Raw r : raws) {
            double[] s = stats.computeIfAbsent(r.group, k -> new double[2]);
            s[0] += r.midi;
            s[1]++;
        }
        String hi = null;
        String lo = null;
        double hiAvg = -1;
        double loAvg = 999;
        for (Map.Entry<String, double[]> e : stats.entrySet()) {
            if (e.getValue()[1] < 4) {
                continue;
            }
            double avg = e.getValue()[0] / e.getValue()[1];
            if (avg > hiAvg) {
                hiAvg = avg;
                hi = e.getKey();
            }
            if (avg < loAvg) {
                loAvg = avg;
                lo = e.getKey();
            }
        }
        List<Raw> rightPool = new ArrayList<>();
        List<Raw> leftPool = new ArrayList<>();
        boolean byPart = hi != null && lo != null && !hi.equals(lo);
        for (Raw r : raws) {
            if (byPart) {
                if (r.group.equals(hi)) {
                    rightPool.add(r);
                } else if (r.group.equals(lo)) {
                    leftPool.add(r);
                }
            } else if (r.midi >= 60) {
                rightPool.add(r);
            } else {
                leftPool.add(r);
            }
        }
        double shift = 0;
        double minStart = Double.MAX_VALUE;
        for (Raw r : raws) {
            minStart = Math.min(minStart, r.start);
        }
        if (minStart != Double.MAX_VALUE && minStart > 0) {
            shift = Math.floor(minStart / res.barBeats) * res.barBeats; // drop empty bars at the start
        }
        line(rightPool, true, shift, res.right, false);
        line(leftPool, false, shift, res.left, true);
    }

    /** Keeps one note per start time (top or bottom) and stops each note before the next one. */
    private static void line(List<Raw> pool, boolean top, double shift, List<Songs.Note> out, boolean left) {
        Collections.sort(pool, (a, b) -> a.start != b.start ? Double.compare(a.start, b.start)
                : Integer.compare(top ? b.midi : a.midi, top ? a.midi : b.midi));
        List<Raw> picked = new ArrayList<>();
        double eps = 1.0 / 32;
        for (Raw r : pool) {
            if (!picked.isEmpty() && Math.abs(picked.get(picked.size() - 1).start - r.start) < eps) {
                continue;
            }
            picked.add(r);
        }
        for (int i = 0; i < picked.size(); i++) {
            Raw r = picked.get(i);
            double len = r.len;
            if (i + 1 < picked.size()) {
                len = Math.min(len, picked.get(i + 1).start - r.start);
            }
            len = Math.max(len, 0.1);
            out.add(new Songs.Note(r.midi, r.start - shift, len, left));
        }
    }
}
