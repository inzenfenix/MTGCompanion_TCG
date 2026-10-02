"""
Red neuronal básica para detección de palabras en texto
Frameworks de IA — Unidad 1

Arquitectura: Bag-of-Words → Red Feedforward → Clasificación
Detecta qué categoría temática tiene un texto según las palabras que contiene.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from collections import Counter
import re

# ── 1. DATOS DE ENTRENAMIENTO ──────────────────────────────────────────
# Pares (texto, etiqueta). Etiquetas: 0=deportes, 1=tecnología, 2=salud

datos = [
    # Deportes
    ("el equipo ganó el partido de fútbol en el estadio",        0),
    ("el jugador marcó un gol en el último minuto",              0),
    ("el torneo de tenis comenzará la próxima semana",           0),
    ("el entrenador dirigió al equipo durante el campeonato",    0),
    ("el partido terminó en empate tras el tiempo extra",        0),
    ("el ciclista ganó la etapa de montaña",                     0),
    ("el maratonista cruzó la meta en primer lugar",             0),

    # Tecnología
    ("la red neuronal fue entrenada con millones de datos",      1),
    ("el modelo de inteligencia artificial supera a los humanos",1),
    ("el procesador tiene ocho núcleos de alto rendimiento",     1),
    ("la empresa lanzó un nuevo sistema operativo",              1),
    ("el algoritmo de búsqueda mejoró su precisión",             1),
    ("el chip es más rápido que la versión anterior",            1),
    ("el software detecta patrones en grandes volúmenes de datos",1),

    # Salud
    ("el médico recomendó una dieta equilibrada para el paciente",2),
    ("el estudio mostró que el ejercicio reduce el estrés",      2),
    ("la vacuna fue aprobada tras los ensayos clínicos",         2),
    ("el hospital atendió a miles de pacientes esta semana",     2),
    ("la investigación encontró un nuevo tratamiento efectivo",  2),
    ("el nutricionista indicó aumentar el consumo de verduras",  2),
    ("el diagnóstico temprano mejora las probabilidades de cura",2),
]

CLASES = ["Deportes", "Tecnología", "Salud"]

# ── 2. VOCABULARIO ─────────────────────────────────────────────────────

def tokenizar(texto: str) -> list[str]:
    """Limpia y divide el texto en tokens."""
    texto = texto.lower()
    texto = re.sub(r"[^a-záéíóúüñ\s]", "", texto)
    return texto.split()

def construir_vocabulario(datos: list) -> dict:
    """Construye un vocabulario {palabra: índice} desde los datos."""
    contador = Counter()
    for texto, _ in datos:
        contador.update(tokenizar(texto))
    # Solo palabras que aparecen ≥2 veces (elimina ruido)
    vocab = {palabra: idx for idx, (palabra, freq)
             in enumerate(contador.items()) if freq >= 1}
    return vocab

vocab = construir_vocabulario(datos)
V = len(vocab)
print(f"Vocabulario: {V} palabras")
print(f"Palabras: {list(vocab.keys())[:10]} ...")

# ── 3. VECTORIZACIÓN BOW ───────────────────────────────────────────────

def texto_a_bow(texto: str, vocab: dict) -> torch.Tensor:
    """
    Convierte texto a vector Bag-of-Words.
    bow[i] = 1 si la palabra i aparece en el texto, 0 si no.
    """
    bow = torch.zeros(len(vocab))
    for token in tokenizar(texto):
        if token in vocab:
            bow[vocab[token]] = 1.0
    return bow

# ── 4. MODELO ──────────────────────────────────────────────────────────

class DetectorPalabras(nn.Module):
    """
    Red feedforward para clasificación de texto por BoW.

    Arquitectura:
        Input (V,) → Linear → ReLU → Dropout → Linear → ReLU → Linear → logits (3,)
    """
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
        return self.red(x)  # logits — sin softmax (CrossEntropyLoss lo incluye)

modelo = DetectorPalabras(vocab_size=V, hidden=64, num_clases=3)
print(f"\nModelo: {sum(p.numel() for p in modelo.parameters())} parámetros")

# ── 5. PREPARAR DATOS ──────────────────────────────────────────────────

X = torch.stack([texto_a_bow(t, vocab) for t, _ in datos])  # (N, V)
y = torch.tensor([label for _, label in datos])              # (N,)

print(f"\nShape X: {X.shape} | Shape y: {y.shape}")

# ── 6. ENTRENAMIENTO ───────────────────────────────────────────────────

criterion = nn.CrossEntropyLoss()
optimizer = torch.optim.Adam(modelo.parameters(), lr=0.01)
EPOCHS    = 150

print("\nEntrenando...\n")
for epoch in range(1, EPOCHS + 1):
    modelo.train()
    optimizer.zero_grad()

    logits = modelo(X)
    loss   = criterion(logits, y)

    loss.backward()
    optimizer.step()

    if epoch % 30 == 0:
        modelo.eval()
        with torch.no_grad():
            preds   = modelo(X).argmax(dim=1)
            acc     = (preds == y).float().mean().item()
        print(f"Epoch {epoch:3d} | Loss: {loss.item():.4f} | Acc: {acc:.4f}")

# ── 7. INFERENCIA ──────────────────────────────────────────────────────

def predecir(texto: str) -> dict:
    """
    Recibe un texto y retorna la clase predicha con probabilidades.
    """
    modelo.eval()
    with torch.no_grad():
        bow    = texto_a_bow(texto, vocab).unsqueeze(0)  # (1, V)
        logits = modelo(bow)                              # (1, 3)
        probs  = F.softmax(logits, dim=1).squeeze()       # (3,)
        pred   = probs.argmax().item()

    return {
        "texto"       : texto,
        "prediccion"  : CLASES[pred],
        "probabilidades": {c: f"{probs[i].item():.2%}"
                           for i, c in enumerate(CLASES)}
    }

# ── 8. PRUEBAS ─────────────────────────────────────────────────────────

print("\n" + "─" * 60)
print("INFERENCIA EN TEXTOS NUEVOS")
print("─" * 60)

pruebas = [
    "el delantero marcó tres goles en el partido",
    "la red neuronal detectó patrones en las imágenes",
    "el médico diagnosticó una enfermedad crónica",
    "el equipo de ingenieros desarrolló un nuevo algoritmo",
    "el paciente mejoró tras el tratamiento hospitalario",
]

for texto in pruebas:
    resultado = predecir(texto)
    print(f"\nTexto : {resultado['texto']}")
    print(f"Clase : {resultado['prediccion']}")
    print(f"Probs : {resultado['probabilidades']}")

print("\n" + "─" * 60)
print("Ingresa tu propio texto (escribe 'salir' para terminar):")
print("─" * 60)

while True:
    entrada = input("\n> ").strip()
    if entrada.lower() in ("salir", "exit", "quit", ""):
        break
    r = predecir(entrada)
    print(f"  Predicción  : {r['prediccion']}")
    print(f"  Probabilidades: {r['probabilidades']}")
