import sys
OUT=sys.argv[1]
T='x="48" y="40" width="416" height="416" rx="112"'
def mark(p, dark):
    rimc = '#8fc2ff' if dark else '#7ab8ff'
    line = '#fff3ec' if dark else '#0f1a33'
    lineop = '0.5' if dark else '0.5'
    return f'''<defs>
<linearGradient id="{p}bg" x1="0.05" y1="0" x2="0.95" y2="1"><stop offset="0" stop-color="#34497a" stop-opacity="0.80"/><stop offset="0.55" stop-color="#2a3a64" stop-opacity="0.80"/><stop offset="1" stop-color="#9a4a38" stop-opacity="0.82"/></linearGradient>
<linearGradient id="{p}frost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3ec" stop-opacity="0.30"/><stop offset="0.5" stop-color="#fff3ec" stop-opacity="0.08"/><stop offset="1" stop-color="#fff3ec" stop-opacity="0.14"/></linearGradient>
<linearGradient id="{p}sw" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f23f0d" stop-opacity="0.55"/><stop offset="0.35" stop-color="#f55a2a"/><stop offset="0.8" stop-color="#ff9a76"/><stop offset="1" stop-color="#fff3ec"/></linearGradient>
<linearGradient id="{p}tr" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff8a5c" stop-opacity="0"/><stop offset="0.6" stop-color="#ffb08f" stop-opacity="0.6"/><stop offset="1" stop-color="#fff3ec" stop-opacity="0.8"/></linearGradient>
<linearGradient id="{p}rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.4" stop-color="{rimc}" stop-opacity="0.35"/><stop offset="0.7" stop-color="#ffc2a8" stop-opacity="0.25"/><stop offset="1" stop-color="#ffb08f" stop-opacity="0.7"/></linearGradient>
<linearGradient id="{p}sheen" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fff3ec" stop-opacity="0.0"/><stop offset="0.5" stop-color="#fff3ec" stop-opacity="0.16"/><stop offset="1" stop-color="#fff3ec" stop-opacity="0.0"/></linearGradient>
<filter id="{p}sh" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="{p}b8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="{p}b3" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="{p}b24" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
<clipPath id="{p}clip"><rect {T}/></clipPath>
</defs>
<rect x="56" y="62" width="400" height="400" rx="108" fill="#0f1a33" fill-opacity="0.38" filter="url(#{p}sh)"/>
<rect {T} fill="url(#{p}bg)"/>
<rect {T} fill="url(#{p}frost)"/>
<g clip-path="url(#{p}clip)">
<path d="M-60 440 L290 -40 L440 -40 L90 520 Z" fill="url(#{p}sheen)" transform="translate(40 0)"/>
<rect x="48" y="40" width="416" height="416" rx="112" fill="none" stroke="#fff3ec" stroke-opacity="0.35" stroke-width="36" filter="url(#{p}b24)"/>
<path d="M120 370 C210 350 330 300 400 130 C 330 330 240 400 120 370 Z" fill="#f23f0d" fill-opacity="0.65" filter="url(#{p}b24)"/>
</g>
<path d="M100 388 C196 356 344 296 414 96 C 410 280 290 436 100 388 Z" fill="url(#{p}sw)"/>
<path d="M150 380 C250 352 340 290 392 150" fill="none" stroke="#fff3ec" stroke-opacity="0.55" stroke-width="10" stroke-linecap="round" filter="url(#{p}b3)"/>
<path d="M136 430 C290 414 410 320 436 178" fill="none" stroke="url(#{p}tr)" stroke-width="8" stroke-linecap="round"/>
<rect x="49" y="41" width="414" height="414" rx="111" fill="none" stroke="{line}" stroke-opacity="{lineop}" stroke-width="2"/>
<rect x="52" y="44" width="408" height="408" rx="108" fill="none" stroke="url(#{p}rim)" stroke-width="6"/>'''
# ZOOSH wordmark: original monoline letters, round caps + joins. Letter box 40 wide x 96 tall (visual), centreline box 5.5..34.5 x 5.5..90.5, stroke 11.
STROKE=11
ADV={'Z':(0,),'O1':(50,),'O2':(99,),'S':(148,),'H':(199,)}
def _glyphs(c1,c2):
    st=f'stroke-width="{STROKE}" fill="none" stroke-linecap="round" stroke-linejoin="round"'
    pill='<rect x="%g" y="5.5" width="29" height="85" rx="14.5" stroke="%s"/>'
    S_PATH=("M34.5 20 C34.5 11 28 5.5 20 5.5 C12 5.5 5.5 11 5.5 21 C5.5 33 14 38 20 48 "
            "C26 58 34.5 63 34.5 75 C34.5 85 28 90.5 20 90.5 C12 90.5 5.5 85 5.5 76")
    g=[]
    g.append(f'<g transform="translate({ADV["Z"][0]} 0)" {st}><path d="M5.5 5.5 H34.5 L5.5 90.5 H34.5" stroke="{c1}"/></g>')
    for k in ('O1','O2'):
        g.append(f'<g transform="translate({ADV[k][0]} 0)" {st}>'+pill%(5.5,c2)+'</g>')
    g.append(f'<g transform="translate({ADV["S"][0]} 0)" {st}><path d="{S_PATH}" stroke="{c2}"/></g>')
    g.append(f'<g transform="translate({ADV["H"][0]} 0)" {st}><path d="M5.5 5.5 V90.5 M34.5 5.5 V90.5 M5.5 48 H34.5" stroke="{c2}"/></g>')
    return "\n".join(g)
