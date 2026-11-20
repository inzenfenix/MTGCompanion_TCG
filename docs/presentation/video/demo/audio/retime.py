#!/usr/bin/env python3
"""Retime every scene of the O18 film to the recorded voices.

For each scene: find the spoken cue of each beat in the whisper transcript, place the beat 0.3 s before
it, pause the voice (at a real silence) while a silent evidence monitor plays or while a beat still
needs time for its own animations, rewrite the scene's T table + every data-start/data-duration, insert
the voice <audio> segments, then restack index.html. Run with --dry to only print the plan.

NOT idempotent: it treats the T tables it finds as the visual-only timing. Re-run it only on the scene files
as of commit 4d1c008 (`git checkout 4d1c008 -- film/compositions film/index.html`), re-add
data-layout-allow-occlusion on #s06-a-in, then run mix.py for the music bed and effects (README "Audio").
"""
import json, re, subprocess, sys, unicodedata, difflib
from pathlib import Path

FILM = Path('/home/inzenfenix/Documents/GitHub/framework-ia-UDD/docs/presentation/video/film')
TR = Path('/mnt/SSDGames/mtg-video/work/voces/tr')
LEAD = 0.3          # a beat appears this long before its first word
VOICE_IN = 0.6      # scene time where the voice starts
RESUME = 0.25       # after a pause, the voice resumes this long after the beat starts
TAIL = 1.2          # hold after the last word
GAP_FILES = 0.8     # silence between speakers inside one scene (s12)
MON_SCALE = 0.8     # silent monitors play this fraction of their designed length (trimmed from the start)

START = '__start__'  # cue = first word of the scene's (first) voice file
# key -> cue phrase (None = no spoken cue). Monitors listed here start on that phrase and the voice keeps
# talking over them; monitors not listed play silent while the voice waits.
SCENES = {
    's01': (['s01_solano'], {'team': START, 'method': 'para cada actividad', 'plan': 'yo parto'}),
    's02': (['s02_solano'], {'card': START, 'scan': 'lo que la diferencia', 'baz': 'desde ahi el jugador',
                             'qr': 'y en una venta', 'map': 'detras hay un backend'}),
    's03': (['s03_solano'], {'card': START, 'law': 'trabajamos con la ley', 'flows': 'mapeamos cuatro flujos',
                             'diag': None, 'bases': 'la regla fue simple', 'inv': 'la geolocalizacion la'}),
    's04': (['s04_solano'], {'card': START, 'q': 'para cada dato', 'pw': 'si solo hay que', 'loc': 'si hay que recuperarlo',
                             'tok': 'si no hay que tocarlo', 'sig': 'y lo que no se debe', 'monA': 'en la base de datos',
                             'tam': 'si altero un solo', 'key': 'las llaves viven', 'next': 'le paso la palabra'}),
    's05': (['s05_fuentes'], {'name': START, 'card': None, 'rules': 'el principio central',
                              'reg': 'revisamos la base', 'loc': 'la ubicacion se redondea', 'mon': 'miren', 'end': None}),
    's06': (['s06_fuentes'], {'card': START, 'diff': 'un seudonimo se puede', 'aud': 'usamos seudonimos',
                              'bid': 'en las subastas', 'k': 'y anonimizamos', 'copy': 'las copias de la base',
                              'res': 'revertir un seudonimo'}),
    's07': (['s07_fuentes'], {'card': START, 'mat': 'definimos tres roles', 'gap': 'al revisar el codigo',
                              'deny': 'un usuario que pide', 'sup': 'soporte si puede', 'adm': 'y el administrador', 'end': None}),
    's08': (['s08_fuentes'], {'card': START, 'req': 'el articulo 12', 'pur': 'cada finalidad ubicacion', 'hash': 'guardamos que version',
                              'pre': 'nada viene', 'chk': 'lo mas importante', 'monA': 'aqui revoco',
                              'del': 'en la misma operacion', 'monB': 'si la app intenta', 'pass': 'le paso la palabra'}),
    's09': (['s09_rodriguez'], {'name': START, 'card': None, 'rig': 'la ley da derecho', 'life': 'todo se pide',
                                'step': 'la verificacion es', 'json': 'el acceso', 'mail': 'si cambio', 'del': 'y si pido borrar',
                                'keep': 'cuando procede'}),
    's10': (['s10_rodriguez'], {'card': START, 'pub': 'primero un canal', 'opp1': 'segundo el derecho',
                                'opp2': 'si se opone al', 'blk': 'tercero el bloqueo', 'end': None}),
    's11': (['s11_rodriguez'], {'card': START, 'chain': 'el registro de auditoria', 'rules': 'sobre ese registro',
                                'atk': 'lo probamos', 'rec': 'siguiendo nuestro plan', 'plan': None, 'end': None}),
    's12': (['s12_fuentes', 's12_solano', 's12_rodriguez'], {'hdr': None, 'vic': 'FILE0', 'sol': 'FILE1', 'rod': 'FILE2', 'fin': None}),
}


