import tensorflow as tf

from src.config import IMG_SIZE

GRADOS = ["NM", "LP", "MP", "HP", "DMG"]
FREEZE_RATIO = 0.65  # mismo default que build_binary_classifier — punto de partida, no una eleccion aprendida


def build_optimizer(name: str, learning_rate: float, weight_decay: float) -> tf.keras.optimizers.Optimizer:
    """Mismo patron que src/binary_classifier.py."""
    normalized = name.strip().lower()
    common = {"learning_rate": learning_rate, "weight_decay": weight_decay}
    if normalized == "adam":
        return tf.keras.optimizers.Adam(**common)
    if normalized == "adamw":
        return tf.keras.optimizers.AdamW(**common)
    if normalized == "sgd":
        return tf.keras.optimizers.SGD(momentum=0.9, **common)
    raise ValueError(f"Optimizador no soportado: {name}")


def build_condition_grader(
    freeze_ratio: float = FREEZE_RATIO,
    learning_rate: float = 3e-4,
    weight_decay: float = 0.0,
    head_units: int = 256,
    dropout: float | None = None,
    optimizer_name: str = "adam",
) -> tf.keras.Model:
    """
    MobileNetV3Small adaptada como clasificador de condicion (NM/LP/MP/HP/DMG).

    A diferencia de build_binary_classifier (MobileNetV2, salida binaria),
    esta es la primera pieza del pipeline que usa MobileNetV3 — Stage 4 es
    codigo nuevo, sin atar el resto del pipeline (Stage 1 sigue en V2 hasta
    que termine esa migracion, ver certamen_2/README.md seccion 1). Salida:
    len(GRADOS) logits con softmax, entrenado con categorical_crossentropy.
    """
    if not 0.0 <= freeze_ratio <= 1.0:
        raise ValueError("freeze_ratio debe estar entre 0.0 y 1.0")
    if head_units <= 0:
        raise ValueError("head_units debe ser positivo")
    if dropout is not None and not 0.0 <= dropout <= 1.0:
        raise ValueError("dropout debe estar entre 0.0 y 1.0")

    dropout_1, dropout_2 = (0.3, 0.2) if dropout is None else (dropout, dropout)

    base = tf.keras.applications.MobileNetV3Small(
        weights="imagenet",
        include_top=False,
        pooling="avg",
        input_shape=(*IMG_SIZE, 3),
    )
    base.trainable = True
    n_freeze = int(len(base.layers) * freeze_ratio)
    for layer in base.layers[:n_freeze]:
        layer.trainable = False

    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3))
    x = base(inputs, training=False)
    x = tf.keras.layers.Dropout(dropout_1)(x)
    x = tf.keras.layers.Dense(head_units, activation="relu")(x)
    x = tf.keras.layers.Dropout(dropout_2)(x)
    outputs = tf.keras.layers.Dense(len(GRADOS), activation="softmax")(x)

    model = tf.keras.Model(inputs, outputs, name="condition_grader")
    model.compile(
        optimizer=build_optimizer(optimizer_name, learning_rate, weight_decay),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model
