"""
Entrenamiento y guardado del modelo MLP para detección de palabras
Frameworks de IA — Unidad 1

Genera el archivo modelo_mlp.pt con:
  - state_dict del modelo
  - vocabulario (vocab)
  - configuración de la arquitectura (config)

Uso:
  python entrenar_mlp.py
  → guarda modelo_mlp.pt en el directorio actual
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from collections import Counter
import re
import os

# ── DATOS ──────────────────────────────────────────────────────────────
datos = [
    ("el equipo ganó el partido de fútbol en el estadio",         0),
    ("el jugador marcó un gol en el último minuto",               0),
    ("el torneo de tenis comenzará la próxima semana",            0),
    ("el entrenador dirigió al equipo durante el campeonato",     0),
    ("el partido terminó en empate tras el tiempo extra",         0),
    ("el ciclista ganó la etapa de montaña",                      0),
    ("el maratonista cruzó la meta en primer lugar",              0),
    ("la red neuronal fue entrenada con millones de datos",       1),
    ("el modelo de inteligencia artificial supera a los humanos", 1),
    ("el procesador tiene ocho núcleos de alto rendimiento",      1),
    ("la empresa lanzó un nuevo sistema operativo",               1),
    ("el algoritmo de búsqueda mejoró su precisión",              1),
    ("el chip es más rápido que la versión anterior",             1),
    ("el software detecta patrones en grandes volúmenes de datos",1),
    ("el médico recomendó una dieta equilibrada para el paciente",2),
    ("el estudio mostró que el ejercicio reduce el estrés",       2),
    ("la vacuna fue aprobada tras los ensayos clínicos",          2),
    ("el hospital atendió a miles de pacientes esta semana",      2),
    ("la investigación encontró un nuevo tratamiento efectivo",   2),
    ("el nutricionista indicó aumentar el consumo de verduras",   2),
    ("el diagnóstico temprano mejora las probabilidades de cura", 2),
]
CLASES = ["Deportes", "Tecnología", "Salud"]

# ── VOCABULARIO ────────────────────────────────────────────────────────
def tokenizar(texto: str) -> list[str]:
    return re.sub(r"[^a-záéíóúüñ\s]", "", texto.lower()).split()

def construir_vocabulario(datos) -> dict:
    contador = Counter(t for texto, _ in datos for t in tokenizar(texto))
    return {palabra: idx for idx, (palabra, _) in enumerate(contador.items())}

vocab = construir_vocabulario(datos)
V     = len(vocab)

# ── VECTORIZACIÓN BOW ──────────────────────────────────────────────────
def texto_a_bow(texto: str, vocab: dict) -> torch.Tensor:
    bow = torch.zeros(len(vocab))
    for token in tokenizar(texto):
        if token in vocab:
            bow[vocab[token]] = 1.0
    return bow

# ── MODELO ─────────────────────────────────────────────────────────────
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

# ── CONFIGURACIÓN ──────────────────────────────────────────────────────
CONFIG = {
    "vocab_size" : V,
    "hidden"     : 64,
    "num_clases" : 3,
    "clases"     : CLASES,
}

modelo = DetectorPalabras(
    vocab_size=CONFIG["vocab_size"],
    hidden=CONFIG["hidden"],
    num_clases=CONFIG["num_clases"],
)
print(f"Parámetros: {sum(p.numel() for p in modelo.parameters()):,}")

# ── ENTRENAMIENTO ──────────────────────────────────────────────────────
X         = torch.stack([texto_a_bow(t, vocab) for t, _ in datos])
y         = torch.tensor([label for _, label in datos])
criterion = nn.CrossEntropyLoss()
optimizer = torch.optim.Adam(modelo.parameters(), lr=0.01)
EPOCHS    = 150

print("Entrenando...")
for epoch in range(1, EPOCHS + 1):
    modelo.train()
    optimizer.zero_grad()
    loss = criterion(modelo(X), y)
    loss.backward()
    optimizer.step()

    if epoch % 50 == 0:
        modelo.eval()
        with torch.no_grad():
            acc = (modelo(X).argmax(1) == y).float().mean().item()
        print(f"  Epoch {epoch:3d} | Loss: {loss.item():.4f} | Acc: {acc:.4f}")

# ── GUARDAR MODELO ─────────────────────────────────────────────────────
# Se guarda todo lo necesario para reconstruir el modelo sin el código
# de entrenamiento: pesos, vocabulario y configuración de arquitectura.
RUTA = "modelo_mlp.pt"

torch.save({
    "model_state" : modelo.state_dict(),   # pesos entrenados
    "vocab"       : vocab,                 # diccionario palabra → índice
    "config"      : CONFIG,                # arquitectura e hiperparámetros
}, RUTA)

size_kb = os.path.getsize(RUTA) / 1024
print(f"\nModelo guardado en '{RUTA}' ({size_kb:.1f} KB)")
print("Contenido del checkpoint:")
print(f"  model_state : {len(modelo.state_dict())} tensores de pesos")
print(f"  vocab       : {len(vocab)} palabras")
print(f"  config      : {CONFIG}")
