#!/usr/bin/env python3
"""Music bed + card effects for the O18 film, written into film/index.html (idempotent — run after retime.py).

- one whoosh per scene card (scene start + T.card + 0.05), alternating whoosh.mp3 / whoosh-cinematic.mp3, lane 8;
- the HeyGen catalog bed (assets/bgm/bed.m4a, built by bed.sh) on lane 7 with a volume lane:
  0.55 over the opening, 0.14 under the voice, 0.26 in every voice gap longer than 2.5 s (silent monitors),
  0.5 from the closing card to the end.
"""
import json, re
from pathlib import Path

FILM = Path(__file__).resolve().parents[2] / 'film'
UNDER, GAP, INTRO, END = 0.14, 0.26, 0.55, 0.5


def main():
    idx = (FILM / 'index.html').read_text()
    hosts = re.findall(r'id="(s\d\d)"\s+data-composition-id="\1"\s+data-composition-src="([^"]+)"\s+data-start="([\d.]+)"', idx)
    total = float(re.search(r'data-composition-id="main" data-start="0" data-duration="([\d.]+)"', idx).group(1))

    # effects
    lines, n = [], 0
    segs, fin = [], None
    for sid, src, st in hosts:
        s = (FILM / src).read_text()
        st = float(st)
        for a, b in re.findall(r'<audio id="[^"]+voz[^"]*"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)"', s):
            segs.append((st + float(a), st + float(a) + float(b)))
        if sid == 's12':
            fin = st + float(re.search(r'fin:\s*([\d.]+)', s).group(1))
        m = re.search(r'const T = \{([^}]*)\}', s)
        if not m:
            continue
        T = dict((k, float(v)) for k, v in re.findall(r'(\w+):\s*([\d.]+)', m.group(1)))
        if 'card' not in T:
            continue
        n += 1
        at = st + T['card'] + 0.05
        if n % 2:
            lines.append(f'      <audio id="sfx-carta-{n}" class="clip" src="assets/sfx/whoosh.mp3" data-start="{at:.2f}" '
                         f'data-duration="0.57" data-track-index="8" data-volume="0.32"></audio>')
        else:
            lines.append(f'      <audio id="sfx-carta-{n}" class="clip" src="assets/sfx/whoosh-cinematic.mp3" data-start="{at:.2f}" '
                         f'data-duration="1.4" data-track-index="8" data-volume="0.22" data-fade-out="0.5"></audio>')
    idx = re.sub(r'      <!-- música:.*?</audio>\n', '', idx, flags=re.S)
    idx = re.sub(r'      <!-- efectos:.*?(?=    </div>\n    <script>)', '', idx, flags=re.S)
    block = '      <!-- efectos: una carta que cae = un whoosh (dos tomas alternadas) -->\n' + '\n'.join(lines) + '\n'

    # music volume lane
    segs.sort()
    pts = [(0, INTRO), (segs[0][0] - 1.0, INTRO), (segs[0][0] - 0.1, UNDER)]
    for (a, b), (c, d) in zip(segs, segs[1:]):
        if c - b > 2.5:
            pts += [(b + 0.3, UNDER), (b + 1.0, GAP), (c - 0.9, GAP), (c - 0.15, UNDER)]
    up = max(fin, segs[-1][1] + 0.3)
    pts += [(up, UNDER), (up + 1.2, END), (total, END)]
    pts = [{"t": round(t, 2), "v": v} for t, v in pts]
    auto = json.dumps({"version": 1, "lanes": [{"target": "volume", "points": pts}]}, separators=(',', ':')).replace('"', '&quot;')
    music = ('      <!-- música: cama ambiental (catálogo HeyGen, 78f194ec en bucle), baja bajo la voz -->\n'
             f'      <audio id="musica" class="clip" src="assets/bgm/bed.m4a" data-start="0" data-duration="{total:g}" data-track-index="7" '
             f'data-volume="1" data-fade-in="0.8" data-fade-out="3" data-automation="{auto}"></audio>\n')

    idx = idx.replace('    </div>\n    <script>', music + block + '    </div>\n    <script>', 1)
    (FILM / 'index.html').write_text(idx)
    print(f'{n} effects, {len(pts)} music points, closing up at {up:.1f} of {total:g}')


if __name__ == '__main__':
    main()
