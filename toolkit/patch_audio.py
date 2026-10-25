import sys
p, ap = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
audio = open(ap, encoding='utf-8').read()
rep = [
('<button id="play" type="button">Pause</button>', '<button id="play" type="button">Pause</button>\n    <button id="snd" type="button" aria-pressed="false">Sound off</button>'),
('      <div class="flash" id="flash"></div>', '      <div class="flash" id="flash"></div>\n      <button class="soundhint" id="hint" type="button">Turn on sound</button>'),
('.clock{', '.soundhint{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);font:500 2.6cqw/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--paper);background:rgba(10,12,18,.78);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:1em 1.5em;cursor:pointer}\n.soundhint:focus-visible{outline:2px solid var(--chair);outline-offset:2px}\n.clock{'),
('min-width:64px\n}', 'min-width:0\n}'),
("/* ---------- sizing and playback ---------- */", audio + "/* ---------- sizing and playback ---------- */"),
("syncBtn();\nfunction frame", "const sndBtn=$('snd');\nsndBtn.addEventListener('click',()=>setSound(!AU.on));\n$('hint').addEventListener('click',()=>setSound(true));\nsyncBtn();\nfunction frame"),
("  overlay(t,r.si,r.s);\n", "  overlay(t,r.si,r.s);\n  audioTick(t,r.si);\n"),
]
for a, b in rep:
    assert s.count(a) == 1, a
    s = s.replace(a, b)
open(p, 'w', encoding='utf-8').write(s)
print('patched')
