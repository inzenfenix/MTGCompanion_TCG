"""
MTG Card Scanner — Certamen 1
06_finetune.py: Fine-tuning contrastivo con SimCLR.

Estrategia (Chen et al., 2020 — "A Simple Framework for Contrastive Learning"):
    Para cada carta en el batch se generan 2 augmentaciones distintas (vista_1, vista_2).
    La loss NT-Xent obliga a que:
      - (vista_1_i, vista_2_i) → embeddings cercanos   [par positivo]
      - (vista_1_i, vista_j)  → embeddings lejanos     [pares negativos]
    El modelo aprende a reconocer la misma carta bajo distintas condiciones
    fotográficas sin necesitar etiquetas.

Arquitectura durante entrenamiento:
    EfficientNet_b0 (últimas 3 capas descongeladas)
    → Projection head: Linear(1280→256) + BN + ReLU + Linear(256→128)
    → L2-normalize → NT-Xent loss

En inferencia el projection head se descarta. Se usan los 1280-dim del backbone.

Hiperparámetros clave:
    TEMPERATURE  — controla el "foco" de la distribución de similitud
                   (bajo → aprendizaje más difícil y discriminativo)
    LR           — tasa de aprendizaje (pequeña: fine-tune, no full train)
    FREEZE_FROM  — índice de bloque de EfficientNet desde el que descongelar

Salida:
    models/efficientnet_finetuned.pth  — pesos fine-tuneados
    data/embeddings_ft.npy             — embeddings re-extraídos
    data/index_ft.json                 — índice correspondiente
    results/finetune_loss.png          — curva de entrenamiento
    results/comparison_ft.png          — comparación antes/después
"""

import json
import pathlib
import time
import random

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as models
import torchvision.transforms as T
from torch.utils.data import Dataset, DataLoader
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ── Hiperparámetros ────────────────────────────────────────────────────────────
TEMPERATURE  = 0.07    # temperatura NT-Xent (SimCLR usa 0.07)
LR           = 3e-4    # lr fine-tune (bajo para no destruir ImageNet features)
WEIGHT_DECAY = 1e-4
EPOCHS       = 20      # épocas de entrenamiento
BATCH_SIZE   = 64      # cartas por batch (2×BATCH_SIZE vistas al modelo)
FREEZE_FROM  = 6       # descongelar features[FREEZE_FROM:] de EfficientNet
                       # EfficientNet_b0 tiene features[0..8] + avgpool
N_TTA        = 5       # vistas TTA en evaluación final

IMG_SIZE   = 224
NUM_WORKERS = 4
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED   = 42

DATA_DIR    = pathlib.Path("data")
IMAGES_DIR  = DATA_DIR / "images"
MODELS_DIR  = pathlib.Path("models")
RESULTS_DIR = pathlib.Path("results")

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

torch.manual_seed(SEED)
np.random.seed(SEED)


# ── Augmentaciones ─────────────────────────────────────────────────────────────

def augmentacion_simclr() -> T.Compose:
    """
    Augmentaciones fuertes para SimCLR.
    Simulan variaciones fotográficas reales de cartas físicas:
      - RandomResizedCrop: carta parcialmente visible / zoom
      - ColorJitter: iluminación variable
      - GaussianBlur: desenfoque de cámara
      - RandomPerspective: ángulo de disparo
      - RandomRotation: carta no alineada
    """
    return T.Compose([
        T.RandomResizedCrop(IMG_SIZE, scale=(0.5, 1.0), ratio=(0.75, 1.33)),
        T.ColorJitter(brightness=0.4, contrast=0.4, saturation=0.3, hue=0.05),
        T.RandomGrayscale(p=0.1),
        T.RandomPerspective(distortion_scale=0.25, p=0.6),
        T.RandomRotation(degrees=12),
        T.GaussianBlur(kernel_size=5, sigma=(0.1, 2.0)),
        T.ToTensor(),
        T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
    ])


TRANSFORM_EVAL = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


# ── Dataset ───────────────────────────────────────────────────────────────────