def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9 ]', '', s)


def silences(wav, thr=-45.0, mind=0.06):
    """Gaps between words: runs of 20 ms RMS windows (10 ms hop) under thr dBFS lasting >= mind seconds
    (thr assumes voice files at -16 LUFS, as prep.sh leaves them).
    (silencedetect at -38 dB/0.12 s missed the short gaps of fluent speech, which pushed cuts into words.)"""
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(wav), '-f', 's16le', '-ac', '1', '-ar', '48000', '-'],
                         capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    hop, win = 480, 960
    n = max(0, (len(x) - win) // hop)
    fr = np.lib.stride_tricks.sliding_window_view(x, win)[::hop][:n]
    q = 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-9) < thr
    out, i = [], 0
    while i < n:
        if q[i]:
            j = i
            while j < n and q[j]:
                j += 1
            a, b = (i * hop + win / 2) / 48000, ((j - 1) * hop + win / 2) / 48000
            if b - a >= mind:
                out.append((a, b))
            i = j
        else:
            i += 1
    return out


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)],
                                capture_output=True, text=True).stdout)


def voice_track(files):
    """Concatenate the scene's voice files into one virtual timeline: words, silences, per-file spans."""
    words, sil, spans, off = [], [], [], 0.0
    for f in files:
        wav = FILM / 'assets/audio' / f'{f}.wav'
        d = dur(wav)
        for w in json.load(open(TR / f'{f}.json')):
            words.append({'t': norm(w['text']), 'raw': w['text'].strip(), 's': w['start'] + off, 'e': w['end'] + off})
        sil += [(a + off, b + off) for a, b in silences(wav)]
        spans.append((f, off, off + d))
        off += d + GAP_FILES
    return words, sil, spans


def find_cue(words, phrase, after):
    target = norm(phrase).split()
    n = len(target)
    best, bi = 0, None
    for i in range(len(words) - n + 1):
        if words[i]['s'] < after - 0.05:
            continue
        r = difflib.SequenceMatcher(None, ' '.join(target), ' '.join(w['t'] for w in words[i:i + n])).ratio()
        if r > best + 1e-9:
            best, bi = r, i
        if r >= 0.92:
            break
    if bi is None or best < 0.6:
        raise SystemExit(f'cue not found: {phrase!r} (best {best:.2f})')
    return words[bi]['s'], best


# pauses pinned by hand where the scoring is fragile: (scene, beat) -> pause right after this word
# s04 'next': "…ningún secreto. | Así que, dado esto, le paso la palabra a Vicente" (team feedback, 4:15)
CUT_AFTER = {('s04', 'next'): 'secreto'}
CUT_BACK = 2.5      # a voice pause may start up to this long before its cue word...
SENT_BONUS = 0.3    # ...and prefers a pause that follows the end of a sentence


