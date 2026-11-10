#!/usr/bin/env bash
# Basit süpervizör: süreç çökerse 3 sn sonra yeniden başlatır. Kullanım: PORT=3111 scripts/run-forever.sh >> /tmp/diurna.log 2>&1 &
cd "$(dirname "$0")/.." || exit 1
export UM_TRUST_PROXY=${UM_TRUST_PROXY:-1}   # tünel arkasında; yerelde http denemek için UM_FORCE_SECURE ayarlamayın
while true; do node server.js; echo "[$(date -Is)] süreç çıktı ($?), 3 sn sonra yeniden başlatılıyor"; sleep 3; done