class SimCLRDataset(Dataset):
    """
    Para cada carta retorna dos augmentaciones distintas de la misma imagen.
    El batch resultante tiene forma (B, 2, C, H, W).
    """

    def __init__(self, rutas: list):
        self.rutas = rutas
        self.aug   = augmentacion_simclr()

    def __len__(self):
        return len(self.rutas)

    def __getitem__(self, idx: int):
        try:
            img = Image.open(self.rutas[idx]).convert("RGB")
            return self.aug(img), self.aug(img)
        except Exception:
            dummy = torch.zeros(3, IMG_SIZE, IMG_SIZE)
            return dummy, dummy


# ── Modelo con projection head ────────────────────────────────────────────────

class SimCLRModel(nn.Module):
    """
    EfficientNet_b0 con projection head para entrenamiento SimCLR.

    El backbone produce un vector h de 1280 dimensiones (representación).
    El projection head mapea h → z de 128 dimensiones (solo usado en training).
    En inferencia se usa h directamente (mejores resultados en downstream tasks).
    """

    def __init__(self, freeze_from: int = FREEZE_FROM):
        super().__init__()
        base = models.efficientnet_b0(
            weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
        )

        # Backbone: features + avgpool (sin classifier)
        self.backbone = nn.Sequential(base.features, base.avgpool)
        self.flatten  = nn.Flatten()

        # Congelar capas tempranas (detectan bordes/texturas, ya están bien)
        for i, block in enumerate(base.features):
            for p in block.parameters():
                p.requires_grad = (i >= freeze_from)

        # Projection head (solo para SimCLR, descartado en inferencia)
        self.projector = nn.Sequential(
            nn.Linear(1280, 256, bias=False),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Linear(256, 128, bias=False),
        )

    def forward(self, x: torch.Tensor, project: bool = True) -> torch.Tensor:
        h = self.flatten(self.backbone(x))   # (B, 1280)
        if not project:
            return F.normalize(h, p=2, dim=-1)
        z = self.projector(h)                # (B, 128)
        return F.normalize(z, p=2, dim=-1)


# ── NT-Xent Loss ──────────────────────────────────────────────────────────────

def nt_xent_loss(z1: torch.Tensor, z2: torch.Tensor, temperature: float) -> torch.Tensor:
    """
    Normalized Temperature-scaled Cross Entropy Loss (NT-Xent).

    z1, z2: (B, D) — embeddings L2-normalizados de las dos vistas.

    Para cada muestra i, su positivo es la vista correspondiente en el otro
    batch (i+B o i-B). Todos los demás 2(B-1) ejemplos son negativos.

    La loss es una cross-entropy sobre la similitud coseno temperatura-escalada.
    """
    B = z1.shape[0]
    z = torch.cat([z1, z2], dim=0)       # (2B, D)

    # Matriz de similitud coseno
    sim = (z @ z.T) / temperature         # (2B, 2B)

    # Enmascarar diagonal (auto-similitud → -inf para excluir del softmax)
    mask = torch.eye(2 * B, device=z.device).bool()
    sim  = sim.masked_fill(mask, float("-inf"))

    # Label de cada muestra: su positivo está B posiciones adelante/atrás
    labels = torch.cat([
        torch.arange(B, 2 * B, device=z.device),
        torch.arange(0, B,     device=z.device),
    ])

    return F.cross_entropy(sim, labels)


# ── Entrenamiento ─────────────────────────────────────────────────────────────

