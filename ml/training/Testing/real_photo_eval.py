"""
MTG Card Scanner — Certamen 2, G4 (ROADMAP.md workstream G)
real_photo_eval.py: chequeo end-to-end del pipeline (Stage 1→2→3→4, modelos
reales) sobre fotos reales de un mazo físico — no sintéticas, no renders.

Corre pytorch/batch_real_photo_pipeline.py UNA vez (un solo proceso, carga
los 4 modelos una sola vez — ver docstring de ese script sobre por qué:
la versión anterior de este script shelleaba full_pipeline_demo.py por
cada foto, 4 subprocesos con reimport de torch cada uno, ~66s/foto) sobre
certamen_1/data/real_photos/ y agrega:
  - Stage 1 : ¿el nombre de carta predicho (top-1) está en el decklist
              conocido? (accuracy aproximada — ver el propio decklist.json
              sobre por qué esto es membership, no un ground truth 1:1 por foto)
  - Stage 2 : tasa de confirmación del texto OCR'd
  - Stage 4 : distribución de grados predichos (sin ground truth real de
              condición — descriptivo, no accuracy)
  - Stage 3 : MAE entre precio estimado y prices.usd real de la carta
              matcheada (ancla aproximada, no el precio de la foto física)

Uso:
    python real_photo_eval.py
    python real_photo_eval.py --limit 10   # subset rápido para iterar
"""

import argparse
import json
import pathlib
import statistics
import subprocess
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN1_DIR = SCRIPT_DIR.parent
PYTORCH_DIR = CERTAMEN1_DIR / "pytorch"
REAL_PHOTOS_DIR = CERTAMEN1_DIR / "data" / "real_photos"
DECKLIST_PATH = REAL_PHOTOS_DIR / "squirreled_away_decklist.json"
REPORT_PATH = SCRIPT_DIR / "real_photo_eval_report.md"
RAW_JSON_PATH = SCRIPT_DIR / "real_photo_eval_raw.json"


def _venv_python(framework_dir: pathlib.Path) -> pathlib.Path:
    for candidato in (framework_dir / ".venv" / "bin" / "python", framework_dir / ".venv" / "Scripts" / "python.exe"):
        if candidato.exists():
            return candidato
    return framework_dir / ".venv" / "bin" / "python"


def cargar_decklist() -> set:
    with open(DECKLIST_PATH, encoding="utf-8") as f:
        data = json.load(f)
    nombres = set(data["cards"]) | set(data["commanders"]) | set(data["known_token_names"])
    return {n.lower() for n in nombres}


def nombre_en_decklist(card_name: str, decklist_lower: set) -> bool:
    """Cartas de doble cara vienen como 'Cara A // Cara B' — cualquiera de las dos cuenta."""
    caras = [c.strip().lower() for c in card_name.split("//")]
    return any(cara in decklist_lower for cara in caras)


def alguno_en_decklist(card_names: list, decklist_lower: set) -> bool:
    """Igual que nombre_en_decklist() pero para una lista de candidatos (top-5/top-10)."""
    return any(nombre_en_decklist(nombre, decklist_lower) for nombre in card_names)


