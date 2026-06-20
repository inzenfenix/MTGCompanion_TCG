"""
Matriz de Confusión con modelo preentrenado en ImageNet

Modelo   : MobileNetV2 (preentrenado en ImageNet — sin entrenamiento adicional)
Datos    : 25 imágenes descargadas automáticamente (5 por categoría)
Clases   : cat · dog · bird · car · airplane
Librerías: TensorFlow 2.16 · NumPy 1.26 · matplotlib 3.8

"""

import time
import urllib.request
import urllib.error
import numpy as np
import tensorflow as tf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from pathlib import Path

# ── 1. CONFIGURACIÓN ──────────────────────────────────────────────────
IMG_SIZE = (224, 224)
IMG_DIR  = Path("./sample_images")
OUTPUT   = "confusion_matrix.png"

# User-Agent de navegador
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# * = error intencional para poblar la fuera de la diagonal
IMAGENES = {
    "cat": [
        ("https://upload.wikimedia.org/wikipedia/commons/4/4d/Cat_November_2010-1a.jpg", "gato doméstico"),
        ("https://upload.wikimedia.org/wikipedia/commons/b/bb/Kittyply_edit1.jpg", "gato siamés"),
        ("https://upload.wikimedia.org/wikipedia/commons/1/14/Gatto_europeo4.jpg", "gato europeo"),
        ("https://upload.wikimedia.org/wikipedia/commons/2/26/YellowLabradorLooking_new.jpg", "labrador*"),
        ("https://upload.wikimedia.org/wikipedia/commons/2/27/Beagle_male.jpg", "beagle*"),
    ],
    "dog": [
        ("https://upload.wikimedia.org/wikipedia/commons/2/26/YellowLabradorLooking_new.jpg", "labrador"),
        ("https://upload.wikimedia.org/wikipedia/commons/2/27/Beagle_male.jpg", "beagle"),
        ("https://upload.wikimedia.org/wikipedia/commons/1/1d/Samoyed_dog.jpg", "samoyedo"),
        ("https://upload.wikimedia.org/wikipedia/commons/a/a9/Olivia_Pembroke_Welsh_Corgi.jpg", "corgi"),
        ("https://upload.wikimedia.org/wikipedia/commons/6/63/Labrador_Retriever_portrait.jpg", "labrador 2"),
    ],
    "bird": [
        ("https://upload.wikimedia.org/wikipedia/commons/4/4c/Parakeet_budgerigar.jpg", "periquito"),
        ("https://upload.wikimedia.org/wikipedia/commons/1/19/Ara_macao_-on_a_small_bicycle-8.jpg", "guacamayo"),
        ("https://upload.wikimedia.org/wikipedia/commons/4/45/Eopsaltria_australis_-_Mogo_Campground.jpg", "petirrojo"),
        ("https://upload.wikimedia.org/wikipedia/commons/4/4d/Cat_November_2010-1a.jpg", "gato*"),
        ("https://upload.wikimedia.org/wikipedia/commons/1/14/Gatto_europeo4.jpg", "gato 2*"),
    ],
    "car": [
        ("https://upload.wikimedia.org/wikipedia/commons/1/1b/2019_Honda_Civic_sedan_%28facelift%2C_red%29%2C_front_8.21.19.jpg", "Honda Civic"),
        ("https://upload.wikimedia.org/wikipedia/commons/7/7b/2015_Toyota_Corolla_sedan_%28US%29.jpg","Toyota Corolla"),
        ("https://upload.wikimedia.org/wikipedia/commons/5/51/2011_Toyota_Prius_%28ZVW30R%29_i-Tech_sedan_%282011-11-18%29.jpg",  "Toyota Prius"),
        ("https://upload.wikimedia.org/wikipedia/commons/4/4c/Parakeet_budgerigar.jpg", "periquito*"),
        ("https://upload.wikimedia.org/wikipedia/commons/6/6e/A380_over_Sydney.jpg", "avión*"),
    ],
    "airplane": [
        ("https://upload.wikimedia.org/wikipedia/commons/6/6e/A380_over_Sydney.jpg", "A380"),
        ("https://upload.wikimedia.org/wikipedia/commons/6/60/BoeingB737-800Ryanair.jpg", "Boeing 737"),
        ("https://upload.wikimedia.org/wikipedia/commons/0/04/Concorde_at_Barbados_%28Aero_Icarus%29.jpg", "Concorde"),
        ("https://upload.wikimedia.org/wikipedia/commons/2/26/YellowLabradorLooking_new.jpg", "labrador*"),
        ("https://upload.wikimedia.org/wikipedia/commons/7/7b/2015_Toyota_Corolla_sedan_%28US%29.jpg","auto*"),
    ],
}

CLASES = list(IMAGENES.keys())

IMAGENET_A_CAT = {}
for i in range(281, 286): IMAGENET_A_CAT[i] = "cat"       # gatos
for i in range(151, 269): IMAGENET_A_CAT[i] = "dog"       # razas de perro
for i in list(range(7, 25)) + \
         list(range(80, 101)) + \
         list(range(127, 147)): IMAGENET_A_CAT[i] = "bird"      # aves