def entrenar(rutas: list) -> tuple:
    """
    Entrena SimCLR y retorna (modelo, historial_loss).
    """
    dataset = SimCLRDataset(rutas)
    loader  = DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=NUM_WORKERS,
        pin_memory=(DEVICE == "cuda"),
        drop_last=True,   # NT-Xent necesita batches completos
    )

    model     = SimCLRModel().to(DEVICE)
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=LR,
        weight_decay=WEIGHT_DECAY,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    # Parámetros entrenables vs congelados
    n_train  = sum(p.numel() for p in model.parameters() if p.requires_grad)
    n_frozen = sum(p.numel() for p in model.parameters() if not p.requires_grad)
    print(f"Parámetros entrenables : {n_train / 1e6:.2f}M")
    print(f"Parámetros congelados  : {n_frozen / 1e6:.2f}M")
    print(f"Temperatura NT-Xent    : {TEMPERATURE}")
    print(f"Batch size             : {BATCH_SIZE} cartas × 2 vistas = {BATCH_SIZE * 2} imágenes\n")

    historial = []

    for epoch in range(1, EPOCHS + 1):
        model.train()
        epoch_loss = 0.0
        t0 = time.perf_counter()

        for v1, v2 in loader:
            v1, v2 = v1.to(DEVICE), v2.to(DEVICE)
            z1 = model(v1, project=True)
            z2 = model(v2, project=True)

            loss = nt_xent_loss(z1, z2, TEMPERATURE)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            epoch_loss += loss.item()

        scheduler.step()
        avg_loss = epoch_loss / len(loader)
        elapsed  = time.perf_counter() - t0
        historial.append(avg_loss)

        print(f"  Época {epoch:>2}/{EPOCHS}  loss={avg_loss:.4f}  "
              f"lr={scheduler.get_last_lr()[0]:.2e}  {elapsed:.0f}s")

    return model, historial


# ── Re-extracción de embeddings ────────────────────────────────────────────────

