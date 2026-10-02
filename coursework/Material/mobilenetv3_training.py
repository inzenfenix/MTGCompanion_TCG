"""
Transfer Learning con MobileNetV3Large
Frameworks de IA — Unidad 2

Dataset  : Oxford Flower Photos (5 clases, 3.670 imágenes)
           Descargado automáticamente desde storage.googleapis.com
Modelo   : MobileNetV3Large preentrenado en ImageNet + cabeza custom
Librerías: TensorFlow 2.16 · NumPy 1.26 · matplotlib 3.8

Genera tres archivos:
  training_curves.png   — loss y accuracy por época (fase 1 y 2)
  confusion_matrix.png  — matriz de confusión en el conjunto de test
  roc_curves.png        — curvas ROC one-vs-rest + AUC por clase

Estrategia de entrenamiento (dos fases):
  Fase 1 — Cabeza:    base congelada, solo se entrena el clasificador
  Fase 2 — Fine-tune:  se descongelan las últimas N capas del base model
"""

import os
import pathlib
import numpy as np
import tensorflow as tf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

# ── 1. CONFIGURACIÓN ──────────────────────────────────────────────────
IMG_SIZE      = (224, 224)
BATCH_SIZE    = 32      # numero de imágenes a procesar por vez
EPOCHS_FASE1  = 15      # cabeza — base congelada
EPOCHS_FASE2  = 10      # fine-tune — últimas capas descongeladas
FINE_TUNE_AT  = 200     # descongelar capas desde este índice en adelante
LR_FASE1      = 1e-3
LR_FASE2      = 1e-4    # LR más bajo para fine-tune
SEED          = 42

CLASES = ["daisy", "dandelion", "roses", "sunflowers", "tulips"]
N_CLASES = len(CLASES)

# ── 2. DATASET ────────────────────────────────────────────────────────
# Oxford Flower Photos — alojado en Google Storage (sin restricciones)
DATASET_URL = (
    "https://storage.googleapis.com/download.tensorflow.org"
    "/example_images/flower_photos.tgz"
)

def cargar_dataset():
    print("Descargando flower_photos...")
    ruta_zip = tf.keras.utils.get_file(
        origin=DATASET_URL,
        fname="flower_photos.tgz",
        extract=True,
        cache_subdir="datasets"
    )
    data_dir = pathlib.Path(ruta_zip).parent / "flower_photos"
    if not any(data_dir.glob("*/*.jpg")):
        data_dir = data_dir / "flower_photos"
    print(f"Dataset en: {data_dir}")
    total = len(list(data_dir.glob("*/*.jpg")))
    print(f"Total imágenes: {total}")

    # Parámetros comunes
    kwargs = dict(
        directory    = data_dir,
        seed         = SEED,
        image_size   = IMG_SIZE,
        batch_size   = BATCH_SIZE,
        class_names  = CLASES,
        label_mode   = "categorical",   # one-hot => necesario para ROC y CE loss
    )

    # 70% train · 15% val · 15% test
    train_ds = tf.keras.utils.image_dataset_from_directory(
        validation_split=0.30, subset="training", **kwargs
    )
    val_test_ds = tf.keras.utils.image_dataset_from_directory(
        validation_split=0.30, subset="validation", **kwargs
    )

    # Dividir val_test en 50/50
    n_val  = tf.data.experimental.cardinality(val_test_ds).numpy() // 2
    val_ds  = val_test_ds.take(n_val)
    test_ds = val_test_ds.skip(n_val)

    # Performance: cache + prefetch
    AUTOTUNE = tf.data.AUTOTUNE
    train_ds = train_ds.cache().shuffle(1000).prefetch(AUTOTUNE)
    val_ds   = val_ds.cache().prefetch(AUTOTUNE)
    test_ds  = test_ds.cache().prefetch(AUTOTUNE)

    return train_ds, val_ds, test_ds