def correr_batch(limit: int | None) -> list:
    """
    Corre batch_real_photo_pipeline.py UNA vez (proceso único, modelos
    cargados una sola vez — ver docstring de ese script) y streamea su
    salida en vivo (no se captura) para ver el progreso mientras corre.
    """
    python_bin = _venv_python(PYTORCH_DIR)
    cmd = [str(python_bin), "batch_real_photo_pipeline.py",
           "--photos-dir", str(REAL_PHOTOS_DIR), "--output", str(RAW_JSON_PATH)]
    if limit:
        cmd += ["--limit", str(limit)]

    # Hereda el entorno tal cual (incluye HSA_OVERRIDE_GFX_VERSION si el
    # usuario ya lo exportó a mano para esta GPU — mismo caso que cualquier
    # otro script de pytorch/, CLAUDE.md regla 1; no se asume un valor acá).
    proc = subprocess.run(cmd, cwd=PYTORCH_DIR)
    if proc.returncode != 0:
        print("Error: batch_real_photo_pipeline.py falló — ver output arriba.")
        sys.exit(1)

    with open(RAW_JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    parser = argparse.ArgumentParser(description="G4 — chequeo end-to-end sobre fotos reales.")
    parser.add_argument("--limit", type=int, default=None, help="Procesar solo las primeras N fotos (para iterar rápido).")
    args = parser.parse_args()

    if not DECKLIST_PATH.exists():
        print(f"Error: no existe {DECKLIST_PATH}.")
        sys.exit(1)
    if not REAL_PHOTOS_DIR.exists() or not any(REAL_PHOTOS_DIR.glob("*.jpg")):
        print(f"Error: no hay fotos en {REAL_PHOTOS_DIR}. Corré 03_real_photos_downloader.py primero.")
        sys.exit(1)

    decklist_lower = cargar_decklist()
    resultados = correr_batch(args.limit)

    con_error = [r for r in resultados if r.get("error")]
    ok = [r for r in resultados if not r.get("error")]

    for r in ok:
        r["en_decklist"] = nombre_en_decklist(r.get("card_name", ""), decklist_lower)
        r["en_decklist_top5"] = alguno_en_decklist(r.get("top5_names", [r.get("card_name", "")]), decklist_lower)
        r["en_decklist_top10"] = alguno_en_decklist(r.get("top10_names", [r.get("card_name", "")]), decklist_lower)

    n_ok = len(ok)
    n_en_decklist = sum(1 for r in ok if r["en_decklist"])
    n_en_decklist_top5 = sum(1 for r in ok if r["en_decklist_top5"])
    n_en_decklist_top10 = sum(1 for r in ok if r["en_decklist_top10"])
    n_confirma = sum(1 for r in ok if r.get("confirma") == "sí")

    dist_grados: dict = {}
    for r in ok:
        g = r.get("grado")
        if g:
            dist_grados[g] = dist_grados.get(g, 0) + 1

    diffs_precio = []
    for r in ok:
        if "precio_estimado" in r and "precio_real" in r:
            diffs_precio.append(abs(float(r["precio_estimado"]) - float(r["precio_real"])))

    lineas = []
    lineas.append("# G4 — Chequeo end-to-end sobre fotos reales (Squirreled Away, Bloomburrow)")
    lineas.append("")
    lineas.append(f"Fotos procesadas: {len(resultados)}  |  con error: {len(con_error)}  |  OK: {n_ok}")
    lineas.append("")
    lineas.append("## Stage 1 — Identificación (¿el nombre predicho está en el decklist?)")
    lineas.append("")
    if n_ok:
        lineas.append(f"- Top-1 en decklist:  {n_en_decklist}/{n_ok} ({n_en_decklist / n_ok * 100:.1f}%)")
        lineas.append(f"- Top-5 en decklist:  {n_en_decklist_top5}/{n_ok} ({n_en_decklist_top5 / n_ok * 100:.1f}%)")
        lineas.append(f"- Top-10 en decklist: {n_en_decklist_top10}/{n_ok} ({n_en_decklist_top10 / n_ok * 100:.1f}%)")
    lineas.append(
        "- **Caveat**: esto es membership contra el decklist de 100 cartas (+ tokens conocidos), no un "
        "ground truth foto-por-foto — una predicción puede estar en el decklist \"por casualidad\" si el "
        "modelo confunde una carta del mazo por otra del mismo mazo. No hay etiqueta exacta por foto (ver "
        "squirreled_away_decklist.json)."
    )
    lineas.append(
        "- **Top-5/Top-10 (ROADMAP.md G4d)**: mide si el candidato correcto ya aparece más abajo en el "
        "ranking de similitud coseno aunque no gane el top-1 — el caso \"Insatiable Frugivore\" documentado "
        "en G4d (rank real #54/58,679, top-1 equivocado por un margen chico) es exactamente lo que esto "
        "debería capturar. Si Top-5/Top-10 suben bastante más que Top-1, la retrieval no está \"rota\", solo "
        "necesita más candidatos para confirmar (una UX de \"elegí entre estos 5\" en vez de confiar ciegamente "
        "en el top-1) — si casi no suben, el problema es más profundo (embedding no discriminativo, G4d)."
    )
    lineas.append("")
    lineas.append("## Stage 2 — Validación de texto (modelo real, TextMatcher)")
    lineas.append("")
    if n_ok:
        lineas.append(f"- Tasa de confirmación: {n_confirma}/{n_ok} ({n_confirma / n_ok * 100:.1f}%)")
    lineas.append(
        "- Una confirmación baja acá no es necesariamente un fallo de Stage 2 — Stage 2 confirma/rechaza "
        "contra la carta que **Stage 1** identificó; si Stage 1 se equivocó, lo correcto es que Stage 2 "
        "rechace (ver docstring de full_pipeline_demo.py)."
    )
    lineas.append("")
    lineas.append("## Stage 4 — Distribución de condición (sin ground truth — descriptivo)")
    lineas.append("")
    for g in ["NM", "LP", "MP", "HP", "DMG"]:
        lineas.append(f"- {g}: {dist_grados.get(g, 0)}")
    lineas.append("")
    lineas.append("## Stage 3 — Precio estimado vs. referencia de catálogo (Scryfall NM)")
    lineas.append("")
    if diffs_precio:
        lineas.append(f"- MAE (USD): {statistics.mean(diffs_precio):.2f}  (n={len(diffs_precio)})")
        lineas.append(f"- Mediana AE (USD): {statistics.median(diffs_precio):.2f}")
    else:
        lineas.append("- Sin pares con precio real disponible.")
    lineas.append(
        "- La referencia es el precio de catálogo (near-mint) de la carta que Stage 1 matcheó, no el "
        "precio real de la foto física — anclaje aproximado, no un ground truth de precio por fotografía."
    )
    lineas.append("")
    if con_error:
        lineas.append("## Fotos con error")
        lineas.append("")
        for r in con_error:
            lineas.append(f"- {r['foto']}: {r['error'][:200]}")
        lineas.append("")

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas) + "\n")

    with open(SCRIPT_DIR / "real_photo_eval_raw.json", "w", encoding="utf-8") as f:
        json.dump(resultados, f, indent=2, ensure_ascii=False)

    print(f"\nReporte: {REPORT_PATH}")
    print(f"Datos crudos: {SCRIPT_DIR / 'real_photo_eval_raw.json'}")


if __name__ == "__main__":
    main()