for i in [407, 436, 511, 817, 656,
          717, 751, 661, 734, 609,
          468, 475, 479, 581, 627]: IMAGENET_A_CAT[i] = "car"       # vehículos
for i in [404, 895, 400, 401]: IMAGENET_A_CAT[i] = "airplane"  # aviones

def idx_a_cat(idx: int) -> str:
    return IMAGENET_A_CAT.get(int(idx), "other")

def descargar(url: str, ruta: Path, max_intentos: int = 3) -> bool:
    """Descarga una URL con User-Agent de navegador y reintentos."""
    for intento in range(1, max_intentos + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as resp:
                ruta.write_bytes(resp.read())
            return True
        except urllib.error.HTTPError as e:
            print(f"    HTTP {e.code} en intento {intento}/{max_intentos}")
        except Exception as e:
            print(f"    Error en intento {intento}/{max_intentos}: {e}")
        if intento < max_intentos:
            time.sleep(1.5)
    return False

def descargar_imagenes():
    IMG_DIR.mkdir(exist_ok=True)
    rutas, etiquetas = [], []

    print("Descargando imágenes...")
    for clase, items in IMAGENES.items():
        (IMG_DIR / clase).mkdir(exist_ok=True)
        for i, (url, desc) in enumerate(items):
            ext  = ".png" if url.lower().endswith(".png") else ".jpg"
            ruta = IMG_DIR / clase / f"{i}{ext}"

            if ruta.exists():
                rutas.append(str(ruta))
                etiquetas.append(clase)
                print(f" (OK) {clase}/{i}{ext}  ({desc})  [en caché]")
                continue

            ok = descargar(url, ruta)
            if ok:
                rutas.append(str(ruta))
                etiquetas.append(clase)
                print(f" (OK) {clase}/{i}{ext}  ({desc})")
            else:
                print(f" (ERR) {clase}/{i}  ({desc})  — omitida")

    return rutas, etiquetas

def cargar_imagen(ruta: str) -> np.ndarray:
    img = tf.keras.utils.load_img(ruta, target_size=IMG_SIZE)
    arr = tf.keras.utils.img_to_array(img)
    arr = np.expand_dims(arr, axis=0)
    return tf.keras.applications.mobilenet_v2.preprocess_input(arr)

def predecir_batch(modelo, rutas: list) -> list:
    resultados = []
    for ruta in rutas:
        try:
            preds = modelo.predict(cargar_imagen(ruta), verbose=0)
            idx   = int(np.argmax(preds[0]))
            conf  = float(preds[0][idx])
            resultados.append((idx_a_cat(idx), conf, idx))
        except Exception as e:
            print(f"  Error prediciendo {ruta}: {e}")
            resultados.append(("other", 0.0, -1))
    return resultados

def calcular_cm(y_true, y_pred, clases) -> np.ndarray:
    idx = {c: i for i, c in enumerate(clases)}
    cm  = np.zeros((len(clases), len(clases)), dtype=int)
    for real, pred in zip(y_true, y_pred):
        if real in idx and pred in idx:
            cm[idx[real]][idx[pred]] += 1
    return cm

def calcular_metricas(y_true, y_pred, clases) -> dict:
    metricas = {}
    for c in clases:
        tp  = sum(r == c and p == c for r, p in zip(y_true, y_pred))
        fp  = sum(r != c and p == c for r, p in zip(y_true, y_pred))
        fn  = sum(r == c and p != c for r, p in zip(y_true, y_pred))
        sup = sum(r == c for r in y_true)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec  = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1   = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        metricas[c] = {"precision": prec, "recall": rec, "f1": f1, "support": sup}
    return metricas

def plot_confusion_matrix(cm_array, clases, metricas, acc):
    fig = plt.figure(figsize=(18, 10))
    gs  = gridspec.GridSpec(1, 2, width_ratios=[1.2, 1], figure=fig)

    ax = fig.add_subplot(gs[0])
    im = ax.imshow(cm_array, interpolation="nearest", cmap="Blues")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

    ax.set_xticks(range(len(clases)))
    ax.set_yticks(range(len(clases)))
    ax.set_xticklabels(clases, rotation=45, ha="right", fontsize=12)
    ax.set_yticklabels(clases, fontsize=12)
    ax.set_xlabel("Predicción  (MobileNetV2)", fontsize=13)
    ax.set_ylabel("Etiqueta real", fontsize=13)
    ax.set_title(
        "Matriz de Confusión\nMobileNetV2 preentrenado en ImageNet",
        fontsize=14, pad=15
    )

    thresh = cm_array.max() / 2.0
    for i in range(len(clases)):
        for j in range(len(clases)):
            v = cm_array[i, j]
            ax.text(j, i, str(v), ha="center", va="center",
                    fontsize=14, fontweight="bold",
                    color="white" if v > thresh else "black")
        # Borde verde en diagonal
        ax.add_patch(plt.Rectangle(
            (i - 0.5, i - 0.5), 1, 1,
            fill=False, edgecolor="#1E7B45", linewidth=2.5
        ))

    ax2 = fig.add_subplot(gs[1])
    ax2.axis("off")

    ax2.text(0.05, 0.97, f"Accuracy global: {acc:.1%}",
             transform=ax2.transAxes, fontsize=14, fontweight="bold",
             color="#1F3864", va="top")

    # Tabla de métricas
    headers = ["Clase", "Precision", "Recall", "F1", "N"]
    filas   = [[
        c,
        f"{metricas[c]['precision']:.2f}",
        f"{metricas[c]['recall']:.2f}",
        f"{metricas[c]['f1']:.2f}",
        str(metricas[c]['support']),
    ] for c in clases]

    tbl = ax2.table(
        cellText=filas, colLabels=headers,
        loc="upper left", bbox=[0.0, 0.44, 1.0, 0.48]
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(11)
    for (r, c), cell in tbl.get_celld().items():
        if r == 0:
            cell.set_facecolor("#1F3864")
            cell.set_text_props(color="white", fontweight="bold")
        elif r % 2 == 0:
            cell.set_facecolor("#E8F0F8")
        cell.set_edgecolor("#CCCCCC")

    # Nota metodológica
    ax2.text(0.05, 0.40, "Nota metodológica",
             transform=ax2.transAxes, fontsize=11,
             fontweight="bold", color="#1F3864")
    nota = (
        "ImageNet tiene 1.000 clases. Las predicciones\n"
        "se agrupan en 5 categorías por rango de índice:\n\n"
        "  cat      → 281–285\n"
        "  dog      → 151–268\n"
        "  bird     → 7–24, 80–100, 127–146\n"
        "  car      → 407, 436, 511, 817...\n"
        "  airplane → 400, 401, 404, 895\n"
        "  other    → resto de las 1.000 clases\n\n"
        "Las imágenes marcadas con * son errores\n"
        "intencionales para poblar la fuera de\n"
        "la diagonal y hacer el ejemplo didáctico."
    )
    ax2.text(0.05, 0.37, nota,
             transform=ax2.transAxes, fontsize=10,
             color="#334155", va="top", family="monospace",
             bbox=dict(boxstyle="round,pad=0.5",
                       facecolor="#F8FAFC", edgecolor="#CBD5E1"))

    plt.suptitle(
        "MobileNetV2 — Clasificación de imágenes reales sin fine-tuning",
        fontsize=15, fontweight="bold", color="#1F3864", y=1.01
    )
    plt.tight_layout()
    plt.savefig(OUTPUT, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"\nMatriz guardada en '{OUTPUT}'")

if __name__ == "__main__":

    print("Cargando MobileNetV2 (ImageNet)...")
    modelo = tf.keras.applications.MobileNetV2(
        weights="imagenet", include_top=True, input_shape=(*IMG_SIZE, 3)
    )
    print(f"Modelo listo — {modelo.count_params():,} parámetros\n")

    rutas, y_true = descargar_imagenes()
    print(f"\n{len(rutas)} imágenes disponibles")

    print("\nInferencia...")
    resultados = predecir_batch(modelo, rutas)
    y_pred = [r[0] for r in resultados]

    print("\n" + "─" * 62)
    print(f"{'Imagen':<30} {'Real':<10} {'Pred':<10} {'Conf':>6}  ")
    print("─" * 62)
    for ruta, real, (pred, conf, idx) in zip(rutas, y_true, resultados):
        nombre = f"{Path(ruta).parent.name}/{Path(ruta).name}"
        marca  = "✓" if real == pred else "✗"
        print(f"{nombre:<30} {real:<10} {pred:<10} {conf:>5.1%}  {marca}")

    correctas = sum(r == p for r, p in zip(y_true, y_pred))
    acc       = correctas / len(y_true) if y_true else 0
    print(f"\nAccuracy: {correctas}/{len(y_true)} = {acc:.1%}")

    todas_clases = CLASES + (["other"] if "other" in y_pred else [])
    clases_pres  = [c for c in todas_clases if c in y_true or c in y_pred]

    cm_array  = calcular_cm(y_true, y_pred, clases_pres)
    metricas  = calcular_metricas(y_true, y_pred, clases_pres)

    # Raw en consola
    print("\nMatriz de confusión:")
    print(f"{'':>10}", end="")
    for c in clases_pres: print(f"{c:>10}", end="")
    print()
    for i, c in enumerate(clases_pres):
        print(f"{c:>10}", end="")
        for v in cm_array[i]: print(f"{v:>10}", end="")
        print()

    print(f"\n{'Clase':<12} {'Precision':>10} {'Recall':>8} {'F1':>8} {'N':>5}")
    print("─" * 46)
    for c in clases_pres:
        m = metricas[c]
        print(f"{c:<12} {m['precision']:>10.2f} {m['recall']:>8.2f} "
              f"{m['f1']:>8.2f} {m['support']:>5}")

    plot_confusion_matrix(cm_array, clases_pres, metricas, acc)