# ── 3. MODELO ─────────────────────────────────────────────────────────
def construir_modelo():
    """
    Arquitectura:
      Augmentation => MobileNetV3Large (congelado) => GAP => Dense => Dropout => Softmax

    MobileNetV3Large:
      - Diseñada por Google (Howard et al., 2019)
      - Más eficiente que V2: usa hard-swish y Squeeze-Excitation
      - include_top=False => quita el clasificador original de 1000 clases
      - include_preprocessing=False => aplicamos preprocesamiento manualmente
    """
    # Data augmentation como capa del modelo (se aplica solo en train)
    # Deben tener en claro, que está técnica no genera información sintética
    # sino que toma las imágenes existentes haciendo variaciones de la misma imagen.
    # Por esto, se debe validar que realmente sea aporte para el entrenamiento.
    augmentation = tf.keras.Sequential([
        tf.keras.layers.RandomFlip("horizontal"),
        tf.keras.layers.RandomRotation(0.15),
        tf.keras.layers.RandomZoom(0.15),
        tf.keras.layers.RandomContrast(0.1),
    ], name="augmentation")

    # Base model preentrenado
    base = tf.keras.applications.MobileNetV3Large(
        input_shape   = (*IMG_SIZE, 3),
        include_top   = False,
        weights       = "imagenet",
        include_preprocessing = True,   # incluye preprocesamiento interno
    )
    base.trainable = False   # Fase 1: base congelada

    # cabeza clasificador
    inputs  = tf.keras.Input(shape=(*IMG_SIZE, 3))
    x       = augmentation(inputs)
    x       = base(x, training=False)
    x       = tf.keras.layers.GlobalAveragePooling2D()(x)
    x       = tf.keras.layers.Dense(256, activation="relu")(x)
    x       = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(N_CLASES, activation="softmax")(x)

    modelo = tf.keras.Model(inputs, outputs)
    return modelo, base

# ── 4. COMPILAR Y ENTRENAR ────────────────────────────────────────────
def entrenar(modelo, base, train_ds, val_ds):
    historial = {}

    # ── Fase 1: solo el cabeza ────────────────────────────────────────
    print(f"\n{'─'*55}")
    print(f"FASE 1 — Entrenamiento del cabeza ({EPOCHS_FASE1} épocas)")
    print(f"  Base congelada: {sum(not l.trainable for l in base.layers)} capas")
    print(f"{'─'*55}\n")

    modelo.compile(
        optimizer = tf.keras.optimizers.Adam(LR_FASE1),
        loss      = "categorical_crossentropy",
        metrics   = ["accuracy",
                     tf.keras.metrics.AUC(name="auc", multi_label=False)]
    )

    callbacks_f1 = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=5,
            restore_best_weights=True, verbose=1
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5,
            patience=3, verbose=1, min_lr=1e-6
        ),
    ]

    hist1 = modelo.fit(
        train_ds, epochs=EPOCHS_FASE1,
        validation_data=val_ds, callbacks=callbacks_f1
    )
    historial["fase1"] = hist1.history

    # ── Fase 2: fine-tuning ────────────────────────────────────────────
    # Bien, esta parte es importante pues cuando se entrena un modelo tenemos
    # 2 caminos. Uno es entrenar desde 0 (from scratch), lo que es útil para cuando
    # inicias un nuevo proyecto con un nuevo dataset... pero que pasa si tu proyecto
    # es una mejora o una especialización? Para esto se utiliza el fine tuning y se puede
    # utilizar de dos formas, para mejorar el entrenamiento de un modelo mediante
    # una mejora del dataset o transferir el entrenamiento a una red con mejores capacidades
    print(f"\n{'─'*55}")
    print(f"FASE 2 — Fine-tuning (últimas capas desde índice {FINE_TUNE_AT})")

    base.trainable = True
    # Congelar capas anteriores a FINE_TUNE_AT
    for capa in base.layers[:FINE_TUNE_AT]:
        capa.trainable = False

    entrenables = sum(l.trainable for l in base.layers)
    print(f"  Capas descongeladas en el base: {entrenables}")
    print(f"  LR reducido: {LR_FASE2}  (10× menor que fase 1)")
    print(f"{'─'*55}\n")

    modelo.compile(
        optimizer = tf.keras.optimizers.Adam(LR_FASE2),
        loss      = "categorical_crossentropy",
        metrics   = ["accuracy",
                     tf.keras.metrics.AUC(name="auc", multi_label=False)]
    )

    callbacks_f2 = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=5,
            restore_best_weights=True, verbose=1
        ),
    ]

    hist2 = modelo.fit(
        train_ds, epochs=EPOCHS_FASE2,
        validation_data=val_ds, callbacks=callbacks_f2
    )
    historial["fase2"] = hist2.history

    return historial

