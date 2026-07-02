from pathlib import Path

import tensorflow as tf

from src.config import IMG_SIZE


def build_binary_classifier() -> tf.keras.Model:
    base = tf.keras.applications.MobileNetV2(
        weights="imagenet",
        include_top=False,
        pooling="avg",
        input_shape=(*IMG_SIZE, 3),
    )
    base.trainable = False

    model = tf.keras.Sequential(
        [
            base,
            tf.keras.layers.Dense(256, activation="relu", kernel_regularizer=tf.keras.regularizers.l2(0.001)),
            tf.keras.layers.Dropout(0.4),
            tf.keras.layers.Dense(1, activation="sigmoid"),
        ]
    )
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    return model


def train_binary_classifier(
    dataset_dir: Path,
    epochs: int,
    save_path: Path,
    batch_size: int = 32,
    validation_split: float = 0.2,
    seed: int = 42,
):
    train_ds = tf.keras.utils.image_dataset_from_directory(
        dataset_dir,
        validation_split=validation_split,
        subset="training",
        seed=seed,
        image_size=IMG_SIZE,
        batch_size=batch_size,
        label_mode="binary",
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        dataset_dir,
        validation_split=validation_split,
        subset="validation",
        seed=seed,
        image_size=IMG_SIZE,
        batch_size=batch_size,
        label_mode="binary",
    )

    preprocess = tf.keras.applications.mobilenet_v2.preprocess_input
    train_ds = train_ds.map(lambda images, labels: (preprocess(images), labels)).prefetch(tf.data.AUTOTUNE)
    val_ds = val_ds.map(lambda images, labels: (preprocess(images), labels)).prefetch(tf.data.AUTOTUNE)

    model = build_binary_classifier()
    history = model.fit(train_ds, epochs=epochs, validation_data=val_ds)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    model.save(save_path)
    return history