def word_upper(c1,c2,dx,dy,k=1.1):
    return f'<g transform="translate({dx} {dy}) scale({k})">\n{_glyphs(c1,c2)}\n</g>'

# lowercase "zoosh": x-height 76 (visual y 20..96), ascender (h) 92 (y 4..96), stroke 10, letter box 36 wide; centreline box x 5..31
LST=11
import math
OR=13.0; OCX=18.0; OTOP=25.0; OBOT=91.0   # the o: stadium, centreline x 5..31, y 25..91, radius 13
C1=(OCX,OTOP+OR); C2=(OCX,OBOT-OR)        # centres of the o's top and bottom semicircles
R1=12.0; C1x=17.5   # upper bowl: radius 12 (24 wide, 7.7 % narrower than the o), left edge at 5.5, right terminal pulled in
def _sp(term=30):
    """s = lower bowl is the o's bottom semicircle (r 13); upper bowl is a slightly smaller circle (r 12) whose top touches the o's top;
    the two are joined by their internal common tangent, so the whole outline is tangent-continuous"""
    c1=(C1x,OTOP+R1); c2=C2; r1=R1; r2=OR
    dx,dy=c2[0]-c1[0],c2[1]-c1[1]; dist=math.hypot(dx,dy)
    beta=math.acos((r1+r2)/dist); u=math.atan2(dy,dx)
    na=u+beta                                   # angle of the normal from c1 to its tangent point (lower-left)
    T1=(c1[0]+r1*math.cos(na),c1[1]+r1*math.sin(na)); T2=(c2[0]-r2*math.cos(na),c2[1]-r2*math.sin(na))
    P=math.pi/180
    st=(c1[0]+r1*math.cos(-term*P),c1[1]+r1*math.sin(-term*P))
    en=(c2[0]+r2*math.cos((180-term)*P),c2[1]+r2*math.sin((180-term)*P))
    return ("M%.2f %.2f A%g %g 0 1 0 %.2f %.2f L%.2f %.2f A%g %g 0 1 1 %.2f %.2f"%(st+(r1,r1)+T1+T2+(r2,r2)+en))
LADV={'z':0,'o1':48,'o2':96,'s':144,'h':191}
LW=227
def word_lower(c1,c2,dx,dy,k=1.1):
    st=f'stroke-width="{LST}" fill="none" stroke-linecap="round" stroke-linejoin="round"'
    g=[f'<g transform="translate({LADV["z"]} 0)" {st}><path d="M5 25 H31 L5 91 H26 Q31 91 31 85" stroke="{c1}"/></g>']
    for kx in ('o1','o2'):
        g.append(f'<g transform="translate({LADV[kx]} 0)" {st}><rect x="5" y="25" width="26" height="66" rx="13" stroke="{c2}"/></g>')
    g.append(f'<g transform="translate({LADV["s"]} 0)" {st}><path d="{_sp()}" stroke="{c2}"/></g>')
    g.append(f'<g transform="translate({LADV["h"]} 0)" {st}><path d="M5 9 V91 M5 38 A13 13 0 0 1 31 38 V91" stroke="{c2}"/></g>')
    return f'<g transform="translate({dx} {dy}) scale({k})">\n'+"\n".join(g)+'\n</g>'
def icon(d): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n<title>Zoosh icon</title>\n{mark("i",d)}\n</svg>\n'
def logo(d,style):
    c1='#f23f0d'; c2='#fff3ec' if d else '#1d2b4a'
    if style=='lower': w=word_lower(c1,c2,228,49); W=502
    else: w=word_upper(c1,c2,228,51.2); W=540
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 224" width="{W}" height="224">
<title>Zoosh logo</title>
<g transform="translate(-14.1 -10.1) scale(0.46)">{mark("l",d)}</g>
{w}
</svg>
'''
import os
os.makedirs(OUT+'/alt-uppercase',exist_ok=True)
for d,n in ((0,''),(1,'dark_')):
    open(f'{OUT}/{n}icon.svg','w').write(icon(d))
    open(f'{OUT}/{n}logo.svg','w').write(logo(d,'lower'))
    open(f'{OUT}/alt-uppercase/{n}logo.svg','w').write(logo(d,'upper'))
