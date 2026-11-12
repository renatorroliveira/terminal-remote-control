#!/bin/bash
here=$(cd "$(dirname "$0")" && pwd)
probe="$here/../../tools/ax-probe/.build/release/ax-probe"
variant=$1 scenario=$2
log=$(mktemp)
"$here/node_modules/.bin/electron" "$here" --s2-variant="$variant" --s2-scenario="$scenario" ${3:+--s2-atscolor=$3} ${4:+--s2-desc=$4} >"$log" 2>/dev/null &
epid=$!
for i in $(seq 1 100); do grep -q S2REPORT "$log" && break; sleep 0.2; done
pid=$(awk '/^S2PID/{print $2}' "$log")
"$probe" focused "$pid" 3000 > "$here/probe-results/$variant-$scenario${3:+-$3}${4:+-$4}.json"
grep S2REPORT "$log" | cut -c10- > "$here/probe-results/$variant-$scenario${3:+-$3}${4:+-$4}.app.json"
kill $epid 2>/dev/null; wait $epid 2>/dev/null
rm -f "$log"
