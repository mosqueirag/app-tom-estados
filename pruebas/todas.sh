# Corre las pruebas indicadas (o todas) y muestra el resultado de cada una
cd /home/claude/build
for f in ${@:-2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17}; do
  [ -f e2e/fase$f.mjs ] || continue
  bash e2e/reset.sh >/dev/null 2>&1
  salida=$(timeout 400 node e2e/fase$f.mjs 2>&1)
  echo "fase$f: $(echo "$salida" | grep -c '^✓') ok, $(echo "$salida" | grep -c '^✗') fallas"
  echo "$salida" | grep '^✗\|Error' | head -5
done