# ── 5. MÉTRICAS ───────────────────────────────────────────
# Si bien es cierto que sklearn tiene unas funciones muy poderosas para las métricas
# me ha pasado, demasiadas veces, que la versión de sklearn requiere una versión de numpy
# que se vuelve incompatible con la versión de tensorflow y se vuelve todo un problema
# de compatibilidad de versiones, por eso me acostumbre a no depender de dicha librería
def calcular_cm(y_true, y_pred, n):
    cm = np.zeros((n, n), dtype=int)
    for t, p in zip(y_true, y_pred):
        cm[t][p] += 1
    return cm

def calcular_metricas_por_clase(cm):
    metricas = {}
    for i in range(len(cm)):
        tp  = cm[i, i]
        fp  = cm[:, i].sum() - tp
        fn  = cm[i, :].sum() - tp
        sup = cm[i, :].sum()
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec  = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1   = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        metricas[i] = {"precision": prec, "recall": rec, "f1": f1, "support": int(sup)}
    return metricas

def roc_curve_manual(y_true_bin, y_score):
    """Calcula FPR y TPR para una clase binaria a distintos umbrales."""
    thresholds = np.sort(np.unique(y_score))[::-1]
    P = int(y_true_bin.sum())
    N = len(y_true_bin) - P
    if P == 0 or N == 0:
        return np.array([0, 1]), np.array([0, 1]), 0.5

    fprs, tprs = [0.0], [0.0]
    for thr in thresholds:
        pred = (y_score >= thr).astype(int)
        tp   = int(((pred == 1) & (y_true_bin == 1)).sum())
        fp   = int(((pred == 1) & (y_true_bin == 0)).sum())
        fprs.append(fp / N)
        tprs.append(tp / P)
    fprs.append(1.0)
    tprs.append(1.0)

    fpr = np.array(fprs)
    tpr = np.array(tprs)
    auc = float(np.trapz(tpr, fpr))
    return fpr, tpr, abs(auc)

# ── 6. OBTENER PREDICCIONES EN TEST ───────────────────────────────────
def obtener_predicciones(modelo, test_ds):
    y_true_all, y_prob_all = [], []
    for imgs, labels in test_ds:
        probs = modelo(imgs, training=False).numpy()  # (B, N_CLASES)
        y_true_all.append(np.argmax(labels.numpy(), axis=1))
        y_prob_all.append(probs)
    y_true = np.concatenate(y_true_all)
    y_prob = np.concatenate(y_prob_all)
    y_pred = np.argmax(y_prob, axis=1)
    return y_true, y_pred, y_prob

# ── 7. PLOT: CURVAS DE ENTRENAMIENTO ──────────────────────────────────
def plot_curvas(historial, output="training_curves.png"):
    h1 = historial["fase1"]
    h2 = historial["fase2"]

    # Concatenar épocas
    acc     = h1["accuracy"]     + h2["accuracy"]
    val_acc = h1["val_accuracy"] + h2["val_accuracy"]
    loss    = h1["loss"]         + h2["loss"]
    val_loss= h1["val_loss"]     + h2["val_loss"]
    epocas  = range(1, len(acc) + 1)
    corte   = len(h1["accuracy"])  # época donde empieza fase 2

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    # ── Accuracy ──────────────────────────────────────────────────────
    ax1.plot(epocas, acc,     "b-o",  ms=4, label="Train Acc",  lw=1.8)
    ax1.plot(epocas, val_acc, "b--s", ms=4, label="Val Acc",    lw=1.8)
    ax1.axvline(corte + 0.5, color="gray", ls=":", lw=1.5)
    ax1.text(corte + 0.7, min(acc) * 0.98, "Fine-tune =>",
             fontsize=9, color="gray")
    ax1.set_title("Accuracy por época", fontsize=13, fontweight="bold")
    ax1.set_xlabel("Época")
    ax1.set_ylabel("Accuracy")
    ax1.legend()
    ax1.grid(alpha=0.3)
    ax1.set_ylim(0, 1.05)

    # ── Loss ──────────────────────────────────────────────────────────
    ax2.plot(epocas, loss,     "r-o",  ms=4, label="Train Loss", lw=1.8)
    ax2.plot(epocas, val_loss, "r--s", ms=4, label="Val Loss",   lw=1.8)
    ax2.axvline(corte + 0.5, color="gray", ls=":", lw=1.5)
    ax2.text(corte + 0.7, max(loss) * 0.98, "Fine-tune =>",
             fontsize=9, color="gray")
    ax2.set_title("Loss por época", fontsize=13, fontweight="bold")
    ax2.set_xlabel("Época")
    ax2.set_ylabel("Categorical Crossentropy")
    ax2.legend()
    ax2.grid(alpha=0.3)

    plt.suptitle(
        "MobileNetV3Large — Curvas de entrenamiento\n"
        "Fase 1: cabeza  ·  Fase 2: fine-tuning",
        fontsize=14, fontweight="bold", color="#1F3864"
    )
    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  ✓ {output}")