def reextraer_embeddings(model: nn.Module, entradas: list) -> tuple:
    """
    Re-extrae embeddings con el backbone fine-tuneado.
    Usa project=False para obtener la representación h (1280-dim).
    Opcionalmente aplica TTA (N_TTA augmentaciones por imagen, promedio).
    """
    model.eval()
    aug = augmentacion_simclr()

    ids, embs = [], []

    with torch.no_grad():
        for i in range(0, len(entradas), 32):
            batch_entries = entradas[i:i + 32]
            batch_embs = []

            for card_id, ruta in batch_entries:
                try:
                    img = Image.open(ruta).convert("RGB")
                except Exception:
                    continue

                # TTA: promediar N augmentaciones + 1 imagen limpia
                views = [TRANSFORM_EVAL(img)]
                for _ in range(N_TTA - 1):
                    views.append(aug(img))

                tensors = torch.stack(views).to(DEVICE)   # (N_TTA, C, H, W)
                feats   = model(tensors, project=False)    # (N_TTA, 1280)
                avg_emb = feats.mean(dim=0)                # (1280,)
                avg_emb = F.normalize(avg_emb, p=2, dim=-1)

                ids.append(card_id)
                batch_embs.append(avg_emb.cpu().numpy())

            embs.extend(batch_embs)

            if (i // 32) % 50 == 0:
                print(f"  Re-extrayendo {len(ids):,}/{len(entradas):,}")

    return np.vstack(embs).astype(np.float32), ids


# ── Evaluación rápida ─────────────────────────────────────────────────────────

def evaluar_rapido(gallery_emb: np.ndarray, all_ids: list,
                   cards_info: dict, n_queries: int = 500) -> dict:
    """
    Evaluación rápida con imágenes augmentadas de una muestra de cartas.
    Retorna Top-1, Top-5, MRR.
    """
    aug = augmentacion_simclr()
    rng = np.random.default_rng(SEED + 1)
    q_positions = rng.choice(len(all_ids), min(n_queries, len(all_ids)), replace=False)

    top1, top5, mrr_vals = 0, 0, []

    # Necesitamos un modelo temporal para la extracción de queries
    # (cargamos el fine-tuneado desde disco si existe)
    model_path = MODELS_DIR / "efficientnet_finetuned.pth"
    if model_path.exists():
        m = SimCLRModel().to(DEVICE)
        m.load_state_dict(torch.load(model_path, map_location=DEVICE))
        m.eval()
    else:
        # Fallback: EfficientNet sin fine-tune (para comparación baseline)
        base = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        base.classifier = nn.Identity()
        m = base.to(DEVICE)
        m.eval()

    with torch.no_grad():
        for qi in q_positions:
            cid  = all_ids[qi]
            card = cards_info.get(cid, {})
            ruta = IMAGES_DIR / card.get("set", "") / f"{cid}.jpg"
            if not ruta.exists():
                continue

            try:
                img = Image.open(str(ruta)).convert("RGB")
                tensor = aug(img).unsqueeze(0).to(DEVICE)
                feats  = m(tensor, project=False) if isinstance(m, SimCLRModel) else F.normalize(m(tensor), dim=-1)
                q_emb  = feats.cpu().numpy()[0]
            except Exception:
                continue

            sims    = gallery_emb @ q_emb
            topk    = np.argsort(sims)[::-1][:5]
            ret_ids = [all_ids[i] for i in topk]

            if ret_ids[0] == cid:
                top1 += 1
            if cid in ret_ids:
                top5 += 1
                mrr_vals.append(1.0 / (ret_ids.index(cid) + 1))
            else:
                mrr_vals.append(0.0)

    n = max(len(mrr_vals), 1)
    return {
        "top1": top1 / n,
        "top5": top5 / n,
        "mrr":  float(np.mean(mrr_vals)),
        "n":    n,
    }


# ── Gráficos ───────────────────────────────────────────────────────────────────

def graficar_loss(historial: list):
    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(range(1, len(historial) + 1), historial, "o-", color="#3498DB",
            linewidth=2, markersize=5)
    ax.set_xlabel("Época")
    ax.set_ylabel("NT-Xent Loss")
    ax.set_title(f"SimCLR Fine-tuning — EfficientNet_b0\n"
                 f"T={TEMPERATURE}  lr={LR}  batch={BATCH_SIZE}  épocas={EPOCHS}")
    ax.grid(alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "finetune_loss.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def graficar_comparacion(antes: dict, despues: dict):
    metricas = ["Top-1", "Top-5", "MRR"]
    vals_antes  = [antes["top1"],  antes["top5"],  antes["mrr"]]
    vals_despues = [despues["top1"], despues["top5"], despues["mrr"]]

    x      = np.arange(len(metricas))
    ancho  = 0.35
    colors = ["#95A5A6", "#3498DB"]

    fig, ax = plt.subplots(figsize=(9, 5))
    b1 = ax.bar(x - ancho/2, vals_antes,  ancho, label="Antes (zero-shot)", color=colors[0], edgecolor="black", linewidth=0.7)
    b2 = ax.bar(x + ancho/2, vals_despues, ancho, label="Después (SimCLR)", color=colors[1], edgecolor="black", linewidth=0.7)

    ax.set_xticks(x)
    ax.set_xticklabels(metricas)
    ax.set_ylim(0, 1.1)
    ax.set_ylabel("Score")
    ax.set_title("MTG Card Scanner — Impacto del Fine-tuning SimCLR\n"
                 f"EfficientNet_b0  |  {despues['n']} queries augmentadas")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)

    for bar, val in [(b, v) for b, v in zip(list(b1) + list(b2), vals_antes + vals_despues)]:
        ax.text(bar.get_x() + bar.get_width()/2, val + 0.01,
                f"{val:.3f}", ha="center", va="bottom", fontsize=10, fontweight="bold")

    # Flecha de mejora en Top-1
    delta1 = vals_despues[0] - vals_antes[0]
    if delta1 > 0:
        ax.annotate(f"+{delta1:.1%}", xy=(x[0] + ancho/2, vals_despues[0]),
                    xytext=(x[0] + ancho/2, vals_despues[0] + 0.07),
                    ha="center", color="#27AE60", fontsize=11, fontweight="bold")

    plt.tight_layout()
    out = RESULTS_DIR / "comparison_ft.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    MODELS_DIR.mkdir(exist_ok=True)
    RESULTS_DIR.mkdir(exist_ok=True)

    # Cargar dataset
    with open(DATA_DIR / "cards.json", encoding="utf-8") as f:
        cards = json.load(f)
    cards_info = {c["id"]: c for c in cards}

    entradas = [
        (c["id"], str(IMAGES_DIR / c["set"] / f"{c['id']}.jpg"))
        for c in cards
        if (IMAGES_DIR / c["set"] / f"{c['id']}.jpg").exists()
    ]

    rutas = [r for _, r in entradas]
    print(f"Device          : {DEVICE}")
    print(f"Cartas para train: {len(rutas):,}")

    # ── Evaluación ANTES del fine-tuning ──────────────────────────────────────
    print("\n[1/4] Cargando embeddings baseline (antes del fine-tuning)...")
    if (DATA_DIR / "embeddings_pt.npy").exists():
        emb_base = np.load(DATA_DIR / "embeddings_pt.npy")
        with open(DATA_DIR / "index_pt.json") as f:
            ids_base = json.load(f)
        print(f"  Galería baseline: {emb_base.shape}")
        print("  Evaluando baseline (500 queries)...")
        metricas_antes = evaluar_rapido(emb_base, ids_base, cards_info, n_queries=500)
        print(f"  Antes → Top-1: {metricas_antes['top1']:.3f}  "
              f"Top-5: {metricas_antes['top5']:.3f}  MRR: {metricas_antes['mrr']:.3f}")
    else:
        metricas_antes = {"top1": 0, "top5": 0, "mrr": 0, "n": 0}
        print("  No hay embeddings baseline, se omite comparación")

    # ── Entrenamiento SimCLR ───────────────────────────────────────────────────
    print(f"\n[2/4] Entrenando SimCLR ({EPOCHS} épocas, {len(rutas):,} cartas)...")
    t0 = time.perf_counter()
    modelo, historial = entrenar(rutas)
    t_train = time.perf_counter() - t0
    print(f"\n  Entrenamiento completado en {t_train / 60:.1f} min")

    graficar_loss(historial)

    # Guardar pesos
    model_path = MODELS_DIR / "efficientnet_finetuned.pth"
    torch.save(modelo.state_dict(), model_path)
    print(f"  Modelo guardado: {model_path}")

    # ── Re-extracción de embeddings ────────────────────────────────────────────
    print(f"\n[3/4] Re-extrayendo embeddings con modelo fine-tuneado + TTA (×{N_TTA})...")
    t0 = time.perf_counter()
    emb_ft, ids_ft = reextraer_embeddings(modelo, entradas)
    t_emb = time.perf_counter() - t0

    np.save(DATA_DIR / "embeddings_ft.npy", emb_ft)
    with open(DATA_DIR / "index_ft.json", "w") as f:
        json.dump(ids_ft, f)
    print(f"  {emb_ft.shape}  ({t_emb:.0f}s)")

    # ── Evaluación DESPUÉS ─────────────────────────────────────────────────────
    print("\n[4/4] Evaluando modelo fine-tuneado (500 queries)...")
    metricas_despues = evaluar_rapido(emb_ft, ids_ft, cards_info, n_queries=500)
    print(f"  Después → Top-1: {metricas_despues['top1']:.3f}  "
          f"Top-5: {metricas_despues['top5']:.3f}  MRR: {metricas_despues['mrr']:.3f}")

    graficar_comparacion(metricas_antes, metricas_despues)

    # ── Resumen ────────────────────────────────────────────────────────────────
    print(f"\n{'═'*55}")
    print(f"  {'Métrica':<15}  {'Antes':>8}  {'Después':>8}  {'Δ':>8}")
    print(f"  {'─'*51}")
    for k, label in [("top1","Top-1 Accuracy"), ("top5","Top-5 Accuracy"), ("mrr","MRR")]:
        a = metricas_antes[k]
        d = metricas_despues[k]
        print(f"  {label:<15}  {a:>8.3f}  {d:>8.3f}  {d-a:>+8.3f}")
    print(f"{'═'*55}")
    print(f"\nPara usar el modelo fine-tuneado en el scanner:")
    print(f"  python scanner.py carta.jpg --finetuned")


if __name__ == "__main__":
    main()
