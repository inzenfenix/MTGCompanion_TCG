"""
Este es un ejemplo de grad-cam, una técnica para ver gráficamente donde se está fijando una red dentro de una imagen.
 las versiones de librería para que esto funcione son:
 Python     3.11
 TensorFlow 2.16
 NumPy      1.26
 matplotlib 3.8
 En PyTorch, se utiliza la librería torchvision.
"""

import numpy as np
import tensorflow as tf
import matplotlib
matplotlib.use("Agg")   # backend sin display — va antes de importar pyplot
import matplotlib.pyplot as plt

def make_gradcam_heatmap(img_array, model, last_conv_layer_name, pred_index=None):
    grad_model = tf.keras.models.Model(
        inputs=[model.inputs],
        outputs=[model.get_layer(last_conv_layer_name).output, model.output]
    )

    with tf.GradientTape() as tape:
        last_conv_layer_output, preds = grad_model(img_array)
        if pred_index is None:
            pred_index = tf.argmax(preds[0])
        class_channel = preds[:, pred_index]

    grads = tape.gradient(class_channel, last_conv_layer_output)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))

    last_conv_layer_output = last_conv_layer_output[0]
    heatmap = last_conv_layer_output @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap)

    # ReLU + normalización segura (evita división por cero)
    heatmap = tf.maximum(heatmap, 0)
    max_val = tf.reduce_max(heatmap)
    heatmap = heatmap / (max_val + tf.keras.backend.epsilon())

    return heatmap.numpy()

def save_gradcam(img_path, heatmap, alpha=0.4, output_path="grad_cam_output.png"):
    img = tf.keras.utils.load_img(img_path)
    img = tf.keras.utils.img_to_array(img)

    heatmap = np.uint8(255 * heatmap)

    jet_colors = plt.colormaps["jet"](np.arange(256))[:, :3]
    jet_heatmap = jet_colors[heatmap]

    jet_heatmap = tf.keras.utils.array_to_img(jet_heatmap)
    jet_heatmap = jet_heatmap.resize((img.shape[1], img.shape[0]))
    jet_heatmap = tf.keras.utils.img_to_array(jet_heatmap)

    superimposed_img = jet_heatmap * alpha + img
    superimposed_img = tf.keras.utils.array_to_img(superimposed_img)

    plt.imshow(superimposed_img)
    plt.axis("off")
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Grad-CAM guardado en '{output_path}'")


# Fijate en el modelo utilizado, existen muchos otros para que lo profundicen
# los pesos también es un parámetro importante.
# para este caso estamos usando una red preentrenada
model     = tf.keras.applications.Xception(weights="imagenet")
img_size  = (299, 299)
img_path  = "./image.png"

img       = tf.keras.utils.load_img(img_path, target_size=img_size)
img_array = tf.keras.utils.img_to_array(img)
img_array = np.expand_dims(img_array, axis=0)
img_array = tf.keras.applications.xception.preprocess_input(img_array)

heatmap   = make_gradcam_heatmap(img_array, model, "block14_sepconv2_act")
save_gradcam(img_path, heatmap)

# El valor "block14_sepconv2_act" corresponde a la última capa convolucional de la red utilizada para este ejercicios Xception.
# Esto quiere decir que es mandatorio el conocer la arquitectura del modelo que utilizaremos, revisa
# https://www.tensorflow.org/api_docs/python/tf/keras/applications para ver el listado de modelos disponibles, recuerda que la disponibilidad de modelos está sujeta a la versión de Tensorflow la que a su vez depende de la versión de Python que utilices.