# ── 8. PLOT: MATRIZ DE CONFUSIÓN ──────────────────────────────────────
def plot_confusion_matrix(cm_array, metricas, acc, output="confusion_matrix.png"):
    fig = plt.figure(figsize=(16, 7))
    gs  = gridspec.GridSpec(1, 2, width_ratios=[1.1, 1], figure=fig)

    # ── Izquierda: matriz ─────────────────────────────────────────────
    ax = fig.add_subplot(gs[0])
    im = ax.imshow(cm_array, interpolation="nearest", cmap="Blues")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

    ax.set_xticks(range(N_CLASES))
    ax.set_yticks(range(N_CLASES))
    ax.set_xticklabels(CLASES, rotation=40, ha="right", fontsize=11)
    ax.set_yticklabels(CLASES, fontsize=11)
    ax.set_xlabel("Predicción", fontsize=12)
    ax.set_ylabel("Etiqueta real", fontsize=12)
    ax.set_title(
        f"Matriz de Confusión — Test\nAccuracy: {acc:.1%}",
        fontsize=13, pad=12
    )

    thresh = cm_array.max() / 2.0
    for i in range(N_CLASES):
        for j in range(N_CLASES):
            v = cm_array[i, j]
            ax.text(j, i, str(v), ha="center", va="center",
                    fontsize=13, fontweight="bold",
                    color="white" if v > thresh else "black")
        ax.add_patch(plt.Rectangle(
            (i - 0.5, i - 0.5), 1, 1,
            fill=False, edgecolor="#1E7B45", linewidth=2.5
        ))

    # ── Derecha: métricas ─────────────────────────────────────────────
    ax2 = fig.add_subplot(gs[1])
    ax2.axis("off")

    ax2.text(0.05, 0.97, f"Accuracy global: {acc:.2%}",
             transform=ax2.transAxes, fontsize=13,
             fontweight="bold", color="#1F3864", va="top")

    headers = ["Clase", "Precision", "Recall", "F1", "N"]
    filas   = [[
        CLASES[i],
        f"{metricas[i]['precision']:.3f}",
        f"{metricas[i]['recall']:.3f}",
        f"{metricas[i]['f1']:.3f}",
        str(metricas[i]['support']),
    ] for i in range(N_CLASES)]

    # Macro averages
    macro_p = np.mean([metricas[i]['precision'] for i in range(N_CLASES)])
    macro_r = np.mean([metricas[i]['recall']    for i in range(N_CLASES)])
    macro_f = np.mean([metricas[i]['f1']        for i in range(N_CLASES)])
    filas.append(["macro avg",
                  f"{macro_p:.3f}", f"{macro_r:.3f}", f"{macro_f:.3f}", ""])

    tbl = ax2.table(
        cellText=filas, colLabels=headers,
        loc="upper center", bbox=[0.0, 0.42, 1.0, 0.52]
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(11)
    for (r, c), cell in tbl.get_celld().items():
        if r == 0:
            cell.set_facecolor("#1F3864")
            cell.set_text_props(color="white", fontweight="bold")
        elif r == len(filas):          # fila macro avg
            cell.set_facecolor("#D6E4F0")
            cell.set_text_props(fontweight="bold")
        elif r % 2 == 0:
            cell.set_facecolor("#EEF4FB")
        cell.set_edgecolor("#CCCCCC")

    # Barras de F1 por clase
    ax2.text(0.05, 0.38, "F1-Score por clase",
             transform=ax2.transAxes, fontsize=11,
             fontweight="bold", color="#1F3864")
    colores = ["#028090","#2E75B6","#1E7B45","#B45309","#991B1B"]
    for i, (clase, color) in enumerate(zip(CLASES, colores)):
        f1  = metricas[i]["f1"]
        y   = 0.32 - i * 0.065
        ax2.add_patch(plt.Rectangle(
            (0.05, y), f1 * 0.88, 0.045,
            transform=ax2.transAxes,
            facecolor=color, alpha=0.8
        ))
        ax2.text(0.05 + f1 * 0.88 + 0.02, y + 0.015,
                 f"{clase}  {f1:.2f}",
                 transform=ax2.transAxes, fontsize=10, va="center")

    plt.suptitle(
        "MobileNetV3Large — Evaluación en conjunto de test",
        fontsize=14, fontweight="bold", color="#1F3864", y=1.01
    )
    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  ✓ {output}")

# ── 9. PLOT: CURVAS ROC ───────────────────────────────────────────────
def plot_roc(y_true, y_prob, output="roc_curves.png"):
    """
    ROC one-vs-rest: por cada clase se trata como positivo vs. el resto.
    AUC calculado con np.trapz (regla del trapecio).
    """
    # One-hot de y_true
    y_bin = np.eye(N_CLASES)[y_true]   # (N, N_CLASES)

    colores = ["#028090","#2E75B6","#1E7B45","#B45309","#991B1B"]
    fig, axes = plt.subplots(2, 3, figsize=(16, 10))
    axes_flat = axes.flat

    auc_por_clase = {}

    for i, (clase, color) in enumerate(zip(CLASES, colores)):
        ax  = next(axes_flat)
        fpr, tpr, auc = roc_curve_manual(y_bin[:, i], y_prob[:, i])
        auc_por_clase[clase] = auc

        ax.plot(fpr, tpr, color=color, lw=2.2,
                label=f"AUC = {auc:.3f}")
        ax.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5, label="Aleatorio")
        ax.fill_between(fpr, tpr, alpha=0.08, color=color)

        ax.set_xlim(-0.02, 1.02)
        ax.set_ylim(-0.02, 1.02)
        ax.set_xlabel("False Positive Rate", fontsize=11)
        ax.set_ylabel("True Positive Rate", fontsize=11)
        ax.set_title(f"ROC — {clase}", fontsize=12, fontweight="bold", color=color)
        ax.legend(loc="lower right", fontsize=11)
        ax.grid(alpha=0.3)

        # Punto de operación óptimo (max Youden = TPR - FPR)
        youden = tpr - fpr
        idx_opt = np.argmax(youden)
        ax.scatter(fpr[idx_opt], tpr[idx_opt], color=color,
                   s=80, zorder=5, marker="o")
        ax.annotate(f"  Umbral óptimo\n  ({fpr[idx_opt]:.2f}, {tpr[idx_opt]:.2f})",
                    xy=(fpr[idx_opt], tpr[idx_opt]),
                    fontsize=8, color=color)

    # Último panel: todas las curvas juntas
    ax_all = next(axes_flat)
    for i, (clase, color) in enumerate(zip(CLASES, colores)):
        fpr, tpr, auc = roc_curve_manual(y_bin[:, i], y_prob[:, i])
        ax_all.plot(fpr, tpr, color=color, lw=2,
                    label=f"{clase}  (AUC={auc:.3f})")

    # Macro-average AUC
    macro_auc = np.mean(list(auc_por_clase.values()))
    ax_all.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5)
    ax_all.set_xlim(-0.02, 1.02)
    ax_all.set_ylim(-0.02, 1.02)
    ax_all.set_xlabel("False Positive Rate", fontsize=11)
    ax_all.set_ylabel("True Positive Rate", fontsize=11)
    ax_all.set_title(
        f"Todas las clases\nMacro-avg AUC = {macro_auc:.3f}",
        fontsize=12, fontweight="bold"
    )
    ax_all.legend(loc="lower right", fontsize=9)
    ax_all.grid(alpha=0.3)

    plt.suptitle(
        "MobileNetV3Large — Curvas ROC (One-vs-Rest)\n"
        "Flower Photos Dataset · 5 clases",
        fontsize=14, fontweight="bold", color="#1F3864"
    )
    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  ✓ {output}")
    return auc_por_clase