def cut_point(sil, t, words, lo=0.0):
    """Where to stop the voice before cue word t: always inside a real silence (silencedetect), never mid-word.

    Whisper's word times drift (±0.3 s) and connected speech has no gap before many cue words, so the old
    rule (closest silence within 1 s, else t - 0.12) cut through words ("para", "jugadores", "le paso…").
    Score each silence ending in [t - CUT_BACK, t + 0.6]: its length (capped at 0.45, what prep.sh leaves of
    a long pause), a bonus if a word ending in . ? ! (smaller: , ; :) stops right before it, minus 0.18 per second of distance.
    """
    def score(ab):
        a, b = ab
        near = [w['raw'][-1:] for w in words if a - 0.35 <= w['e'] <= b + 0.1]
        sent, comma = any(c in '.?!' for c in near), any(c in ',;:' for c in near)
        return min(b - a, 0.45) + SENT_BONUS * sent + 0.08 * comma - 0.18 * max(0.0, t - b)
    cands = [(a, b) for a, b in sil if t - CUT_BACK <= b <= t + 0.6 and (a + b) / 2 > lo + 0.4]
    if not cands:   # widen forward: better to let the cue word play early than to cut through it
        cands = [(a, b) for a, b in sil if t + 0.6 < b <= t + 1.5 and (a + b) / 2 > lo + 0.4]
    if not cands:
        raise SystemExit(f'no silence to cut at near voice time {t:.2f}')
    a, b = max(cands, key=score)
    return max(a, b - 0.35, (a + b) / 2) if b - a > 0.7 else (a + b) / 2


def parse_T(src):
    m = re.search(r'const T = \{([^}]*)\};', src)
    T = [(k, float(v)) for k, v in re.findall(r'(\w+):\s*([\d.]+)', m.group(1))]
    return m, T


# beats that must hold longer than their animations need (a name plate has to be read)
MINLEN = {('s05', 'name'): 3.6, ('s09', 'name'): 3.6, ('s03', 'flows'): 8.0, ('s09', 'mail'): 6.6}
CUR = {'sid': None}


def _words_of(src, sel):
    """Word count of the element a selector like '#s04-tok-sub' points at (0 if not a plain id)."""
    m = re.match(r"#([\w-]+)", sel)
    if not m:
        return 0
    el = re.search(rf'id="{m.group(1)}"[^>]*>(.*?)</(?:div|span|b)>', src, re.S)
    return len(re.sub(r'<[^>]+>', ' ', el.group(1)).split()) if el else 0


def min_len(src, key):
    """A beat lasts until its last element has landed and can be read: 0.5 s + 0.3 s a word (motion.md)."""
    need = 0.0
    for sel, off in re.findall(rf"'([^']+)'[^;\n]*?T\.{key}\s*\+\s*([\d.]+)", src):
        need = max(need, float(off) + 0.5 + 0.3 * max(_words_of(src, sel), 2) + 0.45)
    # lists animated in a loop: ['#a', '#b', …].forEach((s, i) => …(T.key + a + i * b))
    for items, a, b in re.findall(rf"\[([^\]]*)\]\.forEach\([^;]*?T\.{key}\s*\+\s*([\d.]+)\s*\+\s*i\s*\*\s*([\d.]+)", src):
        sels = re.findall(r"'([^']+)'", items)
        if sels:
            need = max(need, float(a) + (len(sels) - 1) * float(b) + 0.5 + 0.3 * max(_words_of(src, sels[-1]), 2) + 0.45)
    offs = [float(x) for x in re.findall(rf'T\.{key}\s*\+\s*([\d.]+)', src)]
    need = max(need, max(offs, default=0.0) + 1.3)
    return max(need, MINLEN.get((CUR['sid'], key), 0.0))


