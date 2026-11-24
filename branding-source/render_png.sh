#!/bin/zsh
# usage: render.sh svg w h out.png
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
D=${RENDER_TMP:?set RENDER_TMP to a scratch dir outside the project}
svg=$1; w=$2; h=$3; out=$4
cat > $D/page.html <<H
<!doctype html><html><body style="margin:0;background:transparent"><img src="file://$svg" style="display:block;width:${w}px;height:${h}px"></body></html>
H
"$CH" --headless=new --disable-gpu --screenshot=$out --default-background-color=00000000 --window-size=$w,$h --hide-scrollbars --force-device-scale-factor=1 "file://$D/page.html" >/dev/null 2>&1
