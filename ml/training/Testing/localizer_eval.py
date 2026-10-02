"""
MTG Card Scanner — Certamen 2, I33 (ROADMAP.md workstream I)
localizer_eval.py: mide el find-rate real de `localizar_carta()`
(ml/data-prep/card_preprocessing.py) sobre un directorio de fotos reales,
distinto del chequeo end-to-end de real_photo_eval.py (G4) — esto solo
prueba la LOCALIZACIÓN (¿encontró un candidato con forma de carta?), no
identificación/precio/condición.

Reemplaza el script ad hoc (`i32_measure.py`, nunca comiteado) que I33's
propia fila menciona haber usado para el primer chequeo (19 ago) contra
`real_negatives`/`generic_scenes` — este es el mismo tipo de chequeo, pero
comiteado y reutilizable.

Deliberadamente NO mide precisión de esquinas / IoU contra ground truth —
ninguno de los sets de fotos reales disponibles hoy (`real_negatives`,
`real_photos/` "Squirreled Away") tiene las 4 esquinas de la carta
etiquetadas a mano. Esto mide solo "¿encontró un candidato o no?"
(`--expect-card yes`, tasa de acierto) o "¿encontró un candidato donde no
debía?" (`--expect-card no`, tasa de falso positivo). El eval de
precisión-de-esquinas contra ground truth que la fila I33 original pide
sigue sin hacerse — necesita una pasada de etiquetado manual (o una UI
semi-automática) que no existe todavía.

Uso:
    python localizer_eval.py --dir ../data/images_negatives/real_negatives --expect-card yes
    python localizer_eval.py --dir ../data/real_photos --expect-card yes --dump-crops
    python localizer_eval.py --dir ../data/images_negatives/generic_scenes --expect-card no
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
TRAINING_DIR = SCRIPT_DIR.parent
DATA_PREP_DIR = TRAINING_DIR.parent / "data-prep"
sys.path.insert(0, str(DATA_PREP_DIR))

import cv2  # noqa: E402
from card_preprocessing import ASPECT_RATIO_CARTA, corregir_perspectiva, localizar_carta  # noqa: E402

IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def listar_fotos(directorio: pathlib.Path) -> list[pathlib.Path]:
    return sorted(p for p in directorio.iterdir() if p.suffix.lower() in IMG_EXTS)


def evaluar_foto(path: pathlib.Path) -> dict:
    img = cv2.imread(str(path))
    if img is None:
        return {"archivo": path.name, "error": "no se pudo leer la imagen"}

    inicio = time.perf_counter()
    esquinas = localizar_carta(img)
    duracion_ms = (time.perf_counter() - inicio) * 1000

    if esquinas is None:
        return {"archivo": path.name, "encontrado": False, "duracion_ms": round(duracion_ms, 1)}

    tl, tr, br, bl = esquinas
    ancho = (float((tr - tl)[0] ** 2 + (tr - tl)[1] ** 2) ** 0.5
             + float((br - bl)[0] ** 2 + (br - bl)[1] ** 2) ** 0.5) / 2
    alto = (float((bl - tl)[0] ** 2 + (bl - tl)[1] ** 2) ** 0.5
            + float((br - tr)[0] ** 2 + (br - tr)[1] ** 2) ** 0.5) / 2
    ratio = min(ancho, alto) / max(ancho, alto) if max(ancho, alto) > 0 else 0.0

    return {
        "archivo": path.name,
        "encontrado": True,
        "aspect_ratio": round(ratio, 4),
        "diff_aspect_ratio_ideal": round(abs(ratio - ASPECT_RATIO_CARTA), 4),
        "duracion_ms": round(duracion_ms, 1),
        "_img": img,
        "_esquinas": esquinas,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="I33 — find-rate de localizar_carta() sobre un directorio de fotos reales."
    )
    parser.add_argument("--dir", required=True, help="Directorio con fotos (.jpg/.png/.webp).")
    parser.add_argument(
        "--expect-card", choices=["yes", "no"], required=True,
        help="'yes' = la carta está genuinamente en cuadro (mide tasa de acierto); "
             "'no' = no hay carta (mide tasa de falso positivo).",
    )
    parser.add_argument("--limit", type=int, default=None, help="Procesar solo las primeras N fotos.")
    parser.add_argument(
        "--dump-crops", action="store_true",
        help="Guarda el warp de cada foto encontrada en localizer_eval_crops/<nombre-run>/ para inspección visual.",
    )
    parser.add_argument("--out-prefix", default="localizer_eval", help="Prefijo para el reporte/JSON de salida.")
    args = parser.parse_args()

    directorio = pathlib.Path(args.dir)
    if not directorio.is_dir():
        directorio = (SCRIPT_DIR / args.dir).resolve()
    if not directorio.is_dir():
        print(f"Error: no existe el directorio {args.dir}.")
        sys.exit(1)

    fotos = listar_fotos(directorio)
    if args.limit:
        fotos = fotos[: args.limit]
    if not fotos:
        print(f"Error: no hay fotos ({IMG_EXTS}) en {directorio}.")
        sys.exit(1)

    dump_dir = None
    if args.dump_crops:
        dump_dir = SCRIPT_DIR / "localizer_eval_crops" / directorio.name
        dump_dir.mkdir(parents=True, exist_ok=True)

    resultados = []
    for i, path in enumerate(fotos, 1):
        r = evaluar_foto(path)
        img = r.pop("_img", None)
        esquinas = r.pop("_esquinas", None)
        if dump_dir is not None and img is not None and esquinas is not None:
            warp = corregir_perspectiva(img, esquinas)
            cv2.imwrite(str(dump_dir / path.name), warp)
        resultados.append(r)
        estado = "ENCONTRADO" if r.get("encontrado") else ("ERROR" if r.get("error") else "no encontrado")
        print(f"[{i}/{len(fotos)}] {path.name}: {estado}")

    con_error = [r for r in resultados if r.get("error")]
    ok = [r for r in resultados if not r.get("error")]
    encontrados = [r for r in ok if r["encontrado"]]
    n_ok = len(ok)
    n_encontrados = len(encontrados)
    tasa = (n_encontrados / n_ok * 100) if n_ok else 0.0

    etiqueta = "tasa de acierto (find-rate)" if args.expect_card == "yes" else "tasa de FALSO POSITIVO"
    lineas = []
    lineas.append(f"# I33 — localizer_eval sobre `{directorio}`")
    lineas.append("")
    lineas.append(f"Fotos procesadas: {len(resultados)}  |  con error de lectura: {len(con_error)}  |  OK: {n_ok}")
    lineas.append("")
    lineas.append(f"## {etiqueta}")
    lineas.append("")
    lineas.append(f"- **{n_encontrados}/{n_ok} ({tasa:.1f}%)** fotos con un candidato encontrado.")
    if args.expect_card == "yes":
        lineas.append(
            "- Esto mide si `localizar_carta()` devolvió ALGÚN candidato con forma de carta — no si las "
            "esquinas son geométricamente correctas (sin ground truth de esquinas para este set, ver "
            "docstring del script)."
        )
    else:
        lineas.append(
            "- Cada 'encontrado' acá es un falso positivo real — una superficie de fondo confundida con una "
            "carta (la clase de bug de I32/G4e)."
        )
    if encontrados:
        ratios = [r["aspect_ratio"] for r in encontrados]
        lineas.append(
            f"- Aspect ratio de los candidatos encontrados: min {min(ratios):.3f}, max {max(ratios):.3f}, "
            f"ideal {ASPECT_RATIO_CARTA:.3f}."
        )
    duraciones = [r["duracion_ms"] for r in ok]
    if duraciones:
        lineas.append(f"- Tiempo promedio por foto: {sum(duraciones) / len(duraciones):.1f}ms.")
    if con_error:
        lineas.append("")
        lineas.append("## Errores de lectura")
        for r in con_error:
            lineas.append(f"- {r['archivo']}: {r['error']}")

    reporte = "\n".join(lineas) + "\n"
    report_path = SCRIPT_DIR / f"{args.out_prefix}_report.md"
    raw_path = SCRIPT_DIR / f"{args.out_prefix}_raw.json"
    report_path.write_text(reporte, encoding="utf-8")
    raw_path.write_text(json.dumps(resultados, indent=2, ensure_ascii=False), encoding="utf-8")

    print()
    print(reporte)
    print(f"Reporte: {report_path}")
    print(f"Raw JSON: {raw_path}")
    if dump_dir is not None:
        print(f"Crops: {dump_dir}")


if __name__ == "__main__":
    main()
