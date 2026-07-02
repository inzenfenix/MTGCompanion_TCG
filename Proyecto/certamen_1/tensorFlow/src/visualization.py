import json
from pathlib import Path
from typing import Any

import matplotlib.image as mpimg
import matplotlib.pyplot as plt


def preview_images(image_list: list[tuple[Path, str]], output_path: Path | None = None, sample_size: int = 6) -> None:
    sample = image_list[:sample_size]
    if not sample:
        raise ValueError("No hay imagenes para visualizar.")

    rows = 2
    cols = max(1, (len(sample) + 1) // rows)
    figure, axes = plt.subplots(rows, cols, figsize=(4 * cols, 7))
    axes_list = axes.flat if hasattr(axes, "flat") else [axes]

    for axis, (image_path, name) in zip(axes_list, sample):
        axis.imshow(mpimg.imread(image_path))
        axis.set_title(name, fontsize=8)
        axis.axis("off")

    for axis in list(axes_list)[len(sample) :]:
        axis.axis("off")

    plt.tight_layout()
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        plt.savefig(output_path, dpi=150)
        print(f"Vista previa guardada: {output_path}")
    else:
        plt.show()
    plt.close(figure)


def visualize_prediction(
    query_image: Path,
    prediction: dict[str, Any],
    images_dir: Path,
    names_path: Path,
    output_path: Path | None = None,
) -> None:
    candidates = prediction["top_k"]
    figure, axes = plt.subplots(1, len(candidates) + 1, figsize=(4 * (len(candidates) + 1), 5))

    axes[0].imshow(mpimg.imread(query_image))
    axes[0].set_title("Imagen consultada", fontsize=10, fontweight="bold")
    axes[0].axis("off")

    name_to_id = {}
    if names_path.exists():
        id_to_name = json.loads(names_path.read_text(encoding="utf-8"))
        name_to_id = {name: card_id for card_id, name in id_to_name.items()}

    for axis, candidate in zip(axes[1:], candidates):
        card_id = name_to_id.get(candidate["name"])
        candidate_path = images_dir / f"{card_id}.jpg" if card_id else None
        if candidate_path and candidate_path.exists():
            axis.imshow(mpimg.imread(candidate_path))
        else:
            axis.text(0.5, 0.5, "imagen\nno disponible", ha="center", va="center", transform=axis.transAxes)
        axis.set_title(
            f"#{candidate['rank']} {candidate['name']}\nsim={candidate['similarity'] * 100:.1f}%",
            fontsize=8,
        )
        axis.axis("off")

    verdict = prediction["card_name"] if prediction["is_magic"] else "No es Magic"
    plt.suptitle(f"{verdict} (sim={prediction['similarity'] * 100:.1f}%)", fontsize=13, fontweight="bold")
    plt.tight_layout()
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        plt.savefig(output_path, dpi=150)
        print(f"Prediccion visual guardada: {output_path}")
    else:
        plt.show()
    plt.close(figure)
