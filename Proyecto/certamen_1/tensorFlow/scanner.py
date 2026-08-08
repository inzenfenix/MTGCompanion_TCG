import argparse
import json
from pathlib import Path

from src.config import PATHS, PROJECT_ROOT, SIMILARITY_THRESHOLD, TOP_K
from src.predictor import predict_image

RESULTS_DIR = PROJECT_ROOT / "results"


def print_prediction(prediction: dict) -> None:
    verdict = "Es Magic" if prediction["is_magic"] else "Probablemente NO es Magic"
    print("\n" + "=" * 60)
    print(verdict)
    print(f"Carta top-1 : {prediction['card_name']}")
    print(f"Similitud   : {prediction['similarity'] * 100:.1f}%")
    print("\nTop candidatos:")
    for candidate in prediction["top_k"]:
        print(f"  #{candidate['rank']} {candidate['name']} - {candidate['similarity'] * 100:.1f}%")
    print("=" * 60)


def enriquecer_candidatos(candidates: list, cards_info: dict) -> list:
    """Suma metadata de la carta (set/cmc/colores/rareza) a cada candidato, si está disponible."""
    enriquecidos = []
    for c in candidates:
        card = cards_info.get(c.get("id")) or {}
        enriquecidos.append({
            **c,
            "set_name": card.get("set_name"),
            "cmc": card.get("cmc"),
            "colors": card.get("colors"),
            "rarity": card.get("rarity"),
        })
    return enriquecidos


def guardar_resultado(image: Path, prediction: dict, threshold: float, cards_info: dict) -> None:
    """
    Escribe results/last_scan.json con la última corrida — es lo que lee el
    runner de Electron para mostrar los resultados en la UI en vez de solo
    texto plano en la consola.
    """
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    candidates = enriquecer_candidatos(prediction["top_k"], cards_info)
    resultado = {
        "kind": "scanner",
        "framework": "tensorflow",
        "image": str(image),
        "threshold": threshold,
        "is_magic": prediction["is_magic"],
        "top1": candidates[0] if candidates else None,
        "candidates": candidates,
    }
    with open(RESULTS_DIR / "last_scan.json", "w", encoding="utf-8") as f:
        json.dump(resultado, f, indent=2, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Identifica una carta Magic por similitud de embeddings.")
    parser.add_argument("image", type=Path, help="Ruta de la imagen a probar.")
    parser.add_argument("--top-k", type=int, default=TOP_K, help="Cantidad de candidatos a mostrar.")
    parser.add_argument("--threshold", type=float, default=SIMILARITY_THRESHOLD, help="Umbral de similitud.")
    args = parser.parse_args()

    prediction = predict_image(
        image_path=args.image,
        index_path=PATHS.embedding_index,
        top_k=args.top_k,
        threshold=args.threshold,
    )
    print_prediction(prediction)

    cards_info = {}
    if PATHS.catalog_json.exists():
        with open(PATHS.catalog_json, encoding="utf-8") as f:
            cards_info = {c["id"]: c for c in json.load(f)}
    guardar_resultado(args.image, prediction, args.threshold, cards_info)


if __name__ == "__main__":
    main()