def plan_scene(sid, old_dur):
    files, cues = SCENES[sid]
    CUR['sid'] = sid
    path = FILM / 'compositions' / f'{sid}.html'
    src = path.read_text()
    _, T = parse_T(src)
    keys = [k for k, _ in T]
    old = dict(T)
    words, sil, spans = voice_track(files)
    is_mon = lambda k: k.startswith('mon') and k not in cues
    nxt = lambda i: old[keys[i + 1]] if i + 1 < len(keys) else old_dur

    new, segs, log = {}, [], []
    gap = None            # scene time - voice time
    vs = 0.0              # voice time where the current voice segment starts
    voice_end = spans[-1][2]
    prev_end_min = 0.0    # earliest time the next beat may start
    after = 0.0

    def cue_time(k):
        nonlocal after
        c = cues.get(k)
        if c is None:
            return None
        if c == START:
            t = words[0]['s']
        elif c.startswith('FILE'):
            t = spans[int(c[4:])][1]
        else:
            t, r = find_cue(words, c, after)
            log.append(f'    {k:6} {c!r} -> {t:6.2f} (match {r:.2f})')
        after = t + 0.05
        return t

    def pause_at(vt, scene_t, key=None):
        """End the voice segment at voice time vt; it resumes at scene_t."""
        nonlocal vs, gap
        if vt - vs < 0.5:                                # cue right at the segment start: nothing to cut
            cut = vs
        elif any(abs(vt - sp[1]) < 1e-6 for sp in spans):  # cue on a speaker file start: the file boundary
            cut = vt
        elif (sid, key) in CUT_AFTER:                     # pinned: the gap right after a given word
            w = max((w for w in words if w['t'] == norm(CUT_AFTER[sid, key]) and w['e'] < vt), key=lambda w: w['e'])
            a, b = min((g for g in sil if g[1] > w['s']), key=lambda g: abs(g[0] - w['e']))
            cut = (a + b) / 2
        else:
            cut = cut_point(sil, vt, words, vs)
        before = ' '.join(w['raw'] for w in words if cut - 2.0 < w['e'] <= cut + 0.05)
        after = ' '.join(w['raw'] for w in words if cut - 0.05 <= w['s'] < cut + 2.0)
        log.append(f'    cut {cut:6.2f} (cue {vt:6.2f})  …{before[-40:]} | {after[:40]}…')
        if cut > vs + 0.05:
            segs.append((vs, cut, vs + gap))
        vs = cut
        gap = scene_t - cut

    i = 0
    while i < len(keys):
        k = keys[i]
        if i == 0:
            new[k] = old[k]
            cue_time(k)
            gap = VOICE_IN - words[0]['s']   # first word lands at VOICE_IN
            prev_end_min = new[k] + min_len(src, k)
            i += 1
            continue
        if is_mon(k):
            # silent monitor(s): the voice waits at the next spoken cue
            j = i
            while j < len(keys) and is_mon(keys[j]):
                j += 1
            nk = keys[j] if j < len(keys) else None
            c = cue_time(nk) if nk else None
            vt = c if c is not None else voice_end
            start = max(vt + gap - LEAD, prev_end_min)
            t = start
            for m in keys[i:j]:
                new[m] = t
                t += (nxt(keys.index(m)) - old[m]) * MON_SCALE
            if c is not None:
                pause_at(c, t + RESUME, nk)
            if nk:
                new[nk] = t
                prev_end_min = t + min_len(src, nk)
                log.append(f'    {"/".join(keys[i:j])} silent {t - start:.1f}s')
            i = j + 1
            continue
        c = cue_time(k)
        if c is None:
            new[k] = prev_end_min if not keys[i - 1].startswith('mon') else new[keys[i - 1]] + (old[k] - old[keys[i - 1]])
            new[k] = max(new[k], prev_end_min, (voice_end + gap + 0.4) if i == len(keys) - 1 else 0)
        else:
            want = c + gap - LEAD
            if want < prev_end_min:   # the beat before still needs time: the voice waits
                new[k] = prev_end_min
                pause_at(c, new[k] + LEAD, k)
                log.append(f'    pause {prev_end_min - want:.1f}s before {k}')
            else:
                new[k] = want
            if k in cues and k.startswith('mon'):
                # monitor on its cue, voice continues; the next beat can't start before it ends
                d = nxt(i) - old[k]
                prev_end_min = new[k] + d
                i += 1
                continue
        prev_end_min = new[k] + min_len(src, k)
        i += 1
    segs.append((vs, voice_end, vs + gap))
    last = keys[-1]
    end = max(segs[-1][2] + (segs[-1][1] - segs[-1][0]) + TAIL, new[last] + max(min_len(src, last), old_dur - old[last]))
    return path, src, old, new, round(end, 2), segs, spans, log


def remap(old, new, old_dur, new_dur):
    ks = sorted(old, key=lambda k: old[k])
    def f(t, is_end=False):
        if abs(t - old_dur) < 0.02:
            return new_dur
        for k in ks:
            if abs(t - old[k]) < 0.02:
                return new[k]
        base = None
        for k in ks:
            if old[k] <= t - (0.001 if is_end else 0):
                base = k
        if base is None:
            return t
        return new[base] + (t - old[base])
    return f