# ── 10. MAIN ──────────────────────────────────────────────────────────
if __name__ == "__main__":

    # Semilla de reproducibilidad
    tf.random.set_seed(SEED)
    np.random.seed(SEED)

    # Dataset
    train_ds, val_ds, test_ds = cargar_dataset()

    # Modelo
    print("\nConstruyendo modelo...")
    modelo, base = construir_modelo()
    print(f"  Parámetros totales    : {modelo.count_params():>12,}")
    print(f"  Parámetros entrenables: {sum(np.prod(v.shape) for v in modelo.trainable_variables):>12,}")
    print(f"  Parámetros congelados : {sum(np.prod(v.shape) for v in modelo.non_trainable_variables):>12,}")

    # Entrenamiento
    historial = entrenar(modelo, base, train_ds, val_ds)

    # Evaluación en test
    print("\nEvaluando en conjunto de test...")
    test_loss, test_acc, test_auc = modelo.evaluate(test_ds, verbose=0)
    print(f"  Test Loss    : {test_loss:.4f}")
    print(f"  Test Accuracy: {test_acc:.4f}  ({test_acc:.1%})")
    print(f"  Test AUC     : {test_auc:.4f}")

    # Predicciones completas para CM y ROC
    print("\nGenerando predicciones en test...")
    y_true, y_pred, y_prob = obtener_predicciones(modelo, test_ds)

    # Métricas
    cm       = calcular_cm(y_true, y_pred, N_CLASES)
    metricas = calcular_metricas_por_clase(cm)
    acc      = np.trace(cm) / np.sum(cm)

    # Reporte en consola
    print(f"\n{'─'*58}")
    print(f"{'Clase':<12} {'Precision':>10} {'Recall':>8} {'F1':>8} {'N':>6}")
    print(f"{'─'*58}")
    for i, clase in enumerate(CLASES):
        m = metricas[i]
        print(f"{clase:<12} {m['precision']:>10.3f} {m['recall']:>8.3f} "
              f"{m['f1']:>8.3f} {m['support']:>6}")
    macro_f1 = np.mean([metricas[i]['f1'] for i in range(N_CLASES)])
    print(f"{'─'*58}")
    print(f"{'macro avg':<12} {'':>10} {'':>8} {macro_f1:>8.3f}")
    print(f"\nAccuracy: {acc:.4f}  ({acc:.1%})")

    # Guardar figuras
    print("\nGenerando visualizaciones...")
    plot_curvas(historial)
    plot_confusion_matrix(cm, metricas, acc)
    auc_dict = plot_roc(y_true, y_prob)

    print(f"\nAUC por clase:")
    for clase, auc in auc_dict.items():
        print(f"  {clase:<12}: {auc:.4f}")
    print(f"  {'macro avg':<12}: {np.mean(list(auc_dict.values())):.4f}")

    print("\nCompletado")

    
