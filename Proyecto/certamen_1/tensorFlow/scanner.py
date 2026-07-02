import argparse
from pathlib import Path

from src.config import PATHS, SIMILARITY_THRESHOLD, TOP_K
from src.predictor import predict_image


def main() -> None:
    parser = argparse.ArgumentParser(description="Scanner rapido de cartas Magic.")
    parser.add_argument("image", type=Path, help="Imagen de carta o foto a analizar.")
    parser.add_argument("--top-k", type=int, default=TOP_K)
    parser.add_argument("--threshold", type=float, default=SIMILARITY_THRESHOLD)
    args = parser.parse_args()

    prediction = predict_image(
        image_path=args.image,
        index_path=PATHS.embedding_index,
        top_k=args.top_k,
        threshold=args.threshold,
    )

    print("MAGIC" if prediction["is_magic"] else "NO_MAGIC")
    print(f"card_name={prediction['card_name']}")
    print(f"similarity={prediction['similarity']:.6f}")


if __name__ == "__main__":
    main()
