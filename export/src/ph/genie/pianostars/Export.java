package ph.genie.pianostars;
import java.util.*;
import java.io.*;
public class Export {
    static String num(double d) {
        if (d == Math.rint(d)) return String.valueOf((long) d);
        String s = String.format(java.util.Locale.US, "%.5f", d);
        s = s.replaceAll("0+$", ""); if (s.endsWith(".")) s = s.substring(0, s.length()-1);
        return s;
    }
    static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
    static void notes(StringBuilder sb, List<Songs.Note> ns) {
        sb.append("[");
        for (int i = 0; i < ns.size(); i++) {
            Songs.Note n = ns.get(i);
            if (i > 0) sb.append(",");
            sb.append("[").append(n.midi).append(",").append(num(n.beat)).append(",").append(num(n.len)).append("]");
        }
        sb.append("]");
    }
    public static void main(String[] a) throws Exception {
        android.content.res.AssetManager.root = a[0];
        Songs.load(new android.content.Context());
        StringBuilder sb = new StringBuilder("[\n");
        boolean first = true;
        for (Songs.Song s : Songs.ALL) {
            if (!first) sb.append(",\n");
            first = false;
            sb.append("{\"id\":\"").append(esc(s.id)).append("\",\"title\":\"").append(esc(s.title))
              .append("\",\"level\":").append(s.level).append(",\"bpm\":").append(s.bpm)
              .append(",\"barBeats\":").append(num(s.barBeats)).append(",\"pickup\":").append(num(s.pickup))
              .append(",\"full\":").append(s.full).append(",\"windowLow\":").append(s.windowLow())
              .append(",\"right\":");
            notes(sb, s.notes);
            sb.append(",\"left\":");
            notes(sb, s.leftHand());
            sb.append("}");
        }
        sb.append("\n]\n");
        try (Writer w = new OutputStreamWriter(new FileOutputStream(a[1]), "UTF-8")) { w.write(sb.toString()); }
        System.out.println("songs: " + Songs.ALL.size());
    }
}