def apply(sid, path, src, old, new, new_dur, old_dur, segs, spans):
    f = remap(old, new, old_dur, new_dur)
    def tag(m):
        t = m.group(0)
        s = re.search(r'data-start="([\d.]+)"', t)
        if not s:
            return t
        st = float(s.group(1))
        d = re.search(r'data-duration="([\d.]+)"', t)
        ns = f(st)
        t = t.replace(s.group(0), f'data-start="{ns:g}"')
        if d:
            en = f(st + float(d.group(1)), True)
            od = float(d.group(1))
            if '<video' in t and en - ns < od - 0.01:
                # a shortened monitor keeps its payoff: trim the clip from its start
                ms = re.search(r'data-media-start="([\d.]+)"', t)
                if ms:
                    t = t.replace(ms.group(0), f'data-media-start="{float(ms.group(1)) + od - (en - ns):.2f}"')
            elif '<video' in t:
                en = ns + od   # footage keeps its own length
            t = t.replace(d.group(0), f'data-duration="{round(en - ns, 2):g}"')
        return t
    out = re.sub(r'<(?:div|img|video|audio)\b[^>]*>', tag, src)
    out = re.sub(r'const T = \{[^}]*\};', 'const T = { ' + ', '.join(f'{k}: {round(v, 2):g}' for k, v in new.items()) + ' };', out)
    out = re.sub(r'\n    <!-- voz \(retime\.py\) -->\n(?:    <audio [^\n]*\n)+', '\n', out)
    aud = []
    for n, (a, b, at) in enumerate(segs, 1):
        f0, o0, _ = next(sp for sp in spans if sp[1] - 0.01 <= a <= sp[2] + 0.01) if True else None
        # a segment never crosses a file boundary in s12 (each file starts on its own cue)
        aud.append(f'    <audio id="{sid}-voz-{n}" class="clip" src="assets/audio/{f0}.wav" data-start="{at:.2f}" '
                   f'data-duration="{min(b, [sp for sp in spans if sp[0] == f0][0][2]) - a:.2f}" data-media-start="{a - o0:.2f}" '
                   f'data-track-index="6" data-volume="0.75"></audio>')
    out = re.sub(r'(<div id="root"[^>]*>\n)', lambda m: m.group(1) + '    <!-- voz (retime.py) -->\n' + '\n'.join(aud) + '\n', out, count=1)
    path.write_text(out)


def split_file_segs(segs, spans):
    """Split any voice segment that spans two speaker files (s12)."""
    res = []
    for a, b, at in segs:
        for f, o, e in spans:
            lo, hi = max(a, o), min(b, e)
            if hi - lo > 0.05:
                res.append((lo, hi, at + (lo - a)))
    return res


def main():
    dry = '--dry' in sys.argv
    idx = (FILM / 'index.html').read_text()
    hosts = re.findall(r'id="(s\d\d)"\s+data-composition-id="\1"\s+data-composition-src="[^"]+"\s+data-start="([\d.]+)"\s+data-duration="([\d.]+)"', idx)
    durs = {}
    for sid, st, d in hosts:
        d = float(d)
        if sid not in SCENES:
            durs[sid] = d
            continue
        path, src, old, new, nd, segs, spans, log = plan_scene(sid, d)
        segs = split_file_segs(segs, spans)
        voice = sum(b - a for a, b, _ in segs)
        print(f'{sid}: {d:g}s -> {nd:g}s  voice {voice:.1f}s  segments {len(segs)}')
        print('\n'.join(log))
        print('    T ' + ', '.join(f'{k}={old[k]:g}->{new[k]:.1f}' for k in new))
        durs[sid] = nd
        if not dry:
            apply(sid, path, src, old, new, nd, d, segs, spans)
    t = 0.0
    for sid, _, _ in hosts:
        idx = re.sub(rf'(id="{sid}"\s+data-composition-id="{sid}"\s+data-composition-src="[^"]+"\s+)data-start="[\d.]+"\s+data-duration="[\d.]+"',
                     lambda m: m.group(1) + f'data-start="{t:g}"\n        data-duration="{durs[sid]:g}"', idx)
        t = round(t + durs[sid], 2)
    idx = re.sub(r'(data-composition-id="main" data-start="0" )data-duration="[\d.]+"', rf'\g<1>data-duration="{t:g}"', idx)
    print(f'TOTAL {t:g}s = {int(t // 60)}:{t % 60:04.1f}')
    if not dry:
        (FILM / 'index.html').write_text(idx)


if __name__ == '__main__':
    main()
