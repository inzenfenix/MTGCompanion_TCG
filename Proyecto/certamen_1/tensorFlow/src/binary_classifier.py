import tensorflow as tf

from src.config import IMG_SIZE

FREEZE_RATIO = 0.65  # fraccion de capas de MobileNetV2 que quedan congeladas (desde la entrada)


def build_binary_classifier(freeze_ratio: float = FREEZE_RATIO) -> tf.keras.Model:
    """
    MobileNetV2 adaptada como clasificador binario MTG / no-MTG.

    Las primeras `freeze_ratio` capas quedan congeladas (features de ImageNet
    de bajo nivel); el resto se afina junto con la cabeza binaria. El backbone
    se llama con training=False para no actualizar las estadisticas de
    BatchNorm, aun cuando algunas de sus capas son entrenables (practica
    recomendada para fine-tuning parcial en Keras).
    """
    base = tf.keras.applications.MobileNetV2(
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
    x = tf.keras.layers.Dropout(0.3)(x)
    x = tf.keras.layers.Dense(256, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(x)

    model = tf.keras.Model(inputs, outputs, name="mtg_detector")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=3e-4),
        loss="binary_crossentropy",
        metrics=["accuracy"],
    )
    return model
