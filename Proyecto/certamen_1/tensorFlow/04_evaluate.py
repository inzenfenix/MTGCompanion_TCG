import argparse
from pathlib import Path

from src.config import PATHS, SIMILARITY_THRESHOLD, TOP_K
from src.predictor import predict_image


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


if __name__ == "__main__":
    main()
