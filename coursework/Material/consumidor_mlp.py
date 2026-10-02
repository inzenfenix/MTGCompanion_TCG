"""
Consumidor del modelo MLP — Detección de palabras en texto
Frameworks de IA — Unidad 1

Carga el modelo entrenado desde modelo_mlp.pt y expone tres modos de uso:

  1. python consumidor_mlp.py
         → modo interactivo (loop de consola)

  2. python consumidor_mlp.py "el jugador marcó un gol"
         → predice el texto pasado como argumento

  3. python consumidor_mlp.py --batch textos.txt
         → predice todas las líneas del archivo

El script es completamente independiente del código de entrenamiento.
Solo necesita el archivo modelo_mlp.pt generado por entrenar_mlp.py.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import re
import sys
import json
from pathlib import Path

# ── 1. DEFINICIÓN DEL MODELO ───────────────────────────────────────────
# Debe ser idéntica a la usada en entrenamiento para que load_state_dict
# funcione correctamente. En un proyecto real esto viviría en model.py
# y se importaría desde ambos scripts.

class DetectorPalabras(nn.Module):
    def __init__(self, vocab_size: int, hidden: int, num_clases: int):
        super().__init__()
        self.red = nn.Sequential(
            nn.Linear(vocab_size, hidden),
            nn.ReLU(),
            nn.Dropout(p=0.3),
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(),
            nn.Linear(hidden // 2, num_clases),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.red(x)

# ── 2. CARGADOR DEL CHECKPOINT ─────────────────────────────────────────

def cargar_modelo(ruta: str):
    """
    Lee el checkpoint y reconstruye el modelo listo para inferencia.
    Retorna (modelo, vocab, config).
    """
    if not Path(ruta).exists():
        raise FileNotFoundError(
            f"No se encontró '{ruta}'.\n"
            f"Ejecuta primero: python entrenar_mlp.py"
        )

    # map_location="cpu" garantiza que carga incluso si se entrenó en GPU
    checkpoint = torch.load(ruta, map_location="cpu")

    config = checkpoint["config"]
    vocab  = checkpoint["vocab"]

    modelo = DetectorPalabras(
        vocab_size=config["vocab_size"],
        hidden    =config["hidden"],
        num_clases=config["num_clases"],
    )
    modelo.load_state_dict(checkpoint["model_state"])
    modelo.eval()   # desactiva Dropout para inferencia

    return modelo, vocab, config

# ── 3. PREPROCESAMIENTO ────────────────────────────────────────────────

def tokenizar(texto: str) -> list[str]:
    return re.sub(r"[^a-záéíóúüñ\s]", "", texto.lower()).split()

def texto_a_bow(texto: str, vocab: dict) -> torch.Tensor:
    bow = torch.zeros(len(vocab))
    for token in tokenizar(texto):
        if token in vocab:
            bow[vocab[token]] = 1.0
    return bow

# ── 4. INFERENCIA ──────────────────────────────────────────────────────

def predecir(texto: str, modelo, vocab: dict, clases: list) -> dict:
    """
    Recibe un texto y retorna clase predicha, probabilidades y confianza.
    """
    with torch.no_grad():
        bow    = texto_a_bow(texto, vocab).unsqueeze(0)   # (1, V)
        logits = modelo(bow)                               # (1, 3)
        probs  = F.softmax(logits, dim=1).squeeze()        # (3,)
        pred   = probs.argmax().item()
        conf   = probs[pred].item()

    return {
        "texto"          : texto,
        "prediccion"     : clases[pred],
        "confianza"      : f"{conf:.2%}",
        "probabilidades" : {c: round(probs[i].item(), 4) for i, c in enumerate(clases)},
    }

def predecir_batch(textos: list[str], modelo, vocab: dict, clases: list) -> list[dict]:
    """Procesa una lista de textos en un solo forward pass."""
    with torch.no_grad():
        bows   = torch.stack([texto_a_bow(t, vocab) for t in textos])  # (N, V)
        logits = modelo(bows)                                            # (N, 3)
        probs  = F.softmax(logits, dim=1)                               # (N, 3)
        preds  = probs.argmax(dim=1)                                    # (N,)

    resultados = []
    for i, texto in enumerate(textos):
        pred = preds[i].item()
        resultados.append({
            "texto"      : texto,
            "prediccion" : clases[pred],
            "confianza"  : f"{probs[i][pred].item():.2%}",
            "probabilidades": {c: round(probs[i][j].item(), 4) for j, c in enumerate(clases)},
        })
    return resultados

# ── 5. HELPERS DE SALIDA ───────────────────────────────────────────────

def imprimir_resultado(r: dict):
    barra   = "█" * int(float(r["confianza"].strip("%")) / 5)
    espacio = "░" * (20 - len(barra))
    print(f"\n  Texto      : {r['texto']}")
    print(f"  Predicción : {r['prediccion']}")
    print(f"  Confianza  : {r['confianza']}  {barra}{espacio}")
    print("  Detalle    :", end="")
    for clase, prob in r["probabilidades"].items():
        print(f"  {clase}: {prob:.2%}", end="")
    print()

def imprimir_info_modelo(config: dict, vocab: dict, ruta: str):
    from pathlib import Path
    size_kb = Path(ruta).stat().st_size / 1024
    print("─" * 55)
    print("  Modelo MLP — Detector de Palabras")
    print("─" * 55)
    print(f"  Archivo    : {ruta}  ({size_kb:.1f} KB)")
    print(f"  Vocabulario: {len(vocab)} palabras")
    print(f"  Clases     : {', '.join(config['clases'])}")
    print(f"  Arquitectura: Linear({config['vocab_size']}→{config['hidden']})"
          f" → ReLU → Dropout → Linear({config['hidden']}→{config['hidden']//2})"
          f" → ReLU → Linear({config['hidden']//2}→{config['num_clases']})")
    print("─" * 55)

# ── 6. MODOS DE EJECUCIÓN ──────────────────────────────────────────────

RUTA_MODELO = "modelo_mlp.pt"

def modo_interactivo(modelo, vocab, config):
    """Loop de consola para predicción en tiempo real."""
    print("\nModo interactivo — escribe 'salir' para terminar\n")
    while True:
        try:
            entrada = input("Texto > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nSaliendo...")
            break

        if entrada.lower() in ("salir", "exit", "quit", ""):
            break

        r = predecir(entrada, modelo, vocab, config["clases"])
        imprimir_resultado(r)

def modo_argumento(texto: str, modelo, vocab, config):
    """Predice un texto pasado como argumento CLI."""
    r = predecir(texto, modelo, vocab, config["clases"])
    imprimir_resultado(r)
    # También imprime JSON para integración con otros sistemas
    print("\n  JSON:", json.dumps({
        "prediccion": r["prediccion"],
        "confianza" : r["confianza"],
        "probabilidades": r["probabilidades"]
    }, ensure_ascii=False))

def modo_batch(ruta_archivo: str, modelo, vocab, config):
    """Predice todas las líneas de un archivo de texto."""
    ruta = Path(ruta_archivo)
    if not ruta.exists():
        print(f"Error: no se encontró el archivo '{ruta_archivo}'")
        sys.exit(1)

    textos = [l.strip() for l in ruta.read_text(encoding="utf-8").splitlines() if l.strip()]
    print(f"\nProcesando {len(textos)} textos desde '{ruta_archivo}'...\n")

    resultados = predecir_batch(textos, modelo, vocab, config["clases"])
    for r in resultados:
        imprimir_resultado(r)

    # Resumen
    from collections import Counter
    conteo = Counter(r["prediccion"] for r in resultados)
    print("\n─" * 28)
    print("Resumen:")
    for clase, n in conteo.most_common():
        print(f"  {clase:12} : {n} textos")

# ── 7. MAIN ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Cargar modelo
    modelo, vocab, config = cargar_modelo(RUTA_MODELO)
    imprimir_info_modelo(config, vocab, RUTA_MODELO)

    args = sys.argv[1:]

    if not args:
        # Sin argumentos → modo interactivo
        modo_interactivo(modelo, vocab, config)

    elif args[0] == "--batch" and len(args) == 2:
        # python consumidor_mlp.py --batch textos.txt
        modo_batch(args[1], modelo, vocab, config)

    else:
        # python consumidor_mlp.py "el jugador marcó un gol"
        texto = " ".join(args)
        modo_argumento(texto, modelo, vocab, config)