# Aspectos clave:
# Accuracy: corresponde a la tasa de efectividad del modelo... mientras mas cercana a 100 mejor
# Loss: medición de que tan seguras y/o correctas son las predicciones... mientras más cercana a 0 mejor
# Auc: Área bajo la curva ROC, en el dataset de entrenamiento siempre dará cercano a 100, lo raro sería en validación tener un valor tan alto
# Pero la verdad es que estos valores deben verse en conjunto entre entrenamiento y validación. la diferencia entre ambos se llama brecha de generalización.
# Cuando en Accuracy la diferencia es aprox 5% y loss en aprox 3x, significa que tenemos overfitting leve y debemosaumentar el dropout y/o disminuir las epocas de fine tuning
# Cuando la brecha es muy grande (Accuracy > 15%, loss > 5x, AUC gap > 0.005), significa que tenemos overfitting, el efecto es que el modelo memoriza los datos de entrenamiento en lugar de encontrar patrones generalizables.
# En estos casos se puede hacer lo siguiente:
# 1. Aumentar los datos <--- siempre debe ser el primer paso
# 2. aumentar el dropout
# 3. Se puede intentar con la regularización de las capas densas (L2). la función es: tf.keras.regularizers.L2()
# 4. Disminuir las capas ocultas del modelo, pues la capacidad del modelo excede los datos disponibles
# 5. Aumentar las capas congeladas para fine tuning
# 6. Disminuir la tolerancia del modelo, esto se logra disminuyendo la paciencia de la funcion EarlyStopping
# 7. Reducir el LR de fine tuning

# Como podrás ver, este código recibió un pequeño retoque para poder funcionar con mobile_v3
# Lo importante, más que el código y el dataset en sí, es entender la estructura y el flujo de trabajo.
# Porque, de puro pesado... que pasaría si... las imágenes.... fueran... infrarrojas?

